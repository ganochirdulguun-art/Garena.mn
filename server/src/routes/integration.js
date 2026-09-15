// ── GarenaSystem бот ↔ платформ интеграцийн API (x-api-key = TIERBOT_API_KEY, ботын RANKING_API_KEY-тэй ижил) ──
// GET /integration/discord-users — Discord-оор бүртгэлтэй (discord_id-тай) платформын хэрэглэгчид.
// Бот үүгээр "Garena хэрэглэгч" role-ийг автоматаар олгож/хураана (garena_role.py). Баннтай хэрэглэгч тусгаарлагдана.
const express = require('express');
const { botKeyOk } = require('./anticheat');

let db;
try { db = require('../config/db'); } catch { db = null; }

const router = express.Router();

router.get('/discord-users', async (req, res) => {
  if (!botKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!db) return res.status(503).json({ error: 'db unavailable' });
  try {
    const { rows } = await db.query(
      `SELECT discord_id, username, COALESCE(banned, FALSE) AS banned, created_at
         FROM users
        WHERE discord_id IS NOT NULL AND discord_id <> ''
        ORDER BY id`
    );
    return res.json({ generated_at: new Date().toISOString(), count: rows.length, users: rows });
  } catch (e) {
    console.error('[Integration] discord-users:', e.message);
    return res.status(500).json({ error: 'query failed' });
  }
});

// GET /integration/same-ip?days=30&min=2 — нэг IP-аас холбогдсон ≥min хэрэглэгчийн бүлгүүд (last_seen days дотор).
// «Кафе/гэр/multi-account» илрүүлэхэд (!same_ip). ⚠️ Нэг IP = нэг хүн БИШ (CGNAT/кафе) — зөвхөн сэжиг.
router.get('/same-ip', async (req, res) => {
  if (!botKeyOk(req)) return res.status(401).json({ error: 'unauthorized' });
  if (!db) return res.status(503).json({ error: 'db unavailable' });
  const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
  const minUsers = Math.min(20, Math.max(2, parseInt(req.query.min) || 2));
  try {
    const { rows } = await db.query(
      `SELECT ui.ip, u.id, u.discord_id, u.username, ui.last_seen, ui.hits
         FROM user_ips ui JOIN users u ON u.id = ui.user_id
        WHERE ui.last_seen > NOW() - ($1 || ' days')::interval
          AND ui.ip IN (
            SELECT ip FROM user_ips
             WHERE last_seen > NOW() - ($1 || ' days')::interval
             GROUP BY ip HAVING COUNT(DISTINCT user_id) >= $2)
        ORDER BY ui.ip, ui.last_seen DESC`,
      [String(days), minUsers]);
    const byIp = new Map();
    for (const r of rows) {
      if (!byIp.has(r.ip)) byIp.set(r.ip, []);
      byIp.get(r.ip).push({ id: r.id, discord_id: r.discord_id, username: r.username, last_seen: r.last_seen, hits: r.hits });
    }
    const groups = [...byIp.entries()]
      .map(([ip, users]) => ({ ip, users }))
      .sort((a, b) => b.users.length - a.users.length);
    return res.json({ generated_at: new Date().toISOString(), days, min_users: minUsers, group_count: groups.length, groups });
  } catch (e) {
    console.error('[Integration] same-ip:', e.message);
    return res.status(500).json({ error: 'query failed' });
  }
});

module.exports = router;
