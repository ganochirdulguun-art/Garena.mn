// ══════════════════════════════════════════════════════════════
// Map-ын сан (2026-09-30) — WC3 custom map-уудыг платформоос шууд татах (гадны холбоосгүй).
//  • Файлууд Postgres-т (bytea) хадгалагдана — room_backgrounds-тай ижил арга (Railway-д volume алга).
//  • GET /maps — жагсаалт (өгөгдөлгүй); GET /maps/:id/file — файл (нэвтэрсэн хэрэглэгч, SHA-256 толгойтой).
//  • POST /maps/upload — зөвхөн эзэн/админ: raw .w3x/.w3m (≤ 32MB), мета нь query-ээр.
//  ⚠️ Зөвхөн чөлөөтэй тарааж болох community map. Warcraft III тоглоомын өөрийн файл (Blizzard) ХОРИОТОЙ.
// ══════════════════════════════════════════════════════════════
const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const adminMW = require('../middleware/admin');

let db;
try { db = require('../config/db'); } catch { db = null; }
const router = express.Router();

const MAX_BYTES = 32 * 1024 * 1024;
const CATEGORIES = ['DotA', 'LoD', 'IMBA', 'Melee', 'Tower Defense', 'RPG', 'Custom'];

async function dbOk() {
  if (!db) return false;
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}
async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS maps (
        id          SERIAL PRIMARY KEY,
        name        VARCHAR(80)  NOT NULL,
        version     VARCHAR(40)  DEFAULT '',
        category    VARCHAR(30)  DEFAULT 'Custom',
        description VARCHAR(300) DEFAULT '',
        filename    VARCHAR(120) NOT NULL,
        size        INTEGER NOT NULL,
        sha256      CHAR(64) NOT NULL,
        data        BYTEA NOT NULL,
        downloads   INTEGER NOT NULL DEFAULT 0,
        featured    BOOLEAN NOT NULL DEFAULT FALSE,
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at  TIMESTAMP DEFAULT NOW(),
        updated_at  TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS maps_filename_unique ON maps (LOWER(filename));
    `);
  } catch (e) { console.error('[Migration] maps:', e.message); }
}
if (process.env.SKIP_DB_MIGRATIONS !== 'true') ensureTables();

async function isStaff(user) {
  if (adminMW.isOwnerUser(user)) return true;
  try { return await adminMW.isAdminDiscordId(user?.discord_id); } catch { return false; }
}
/** Файлын нэр: зөвхөн basename, аюулгүй тэмдэгт, .w3x/.w3m */
function safeFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[^\w .()[\]+-]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  return /\.(w3x|w3m)$/i.test(base) && base.length > 4 ? base : null;
}
/** WC3 map файлын толгой: 'HM3W' (MPQ-ийн өмнөх header) эсвэл шууд 'MPQ\x1A' */
function looksLikeMap(buf) {
  if (!buf || buf.length < 16) return false;
  const h = buf.subarray(0, 4).toString('latin1');
  return h === 'HM3W' || h === 'MPQ\x1a';
}
const PUBLIC_COLS = 'id, name, version, category, description, filename, size, sha256, downloads, featured, created_at, updated_at';

// ── Жагсаалт ──
router.get('/', auth.optional, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const r = await db.query(`SELECT ${PUBLIC_COLS} FROM maps WHERE active = TRUE ORDER BY featured DESC, downloads DESC, name`);
    return res.json({ maps: r.rows, categories: CATEGORIES, can_upload: req.user ? await isStaff(req.user) : false });
  } catch (e) { console.error('[maps] list', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// ── Файл татах ──
router.get('/:id/file', auth, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const r = await db.query('SELECT filename, size, sha256, data FROM maps WHERE id = $1 AND active = TRUE', [req.params.id]);
    const m = r.rows[0];
    if (!m) return res.status(404).json({ error: 'Map олдсонгүй' });
    db.query('UPDATE maps SET downloads = downloads + 1 WHERE id = $1', [req.params.id]).catch(() => {});
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(m.data.length),
      'Content-Disposition': `attachment; filename="${encodeURIComponent(m.filename)}"`,
      'X-Map-Sha256': m.sha256,
      'Cache-Control': 'private, max-age=0',
    });
    return res.end(m.data);
  } catch (e) { console.error('[maps] file', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// ── Upload (эзэн/админ) — raw body; ижил файлын нэртэй бол шинэ хувилбараар солино ──
router.post('/upload', auth, express.raw({ type: 'application/octet-stream', limit: MAX_BYTES }), async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  if (!await isStaff(req.user)) return res.status(403).json({ error: 'Зөвхөн эзэн/админ map нэмнэ' });
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  const filename = safeFilename(req.query.filename);
  const name = String(req.query.name || '').trim().slice(0, 80);
  if (!buf || !buf.length) return res.status(400).json({ error: 'Файл хоосон' });
  if (!filename) return res.status(400).json({ error: 'Файлын нэр .w3x эсвэл .w3m байх ёстой' });
  if (!looksLikeMap(buf)) return res.status(400).json({ error: 'Энэ WC3 map файл биш байна' });
  if (!name) return res.status(400).json({ error: 'Map-ын нэр оруулна уу' });
  const category = CATEGORIES.includes(req.query.category) ? req.query.category : 'Custom';
  const version = String(req.query.version || '').trim().slice(0, 40);
  const description = String(req.query.description || '').trim().slice(0, 300);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  try {
    const r = await db.query(`
      INSERT INTO maps (name, version, category, description, filename, size, sha256, data, uploaded_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (LOWER(filename)) DO UPDATE SET name = EXCLUDED.name, version = EXCLUDED.version, category = EXCLUDED.category,
        description = EXCLUDED.description, size = EXCLUDED.size, sha256 = EXCLUDED.sha256, data = EXCLUDED.data,
        active = TRUE, updated_at = NOW()
      RETURNING ${PUBLIC_COLS}`,
      [name, version, category, description, filename, buf.length, sha256, buf, req.user.id]);
    return res.status(201).json(r.rows[0]);
  } catch (e) { console.error('[maps] upload', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// ── Засах / устгах (эзэн/админ) ──
router.patch('/:id', auth, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  if (!await isStaff(req.user)) return res.status(403).json({ error: 'Зөвхөн эзэн/админ' });
  const sets = []; const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
  const b = req.body || {};
  if (b.name !== undefined) add('name', String(b.name).trim().slice(0, 80));
  if (b.version !== undefined) add('version', String(b.version).trim().slice(0, 40));
  if (b.description !== undefined) add('description', String(b.description).trim().slice(0, 300));
  if (b.category !== undefined && CATEGORIES.includes(b.category)) add('category', b.category);
  if (b.featured !== undefined) add('featured', !!b.featured);
  if (!sets.length) return res.status(400).json({ error: 'Өөрчлөх зүйл алга' });
  vals.push(req.params.id);
  try {
    const r = await db.query(`UPDATE maps SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} RETURNING ${PUBLIC_COLS}`, vals);
    return r.rows[0] ? res.json(r.rows[0]) : res.status(404).json({ error: 'Map олдсонгүй' });
  } catch (e) { return res.status(500).json({ error: 'Server error' }); }
});
router.delete('/:id', auth, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  if (!await isStaff(req.user)) return res.status(403).json({ error: 'Зөвхөн эзэн/админ' });
  try { await db.query('DELETE FROM maps WHERE id = $1', [req.params.id]); return res.json({ ok: true }); }
  catch (e) { return res.status(500).json({ error: 'Server error' }); }
});

module.exports = { router, ensureTables, safeFilename, looksLikeMap, CATEGORIES };
