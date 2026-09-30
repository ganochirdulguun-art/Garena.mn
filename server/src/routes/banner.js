// ══════════════════════════════════════════════════════════════
// Профайлын дэвсгэр (баннер) — GOLD давуу тал (2026-09-30).
//  • POST /profile/banner   — raw зураг (GIF/WebP хөдөлгөөнт, PNG/JPEG), ≤ 5MB; зөвхөн GOLD эсвэл эзэн.
//  • DELETE /profile/banner — өөрийн баннерийг устгах.
//  • GET /profile/banner/:id — нээлттэй (<img> токен илгээдэггүй); байхгүй бол 404.
// Файлын төрлийг толгойн байтаар (magic) шалгана — Content-Type-д итгэхгүй.
// ══════════════════════════════════════════════════════════════
const express = require('express');
const auth = require('../middleware/auth');
const adminMW = require('../middleware/admin');

let db;
try { db = require('../config/db'); } catch { db = null; }
const router = express.Router();
const MAX = 5 * 1024 * 1024;

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }
async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_banner BYTEA;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_banner_mime VARCHAR(20);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_banner_ver BIGINT;
    `);
  } catch (e) { console.error('[Migration] profile_banner:', e.message); }
}
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf.subarray(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
async function canBanner(user) {
  if (adminMW.isOwnerUser(user)) return true;
  try { const { tierOf } = require('./membership'); return (await tierOf(user.id)) === 'gold'; } catch { return false; }
}

router.post('/banner', auth, express.raw({ type: () => true, limit: MAX }), async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  if (!await canBanner(req.user)) return res.status(403).json({ error: 'Профайлын дэвсгэр зөвхөн GOLD гишүүнд нээлттэй', code: 'TIER_REQUIRED', need_tier: 'gold' });
  const buf = Buffer.isBuffer(req.body) ? req.body : null;
  if (!buf || !buf.length) return res.status(400).json({ error: 'Зураг хоосон' });
  if (buf.length > MAX) return res.status(413).json({ error: 'Зураг 5MB-с ихгүй байх ёстой' });
  const mime = sniff(buf);
  if (!mime) return res.status(400).json({ error: 'GIF, WebP, PNG эсвэл JPG зураг сонгоно уу' });
  try {
    const ver = Date.now();
    await db.query('UPDATE users SET profile_banner = $1, profile_banner_mime = $2, profile_banner_ver = $3 WHERE id = $4', [buf, mime, ver, req.user.id]);
    return res.json({ ok: true, banner_ver: ver, mime });
  } catch (e) { console.error('[banner] upload', e.message); return res.status(500).json({ error: 'Server error' }); }
});

router.delete('/banner', auth, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try { await db.query('UPDATE users SET profile_banner = NULL, profile_banner_mime = NULL, profile_banner_ver = NULL WHERE id = $1', [req.user.id]); return res.json({ ok: true }); }
  catch (e) { return res.status(500).json({ error: 'Server error' }); }
});

router.get('/banner/:id', async (req, res) => {
  if (!/^\d+$/.test(String(req.params.id))) return res.status(404).end();
  if (!await dbOk()) return res.status(503).end();
  try {
    const r = await db.query('SELECT profile_banner, profile_banner_mime FROM users WHERE id = $1', [req.params.id]);
    const row = r.rows[0];
    if (!row?.profile_banner) return res.status(404).end();
    res.set({ 'Content-Type': row.profile_banner_mime || 'image/png', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' });
    return res.end(row.profile_banner);
  } catch { return res.status(500).end(); }
});

async function bannerVer(userId) {
  try { const r = await db.query('SELECT profile_banner_ver FROM users WHERE id = $1', [userId]); return r.rows[0]?.profile_banner_ver ? Number(r.rows[0].profile_banner_ver) : null; } catch { return null; }
}
module.exports = { router, ensureTables, sniff, bannerVer };
