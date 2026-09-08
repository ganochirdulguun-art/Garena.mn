// ── Өрөөний дэвсгэр зураг — файл upload (GOLD гишүүн), 2026-09-08 эзний хүсэлт ──
// Клиент зурагтаа data URL болгож POST /rooms/background руу илгээнэ (JSON body 5mb хязгаарт багтана),
// сервер Postgres-т (bytea) хадгалаад public URL буцаана → тэр URL нь room-bg талбарт орж, өрөө үүсгэхэд
// background_url болно. Railway-ийн файл систем түр зуурынх тул зөвхөн DB-д хадгална.
// GET нь auth-гүй (өрөөний цонхны CSS url() токен дамжуулдаггүй) — таах боломжгүй UUID + зөвхөн зураг тул аюулгүй.
const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');

let db = null;
try { db = require('../config/db'); } catch { db = null; }

const router = express.Router();

const MAX_BG_BYTES = 2 * 1024 * 1024;   // 2MB (base64-ээр ~2.7MB — express json limit 5mb-д багтана)
const BG_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** data URL → { mime, buf } эсвэл null. Цэвэр функц (tests/roombg.test.js). */
function parseImageDataUrl(s, maxBytes = MAX_BG_BYTES) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(s || ''));
  if (!m || !BG_MIMES.has(m[1])) return null;
  let buf;
  try { buf = Buffer.from(m[2], 'base64'); } catch { return null; }
  if (!buf.length || buf.length > maxBytes) return null;
  return { mime: m[1], buf };
}

async function ensureTable() {
  await db.query(`CREATE TABLE IF NOT EXISTS room_backgrounds (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    mime TEXT NOT NULL,
    data BYTEA NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

// GOLD гишүүн зураг байршуулна: { image: "data:image/png;base64,..." } → { url }
router.post('/background', auth, async (req, res) => {
  try {
    const { tierOf, perksOf } = require('./membership');
    if (!perksOf(await tierOf(req.user.id)).roomBackground) {
      return res.status(403).json({ error: 'Өрөөний дэвсгэр зураг зөвхөн GOLD гишүүнд нээлттэй', code: 'TIER_REQUIRED' });
    }
    const img = parseImageDataUrl(req.body?.image);
    if (!img) return res.status(400).json({ error: 'JPG/PNG/WebP зураг, 2MB-с ихгүй байх ёстой' });
    await ensureTable();
    const id = crypto.randomUUID();
    await db.query('INSERT INTO room_backgrounds (id, user_id, mime, data) VALUES ($1,$2,$3,$4)', [id, req.user.id, img.mime, img.buf]);
    // Хэрэглэгч бүрд сүүлийн 3-ыг л үлдээнэ (хогийн сав томрохгүй)
    await db.query(`DELETE FROM room_backgrounds WHERE user_id = $1 AND id NOT IN
      (SELECT id FROM room_backgrounds WHERE user_id = $1 ORDER BY created_at DESC LIMIT 3)`, [req.user.id]);
    const url = `${req.protocol}://${req.get('host')}/rooms/background/${id}`;
    res.json({ url });
  } catch (e) {
    console.error('[roomBg]', e);
    res.status(500).json({ error: 'Server error' });
  }
});

router.get('/background/:id', async (req, res) => {
  try {
    if (!/^[0-9a-f-]{36}$/.test(req.params.id)) return res.status(400).end();
    const r = await db.query('SELECT mime, data FROM room_backgrounds WHERE id = $1', [req.params.id]);
    if (!r.rows[0]) return res.status(404).end();
    res.set('Content-Type', r.rows[0].mime);
    res.set('Cache-Control', 'public, max-age=604800, immutable');
    res.send(r.rows[0].data);
  } catch (e) {
    console.error('[roomBg]', e);
    res.status(500).end();
  }
});

module.exports = { router, parseImageDataUrl, MAX_BG_BYTES };
