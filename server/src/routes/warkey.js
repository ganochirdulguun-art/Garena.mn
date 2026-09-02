const express = require('express');
const authMW = require('../middleware/auth');
const { isOwnerUser } = require('../middleware/admin');

let db;
try { db = require('../config/db'); } catch { db = null; }

const router = express.Router();

async function dbOk() {
  if (!db) return false;
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

// WarKey бүрэн эрх (entitled): GarenaSystem тэмцээний ТҮҮХ-тэй хүн WarKey-г хаана ч
// (GameRanger, PC төв, LAN) чөлөөтэй ашиглана. Түүхгүй энгийн хэрэглэгч зөвхөн
// Garena.mn платформтой хослуулж ашиглана (платформ клиент нь локал дохио бичдэг).
// "Тэмцээний түүх" = GarenaSystem-с sync хийсэн бичлэг = wins + losses > 0.
// (Эзэн/админ үргэлж эрхтэй.)
async function isEntitled(reqUser) {
  try {
    if (isOwnerUser(reqUser)) return true;
  } catch { /* owner шалгалт эмзэг биш */ }
  if (!reqUser?.id || !(await dbOk())) return false;
  try {
    const r = await db.query(
      'SELECT (COALESCE(wins,0) + COALESCE(losses,0)) AS games FROM users WHERE id = $1',
      [reqUser.id]
    );
    return (r.rows[0]?.games || 0) > 0;
  } catch (e) {
    console.error('[WarKey] entitled:', e.message);
    return false;
  }
}

// WarKey desktop апп нээлттэй байх хугацаанд тогтмол дуудна. Токеныг баталгаажуулж,
// хэрэглэгчийг бүртгэн last_seen-ийг шинэчилнэ. Зөвхөн Discord-той акаунт бүртгэгдэнэ.
router.post('/heartbeat', authMW, async (req, res) => {
  const version = String(req.body?.version || '').trim().slice(0, 50) || null;

  if (!req.user?.discord_id) {
    return res.status(400).json({ error: 'Discord login required' });
  }
  if (!(await dbOk())) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  // Хориглосон хэрэглэгч бол апп ашиглах боломжгүй — бүртгэхгүй, тусгай хариу буцаана.
  try {
    const banned = await db.query('SELECT 1 FROM warkey_bans WHERE discord_id = $1', [String(req.user.discord_id)]);
    if (banned.rows.length > 0) {
      return res.status(403).json({ error: 'banned' });
    }
  } catch (e) {
    console.error('[WarKey] ban check:', e.message);
  }

  try {
    await db.query(
      `INSERT INTO warkey_users (discord_id, username, version, first_seen, last_seen)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (discord_id) DO UPDATE SET
         username  = COALESCE(EXCLUDED.username, warkey_users.username),
         version   = COALESCE(EXCLUDED.version, warkey_users.version),
         last_seen = NOW()`,
      [String(req.user.discord_id), req.user.username || null, version]
    );
    const entitled = await isEntitled(req.user);
    res.json({ ok: true, entitled });
  } catch (e) {
    console.error('[WarKey] heartbeat:', e.message);
    res.status(500).json({ error: 'Failed to record heartbeat' });
  }
});

// Апп эхлэхэд токен хүчинтэй эсэхийг шалгах хөнгөн endpoint.
router.get('/me', authMW, async (req, res) => {
  if (!req.user?.discord_id) {
    return res.status(400).json({ error: 'Discord login required' });
  }
  const entitled = await isEntitled(req.user);
  res.json({ discord_id: req.user.discord_id, username: req.user.username, entitled });
});

module.exports = router;
