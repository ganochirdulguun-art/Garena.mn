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

module.exports = router;
