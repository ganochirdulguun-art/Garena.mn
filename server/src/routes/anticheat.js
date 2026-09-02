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

module.exports = router;
module.exports.recordMaphackWarning = recordMaphackWarning;
