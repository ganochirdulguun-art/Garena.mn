// MapHack анти-чит: платформ клиент тоглолт эхлэхэд процесс скан хийж, maphack хэрэгсэл
// (xenon, zodcraft, …) илэрвэл энд мэдэгдэнэ. Сануулгыг тоолж, 3 болоход автоматаар
// платформоос бандана. Оролдлого бүрт GarenaSystem-ээр дамжуулан эзэнд DM илгээнэ.
const express = require('express');
const axios = require('axios');
const authMW = require('../middleware/auth');
const { tierBotHelpers: h } = require('./stats');

let db;
try { db = require('../config/db'); } catch { db = null; }

const router = express.Router();

const WARN_LIMIT = 3;
// Мэдэгдэж буй maphack хэрэгслүүд. Нэр/цонхны гарчигт агуулагдвал илэрнэ.
// MAPHACK_BLOCKLIST env-ээр нэмж өргөтгөнө (client дахин билдгүйгээр шинэчилнэ).
const DEFAULT_BLOCKLIST = ['xenon', 'zodcraft'];

function blocklist() {
  const extra = String(process.env.MAPHACK_BLOCKLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [...new Set([...DEFAULT_BLOCKLIST, ...extra])];
}

async function dbOk() {
  if (!db) return false;
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

// GarenaSystem руу эзэнд DM alert — ranking export-ийн base URL + X-API-Key дахин ашиглана.
async function alertGarenaSystem(payload) {
  let base = null;
  try {
    const u = h.tierBotSourceUrl(null);
    if (u) base = u.replace(/\/api\/export\/ranking.*$/i, '');
  } catch { /* тохируулаагүй */ }
  if (!base) return;
  try {
    await axios.post(`${base}/api/anticheat/alert`, payload, { headers: h.tierBotHeaders(), timeout: 8000 });
  } catch (e) {
    console.warn('[AntiCheat] GarenaSystem alert:', e.message);
  }
}

// Клиент скан хийхэд ашиглах хориотой процессуудын жагсаалт (нэвтэрсэн хэрэглэгчид)
router.get('/blocklist', authMW, (req, res) => {
  res.json({ processes: blocklist(), warn_limit: WARN_LIMIT });
});

// Нэг хэрэглэгчийн MapHack сануулгыг +1 хийж, 3-т бан, эзэнд DM. Бусад модуль ч дуудна
// (replay-с FOGCLICK илрэлт — results.js). Буцаана: { warnings, banned } эсвэл null.
async function recordMaphackWarning(userId, tool) {
  if (!userId || !(await dbOk())) return null;
  const t = String(tool || 'unknown').slice(0, 64);
  try {
    const upd = await db.query(
      `UPDATE users SET maphack_warnings = COALESCE(maphack_warnings, 0) + 1
       WHERE id = $1
       RETURNING maphack_warnings, discord_id, username, COALESCE(banned, FALSE) AS banned`,
      [userId]
    );
    const row = upd.rows[0] || {};
    const warnings = row.maphack_warnings || 1;
    let banned = !!row.banned;
    if (warnings >= WARN_LIMIT && !banned) {
      await db.query(
        `UPDATE users SET banned = TRUE, ban_reason = $2, banned_at = NOW() WHERE id = $1`,
        [userId, `MapHack: ${t}`]
      );
      banned = true;
    }
    try {
      await db.query('INSERT INTO maphack_events (user_id, tool, warnings, banned) VALUES ($1, $2, $3, $4)', [userId, t, warnings, banned]);
    } catch (e) { console.warn('[AntiCheat] event log:', e.message); }
    alertGarenaSystem({ discord_id: row.discord_id, username: row.username, tool: t, warnings, banned }).catch(() => {});
    console.log(`[AntiCheat] MapHack "${t}" — user #${userId} (${row.username}) сануулга ${warnings}/${WARN_LIMIT}${banned ? ' → БАН' : ''}`);
    return { warnings, banned };
  } catch (e) {
    console.error('[AntiCheat] recordMaphackWarning:', e.message);
    return null;
  }
}

// MapHack илрэлт мэдэгдэх: сануулга +1, 3 болоход бан, эзэнд DM.
router.post('/report', authMW, async (req, res) => {
  if (!req.user?.id) return res.status(400).json({ error: 'auth required' });
  const tool = String(req.body?.tool || 'unknown').slice(0, 64);
  const r = await recordMaphackWarning(req.user.id, tool);
  if (!r) return res.status(503).json({ error: 'db unavailable' });
  return res.json({ warnings: r.warnings, banned: r.banned, max: WARN_LIMIT });
});

// ── GarenaSystem ботын `!maphack` команд (эзэн): жагсаалт + сануулга тэглэх/бан цуцлах ──
// Хамгаалалт: x-api-key === TIERBOT_API_KEY (бот↔платформын хамтын нууц; бот талд RANKING_API_KEY).
const crypto = require('crypto');
function botKeyOk(req) {
  const want = String(process.env.TIERBOT_API_KEY || '');
  const got = String(req.headers['x-api-key'] || '');
  if (!want || !got || want.length !== got.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

const LIST_SQL = `SELECT u.id, u.username, u.discord_id, u.wc3_name, COALESCE(u.maphack_warnings, 0) AS maphack_warnings,
                         COALESCE(u.banned, FALSE) AS banned, u.ban_reason, u.banned_at,
                         e.tool AS last_tool, e.created_at AS last_at,
                         (SELECT COUNT(*)::int FROM maphack_events x WHERE x.user_id = u.id) AS events_total
                    FROM users u
               LEFT JOIN LATERAL (SELECT tool, created_at FROM maphack_events m WHERE m.user_id = u.id ORDER BY created_at DESC LIMIT 1) e ON TRUE
                   WHERE COALESCE(u.maphack_warnings, 0) > 0 OR COALESCE(u.banned, FALSE)
                ORDER BY COALESCE(u.banned, FALSE) DESC, COALESCE(u.maphack_warnings, 0) DESC, e.created_at DESC NULLS LAST, u.id
                   LIMIT 200`;

// Сүүлийн N илрэлт (хугацааны дараалал) — тайланд "сүүлийн үйл явдлууд" хэсэг
const EVENTS_SQL = `SELECT m.created_at, m.tool, m.warnings, m.banned, u.username, u.discord_id
                      FROM maphack_events m JOIN users u ON u.id = m.user_id
                  ORDER BY m.created_at DESC LIMIT 15`;

// Сануулгатай / бантай хэрэглэгчдийн жагсаалт
router.get('/list', async (req, res) => {
  if (!botKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!(await dbOk())) return res.status(503).json({ error: 'db unavailable' });
  try {
    const { rows } = await db.query(LIST_SQL);
    let events = [];
    try { events = (await db.query(EVENTS_SQL)).rows; } catch { /* хүснэгт хараахан үүсээгүй */ }
    return res.json({ warn_limit: WARN_LIMIT, blocklist: blocklist(), users: rows, events });
  } catch (e) {
    console.error('[AntiCheat] list:', e.message);
    return res.status(500).json({ error: 'list failed' });
  }
});

// Сануулгыг тэглэж, бантай бол бан цуцална. body: { discord_id | user_id | username }
router.post('/reset', async (req, res) => {
  if (!botKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!(await dbOk())) return res.status(503).json({ error: 'db unavailable' });
  const b = req.body || {};
  const by = String(b.by || 'GarenaSystem').slice(0, 64);
  let where = null; let param = null;
  if (b.user_id && /^\d+$/.test(String(b.user_id))) { where = 'id = $1'; param = Number(b.user_id); }
  else if (b.discord_id && /^\d{5,32}$/.test(String(b.discord_id))) { where = 'discord_id = $1'; param = String(b.discord_id); }
  else if (b.username) { where = 'LOWER(username) = LOWER($1)'; param = String(b.username).slice(0, 255); }
  if (!where) return res.status(400).json({ error: 'user_id, discord_id эсвэл username хэрэгтэй' });
  try {
    const found = await db.query(`SELECT id, username, discord_id, COALESCE(maphack_warnings, 0) AS maphack_warnings, COALESCE(banned, FALSE) AS banned, ban_reason FROM users WHERE ${where}`, [param]);
    if (!found.rows.length) return res.status(404).json({ error: 'not found' });
    if (found.rows.length > 1) return res.status(409).json({ error: 'ambiguous', candidates: found.rows.map((r) => ({ id: r.id, username: r.username })) });
    const u = found.rows[0];
    // Зөвхөн MapHack-ийн банг цуцална — өөр шалтгаантай (гараар) банг хөндөхгүй
    const mhBan = u.banned && /^MapHack/i.test(String(u.ban_reason || ''));
    await db.query(
      `UPDATE users SET maphack_warnings = 0
          ${mhBan ? ', banned = FALSE, ban_reason = NULL, banned_at = NULL' : ''}
        WHERE id = $1`, [u.id]
    );
    console.log(`[AntiCheat] reset — user #${u.id} (${u.username}) сануулга ${u.maphack_warnings}→0${mhBan ? ', бан цуцлав' : ''} — ${by}`);
    return res.json({ ok: true, user: { id: u.id, username: u.username, discord_id: u.discord_id }, previous_warnings: u.maphack_warnings, unbanned: mhBan, still_banned: u.banned && !mhBan, ban_reason: u.ban_reason || null });
  } catch (e) {
    console.error('[AntiCheat] reset:', e.message);
    return res.status(500).json({ error: 'reset failed' });
  }
});

module.exports = router;
module.exports.recordMaphackWarning = recordMaphackWarning;
module.exports.botKeyOk = botKeyOk;
