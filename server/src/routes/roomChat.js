// ══════════════════════════════════════════════════════════════
// Өрөөний чатын түүх (2026-10-02, эзний хүсэлт) — платформын «Мессеж» шиг байнга хадгална.
// Өмнө нь зөвхөн санах ойд сүүлийн 100 мессеж байж сервер дахин асахад устдаг байв.
//  • room_messages: өрөө бүрийн бүх мессеж (нийтийн Room 1–20 г.м. хэзээ ч устахгүй).
//  • Өрөөнд орох үед сүүлийн HISTORY_LIMIT; дээш гүйлгэхэд room:history_more-оор өмнөхийг нь.
//  • Устгасан өрөөний (rooms-д байхгүй) мессежийг 30 хоногийн дараа цэвэрлэнэ.
// ══════════════════════════════════════════════════════════════
let db;
try { db = require('../config/db'); } catch { db = null; }
const { sanitizeReplyTo } = require('./social');

const HISTORY_LIMIT = 200;
const PAGE_LIMIT = 100;

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }

async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS room_messages (
        id          BIGSERIAL PRIMARY KEY,
        room_id     INTEGER NOT NULL,
        user_id     INTEGER,
        username    VARCHAR(64) NOT NULL,
        text        TEXT NOT NULL,
        reply_to    JSONB,
        system      BOOLEAN DEFAULT FALSE,
        deleted     BOOLEAN DEFAULT FALSE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_room_messages_room_time ON room_messages (room_id, created_at DESC, id DESC);
    `);
  } catch (e) { console.error('[Migration] room_messages:', e.message); }
}

const toMsg = (r) => ({
  userId:   r.user_id,
  username: r.username,
  text:     r.deleted ? '[Устгагдсан мессеж]' : r.text,
  time:     r.created_at instanceof Date ? r.created_at.toISOString() : new Date(r.created_at).toISOString(),
  ...(r.system ? { system: true } : {}),
  ...(!r.deleted && sanitizeReplyTo(r.reply_to) ? { replyTo: sanitizeReplyTo(r.reply_to) } : {}),
});

// msg.time (ISO) → created_at — in-memory/клиентийн time-тай яг таарна (устгал time-аар)
async function save(roomId, msg) {
  if (!db || !Number.isInteger(Number(roomId))) return;
  try {
    await db.query(
      `INSERT INTO room_messages (room_id, user_id, username, text, reply_to, system, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, COALESCE($7::timestamptz, NOW()))`,
      [Number(roomId), msg.userId ? Number(msg.userId) || null : null, String(msg.username || '').slice(0, 64), String(msg.text || ''),
       msg.replyTo ? JSON.stringify(msg.replyTo) : null, !!msg.system, msg.time || null]
    );
  } catch (e) { console.error('[roomChat] save:', e.message); }
}

// Хамгийн сүүлийн `limit` (before өгвөл түүнээс өмнөх) — хуучин→шинэ дарааллаар. DB алга бол null.
async function history(roomId, { limit = HISTORY_LIMIT, before = null } = {}) {
  if (!db || !Number.isInteger(Number(roomId))) return null;
  try {
    const n = Math.max(1, Math.min(500, Number(limit) || HISTORY_LIMIT));
    const r = before
      ? await db.query(
        `SELECT * FROM (SELECT * FROM room_messages WHERE room_id = $1 AND created_at < $2::timestamptz
           ORDER BY created_at DESC, id DESC LIMIT $3) t ORDER BY created_at ASC, id ASC`, [Number(roomId), before, n])
      : await db.query(
        `SELECT * FROM (SELECT * FROM room_messages WHERE room_id = $1
           ORDER BY created_at DESC, id DESC LIMIT $2) t ORDER BY created_at ASC, id ASC`, [Number(roomId), n]);
    return r.rows.map(toMsg);
  } catch (e) { console.error('[roomChat] history:', e.message); return null; }
}

async function markDeleted(roomId, userId, time) {
  if (!db) return 0;
  try {
    const r = await db.query('UPDATE room_messages SET deleted = TRUE WHERE room_id = $1 AND user_id = $2 AND created_at = $3::timestamptz',
      [Number(roomId), Number(userId), time]);
    return r.rowCount || 0;
  } catch (e) { console.error('[roomChat] delete:', e.message); return 0; }
}

// Устгагдсан өрөөний мессеж (30 хоногоос хуучин) — өдөрт нэг
async function cleanupOrphans() {
  if (!db) return;
  try {
    const r = await db.query(`DELETE FROM room_messages m WHERE m.created_at < NOW() - INTERVAL '30 days'
      AND NOT EXISTS (SELECT 1 FROM rooms r WHERE r.id = m.room_id)`);
    if (r.rowCount) console.log(`[roomChat] устгагдсан өрөөний ${r.rowCount} хуучин мессеж цэвэрлэв`);
  } catch (e) { console.error('[roomChat] cleanup:', e.message); }
}

module.exports = { ensureTables, save, history, markDeleted, cleanupOrphans, HISTORY_LIMIT, PAGE_LIMIT };
