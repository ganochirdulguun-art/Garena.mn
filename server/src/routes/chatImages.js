'use strict';
// Чатын зураг (2026-10-03, эзэн): лобби ба Room чатад screenshot → Ctrl+V. Бүх хэрэглэгч илгээнэ.
//  • Клиент шахаад (≤1024px JPEG) raw-аар POST /chat/image → chat_images (bytea, Railway-д volume алга) → { key }.
//    Мессеж нь зөвхөн key-г (32 hex) авч явна — чатын түүх (lobby_messages/room_messages.image) хавдахгүй.
//  • GET /chat/image/:key — immutable кэш (ETag + max-age 14 хоног): клиент нэг удаа л татна → сервер ачаалал бага.
//  • Давхардал: sha256 ижил зураг нэг л удаа хадгалагдана; нэг scope-д (лобби / тухайн Room) 24 цагт ижил зураг
//    дахин илгээвэл ТАТГАЛЗАНА (эзэн: «1 зургийг 1-ээс илүү спамдвал илүүг нь автоматаар хас»).
//  • Хадгалах хугацаа 14 хоног + нийт 300MB дээд хязгаар (хуучнаас нь устгана) — 6 цаг тутам цэвэрлэнэ.
//  • Хурд: нэг хэрэглэгч минутад 5 зураг; 1 зураг ≤ 2MB; зөвхөн jpeg/png/webp/gif (sniff — content-type-д итгэхгүй).
const express = require('express');
const crypto = require('crypto');
const db = require('../config/db');
const auth = require('../middleware/auth');
const { sniff } = require('./banner');

const router = express.Router();
const MAX_BYTES = 2 * 1024 * 1024;
const KEEP_DAYS = 14;
const TOTAL_CAP_BYTES = 300 * 1024 * 1024;
const PER_MIN = 5;
const DUP_WINDOW = '24 hours';
const KEY_RE = /^[a-f0-9]{32}$/;

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }

async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS chat_images (
        key        VARCHAR(32) PRIMARY KEY,
        sha256     CHAR(64) UNIQUE NOT NULL,
        user_id    INTEGER,
        mime       VARCHAR(32) NOT NULL,
        size       INTEGER NOT NULL,
        bytes      BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_chat_images_time ON chat_images (created_at);
      ALTER TABLE lobby_messages ADD COLUMN IF NOT EXISTS image VARCHAR(32);
      ALTER TABLE room_messages ADD COLUMN IF NOT EXISTS image VARCHAR(32);
    `);
  } catch (e) { console.error('[chatImages] ensureTables:', e.message); }
}

// Минутын хурдны хязгаар (санах ойд)
const uploads = new Map();   // userId -> [ts...]
function overRate(userId) {
  const now = Date.now(); const id = String(userId);
  const arr = (uploads.get(id) || []).filter((t) => now - t < 60_000);
  if (arr.length >= PER_MIN) { uploads.set(id, arr); return true; }
  arr.push(now); uploads.set(id, arr);
  if (uploads.size > 5000) uploads.delete(uploads.keys().next().value);
  return false;
}

// POST /chat/image — raw bytes → { key, dup }
router.post('/image', auth, express.raw({ type: () => true, limit: MAX_BYTES }), async (req, res) => {
  const buf = req.body;
  if (!Buffer.isBuffer(buf) || !buf.length) return res.status(400).json({ error: 'Зураг хоосон байна' });
  if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'Зураг 2MB-с ихгүй байх ёстой' });
  const mime = sniff(buf);
  if (!mime) return res.status(415).json({ error: 'Зөвхөн JPEG/PNG/WebP/GIF зураг' });
  if (overRate(req.user.id)) return res.status(429).json({ error: `Минутад ${PER_MIN}-аас илүү зураг илгээхгүй` });
  if (!await dbOk()) return res.status(503).json({ error: 'DB түр ажиллахгүй байна' });
  try {
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    const key = crypto.randomBytes(16).toString('hex');
    // Ижил зураг аль хэдийн байвал хуучин key-г буцаана (давхар хадгалахгүй)
    const r = await db.query(
      `INSERT INTO chat_images (key, sha256, user_id, mime, size, bytes) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (sha256) DO UPDATE SET sha256 = EXCLUDED.sha256 RETURNING key, (xmax = 0) AS is_new`,
      [key, sha, req.user.id, mime, buf.length, buf]);
    const row = r.rows[0];
    return res.json({ key: row.key, dup: !row.is_new, size: buf.length });
  } catch (e) { console.error('[chatImages] upload:', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// GET /chat/image/:key — нийтэд (key таах боломжгүй 128 бит); immutable кэш
router.get('/image/:key', async (req, res) => {
  const key = String(req.params.key || '');
  if (!KEY_RE.test(key)) return res.status(404).end();
  if (req.headers['if-none-match'] === `"${key}"`) return res.status(304).end();
  if (!await dbOk()) return res.status(503).end();
  try {
    const r = await db.query('SELECT mime, bytes FROM chat_images WHERE key = $1', [key]);
    if (!r.rows[0]) return res.status(404).end();
    res.set({ 'Content-Type': r.rows[0].mime, ETag: `"${key}"`, 'Cache-Control': `public, max-age=${KEEP_DAYS * 86400}, immutable`, 'X-Content-Type-Options': 'nosniff' });
    return res.end(r.rows[0].bytes);
  } catch (e) { console.error('[chatImages] get:', e.message); return res.status(500).end(); }
});

/** Зураг байгаа эсэх (мессеж илгээхийн өмнө шалгана). */
async function exists(key) {
  if (!KEY_RE.test(String(key || '')) || !db) return false;
  try { const r = await db.query('SELECT 1 FROM chat_images WHERE key = $1', [key]); return !!r.rows[0]; } catch { return false; }
}

/** Нэг scope-д (лобби / Room) 24 цагийн дотор ижил зураг аль хэдийн илгээгдсэн үү — давхардлыг татгалзана. */
async function isDuplicate(scope, key, roomId = null) {
  if (!db) return false;
  try {
    const r = scope === 'room'
      ? await db.query(`SELECT 1 FROM room_messages WHERE room_id = $1 AND image = $2 AND NOT COALESCE(deleted, FALSE) AND created_at > NOW() - INTERVAL '${DUP_WINDOW}' LIMIT 1`, [Number(roomId), key])
      : await db.query(`SELECT 1 FROM lobby_messages WHERE image = $1 AND NOT COALESCE(deleted, FALSE) AND created_at > NOW() - INTERVAL '${DUP_WINDOW}' LIMIT 1`, [key]);
    return !!r.rows[0];
  } catch { return false; }
}

/** 14 хоногоос хуучин + нийт 300MB-аас давсан хуучныг устгана. */
async function cleanup() {
  if (!await dbOk()) return 0;
  let n = 0;
  try {
    const a = await db.query(`DELETE FROM chat_images WHERE created_at < NOW() - INTERVAL '${KEEP_DAYS} days'`);
    n += a.rowCount || 0;
    const t = await db.query('SELECT COALESCE(SUM(size), 0)::bigint AS total FROM chat_images');
    let total = Number(t.rows[0]?.total || 0);
    if (total > TOTAL_CAP_BYTES) {
      const rows = await db.query('SELECT key, size FROM chat_images ORDER BY created_at ASC LIMIT 500');
      const del = [];
      for (const r of rows.rows) { if (total <= TOTAL_CAP_BYTES) break; del.push(r.key); total -= Number(r.size); }
      if (del.length) { const d = await db.query('DELETE FROM chat_images WHERE key = ANY($1)', [del]); n += d.rowCount || 0; }
    }
    if (n) console.log(`[chatImages] cleanup: ${n} зураг устгав`);
  } catch (e) { console.error('[chatImages] cleanup:', e.message); }
  return n;
}

module.exports = { router, ensureTables, exists, isDuplicate, cleanup, KEY_RE, MAX_BYTES, KEEP_DAYS, PER_MIN, _overRate: overRate };
