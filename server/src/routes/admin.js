const express = require('express');
const path = require('path');
const adminMW = require('../middleware/admin');
const { adminDiscordIds, isEnvAdmin } = adminMW;

const DISCORD_ID_RE = /^\d{5,25}$/;

let db;
try { db = require('../config/db'); } catch { db = null; }

const router = express.Router();

// index.js энд лобби дахь онлайн хэрэглэгчдийн жагсаалт авагчийг (onlineUsersList)
// оруулна — socket төлөв index.js-ийн scope-д амьдардаг тул шууд авах боломжгүй.
let presenceAccessor = () => [];
router.setPresence = (fn) => { presenceAccessor = typeof fn === 'function' ? fn : () => []; };

async function dbOk() {
  if (!db) return false;
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

function livePresence() {
  try { return presenceAccessor() || []; } catch { return []; }
}

// Dashboard HTML — нээлттэй бүрхүүл; ард нь байгаа API нь admin-gated.
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Discord OAuth-г admin горимоор эхлүүлэх (whitelist шалгалт callback дээр).
router.get('/login', (req, res) => {
  res.redirect('/auth/discord?admin=1');
});

// Би хэн бэ (admin эсэхийг баталгаажуулна).
router.get('/api/me', adminMW, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, discord_id: req.user.discord_id, is_owner: !!req.isOwner });
});

// Одоо онлайн байгаа хэрэглэгчид (real-time лоббиос).
router.get('/api/online', adminMW, (req, res) => {
  const users = livePresence();
  res.json({ count: users.length, users });
});

// Дээд талын тоон үзүүлэлтүүд.
router.get('/api/summary', adminMW, async (req, res) => {
  const online = livePresence();
  const summary = {
    online: online.length,
    inGame: online.filter((u) => u.status === 'in_game').length,
    inRoom: online.filter((u) => u.status === 'in_room').length,
    totalUsers: null,
    activeRooms: null,
  };
  if (await dbOk()) {
    try {
      const u = await db.query('SELECT COUNT(*)::int AS c FROM users');
      summary.totalUsers = u.rows[0].c;
      const r = await db.query("SELECT COUNT(*)::int AS c FROM rooms WHERE status IN ('waiting','playing')");
      summary.activeRooms = r.rows[0].c;
    } catch (e) {
      console.error('[Admin] summary:', e.message);
    }
  }
  res.json(summary);
});

// Бүх бүртгэлтэй хэрэглэгч + статистик, амьд онлайн төлөвтэй нэгтгэсэн.
router.get('/api/users', adminMW, async (req, res) => {
  const search = String(req.query.search || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  if (!(await dbOk())) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = 'WHERE username ILIKE $1 OR email ILIKE $1 OR discord_id ILIKE $1';
    }

    const totalRes = await db.query(`SELECT COUNT(*)::int AS c FROM users ${where}`, params);
    const rowsRes = await db.query(
      `SELECT id, username, email, discord_id, avatar_url, wins, losses, created_at,
              COALESCE(diamonds, 0) AS diamonds, COALESCE(level, 1) AS level, membership, membership_until
       FROM users ${where}
       ORDER BY created_at DESC NULLS LAST
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const statusByUser = new Map(livePresence().map((u) => [String(u.userId), u.status]));
    const { effectiveTier } = require('./membership');
    const users = rowsRes.rows.map((u) => ({
      ...u,
      tier: effectiveTier(u),
      games: (u.wins || 0) + (u.losses || 0),
      status: statusByUser.get(String(u.id)) || 'offline',
    }));

    res.json({ total: totalRes.rows[0].c, page, limit, users });
  } catch (e) {
    console.error('[Admin] users:', e.message);
    res.status(500).json({ error: 'Failed to load users' });
  }
});

// Хэрэглэгчийн нэр / хож / хожигдлыг засах (өгөгдсөн талбаруудыг л шинэчилнэ).
router.patch('/api/users/:id', adminMW, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id))
    return res.status(400).json({ error: 'Invalid id' });
  if (!(await dbOk()))
    return res.status(503).json({ error: 'Service temporarily unavailable' });

  const sets = [];
  const params = [];
  if (typeof req.body?.username === 'string' && req.body.username.trim()) {
    params.push(req.body.username.trim().slice(0, 255));
    sets.push(`username = $${params.length}`);
  }
  for (const field of ['wins', 'losses']) {
    if (req.body?.[field] === undefined) continue;
    const n = parseInt(req.body[field], 10);
    if (!Number.isInteger(n) || n < 0)
      return res.status(400).json({ error: `Invalid ${field}` });
    params.push(n);
    sets.push(`${field} = $${params.length}`);
  }
  if (sets.length === 0)
    return res.status(400).json({ error: 'Nothing to update' });

  params.push(id);
  try {
    const r = await db.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, username, wins, losses`,
      params
    );
    if (r.rows.length === 0)
      return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, user: r.rows[0] });
  } catch (e) {
    console.error('[Admin] update user:', e.message);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Хэрэглэгчийг устгах (өрөө/тоглолт/мессеж зэрэг нь ON DELETE CASCADE-аар цуг арилна).
router.delete('/api/users/:id', adminMW, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id))
    return res.status(400).json({ error: 'Invalid id' });
  if (!(await dbOk()))
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const r = await db.query('DELETE FROM users WHERE id = $1', [id]);
    if (r.rowCount === 0)
      return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, removed: r.rowCount });
  } catch (e) {
    console.error('[Admin] delete user:', e.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ── WarKey desktop апп-ын хэрэглэгчид ──────────────────────────────────────
// Онлайн = сүүлийн 2 минутад heartbeat илгээсэн (апп нээлттэй).
router.get('/api/warkey/summary', adminMW, async (req, res) => {
  if (!(await dbOk())) return res.json({ online: 0, total: 0 });
  try {
    const online = await db.query(
      "SELECT COUNT(*)::int AS c FROM warkey_users WHERE last_seen > NOW() - INTERVAL '2 minutes'"
    );
    const total = await db.query('SELECT COUNT(*)::int AS c FROM warkey_users');
    res.json({ online: online.rows[0].c, total: total.rows[0].c });
  } catch (e) {
    console.error('[Admin] warkey summary:', e.message);
    res.json({ online: 0, total: 0 });
  }
});

router.get('/api/warkey/users', adminMW, async (req, res) => {
  const search = String(req.query.search || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  if (!(await dbOk())) return res.status(503).json({ error: 'Service temporarily unavailable' });

  try {
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      where = 'WHERE w.discord_id ILIKE $1 OR w.username ILIKE $1';
    }

    const totalRes = await db.query(`SELECT COUNT(*)::int AS c FROM warkey_users w ${where}`, params);
    const rowsRes = await db.query(
      `SELECT w.discord_id,
              COALESCE(u.username, w.username) AS username,
              u.avatar_url,
              w.version,
              w.first_seen,
              w.last_seen,
              (w.last_seen > NOW() - INTERVAL '2 minutes') AS online
       FROM warkey_users w
       LEFT JOIN users u ON u.discord_id = w.discord_id
       ${where}
       ORDER BY w.last_seen DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ total: totalRes.rows[0].c, page, limit, users: rowsRes.rows });
  } catch (e) {
    console.error('[Admin] warkey users:', e.message);
    res.status(500).json({ error: 'Failed to load WarKey users' });
  }
});

// WarKey хэрэглэгчийг устгах = ХОРИГЛОХ. Тухайн хэрэглэгч апп ашиглах боломжгүй болж,
// "устгасан" жагсаалтад орно. warkey_users-ээс хасаж, warkey_bans-д бүртгэнэ.
router.delete('/api/warkey/users/:discordId', adminMW, async (req, res) => {
  const discordId = String(req.params.discordId || '').trim();
  if (!discordId)
    return res.status(400).json({ error: 'Invalid id' });
  if (!(await dbOk()))
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const existing = await db.query('SELECT username, version FROM warkey_users WHERE discord_id = $1', [discordId]);
    const u = existing.rows[0] || {};
    await db.query(
      `INSERT INTO warkey_bans (discord_id, username, version, banned_by, banned_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (discord_id) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, warkey_bans.username),
         version = COALESCE(EXCLUDED.version, warkey_bans.version),
         banned_by = EXCLUDED.banned_by, banned_at = NOW()`,
      [discordId, u.username || null, u.version || null, req.user.discord_id || null]
    );
    await db.query('DELETE FROM warkey_users WHERE discord_id = $1', [discordId]);
    res.json({ ok: true, banned: true });
  } catch (e) {
    console.error('[Admin] ban warkey user:', e.message);
    res.status(500).json({ error: 'Failed to ban WarKey user' });
  }
});

// Хориглосон (устгасан) WarKey хэрэглэгчид.
router.get('/api/warkey/banned', adminMW, async (req, res) => {
  if (!(await dbOk())) return res.json({ users: [] });
  try {
    const r = await db.query(
      `SELECT b.discord_id, COALESCE(u.username, b.username) AS username, u.avatar_url,
              b.version, b.banned_by, b.banned_at
       FROM warkey_bans b
       LEFT JOIN users u ON u.discord_id = b.discord_id
       ORDER BY b.banned_at DESC`
    );
    res.json({ users: r.rows });
  } catch (e) {
    console.error('[Admin] warkey banned list:', e.message);
    res.json({ users: [] });
  }
});

// Сэргээх (хоригийг устгах) — хэрэглэгч дахин апп ашиглах боломжтой болно.
router.delete('/api/warkey/banned/:discordId', adminMW, async (req, res) => {
  const discordId = String(req.params.discordId || '').trim();
  if (!discordId)
    return res.status(400).json({ error: 'Invalid id' });
  if (!(await dbOk()))
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const r = await db.query('DELETE FROM warkey_bans WHERE discord_id = $1', [discordId]);
    if (r.rowCount === 0)
      return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, restored: r.rowCount });
  } catch (e) {
    console.error('[Admin] restore warkey user:', e.message);
    res.status(500).json({ error: 'Failed to restore WarKey user' });
  }
});

// ── Админ эрх удирдах ─────────────────────────────────────────────────────
// env-ийн үндсэн админууд (locked) + DB-ийн динамик админуудыг нэгтгэж жагсаана.
router.get('/api/admins', adminMW, async (req, res) => {
  const envAdmins = adminDiscordIds().map((discord_id) => ({
    discord_id, note: 'ADMIN_DISCORD_IDS (env)', source: 'env', locked: true,
  }));

  let dbAdmins = [];
  if (await dbOk()) {
    try {
      const r = await db.query(
        'SELECT discord_id, note, added_by, created_at FROM admin_whitelist ORDER BY created_at DESC'
      );
      // env-д давхардсаныг DB талаас нуух (env нь дийлдэнэ)
      const envSet = new Set(adminDiscordIds());
      dbAdmins = r.rows
        .filter((a) => !envSet.has(String(a.discord_id)))
        .map((a) => ({ ...a, source: 'db', locked: false }));
    } catch (e) {
      console.error('[Admin] list admins:', e.message);
    }
  }

  res.json({ admins: [...envAdmins, ...dbAdmins] });
});

// Discord ID-аар шинэ админ нэмэх.
router.post('/api/admins', adminMW, async (req, res) => {
  const discordId = String(req.body?.discord_id || '').trim();
  const note = String(req.body?.note || '').trim().slice(0, 200);

  if (!DISCORD_ID_RE.test(discordId)) {
    return res.status(400).json({ error: 'Discord ID нь 5-25 оронтой тоо байх ёстой' });
  }
  if (isEnvAdmin(discordId)) {
    return res.status(409).json({ error: 'Энэ ID аль хэдийн env үндсэн админ байна' });
  }
  if (!(await dbOk())) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  try {
    await db.query(
      `INSERT INTO admin_whitelist (discord_id, note, added_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (discord_id) DO UPDATE SET note = EXCLUDED.note`,
      [discordId, note, req.user.discord_id || null]
    );
    res.status(201).json({ ok: true, discord_id: discordId });
  } catch (e) {
    console.error('[Admin] add admin:', e.message);
    res.status(500).json({ error: 'Failed to add admin' });
  }
});

// Динамик админыг хасах (env үндсэн админыг хасах боломжгүй).
router.delete('/api/admins/:discordId', adminMW, async (req, res) => {
  const discordId = String(req.params.discordId || '').trim();

  if (isEnvAdmin(discordId)) {
    return res.status(400).json({ error: 'Үндсэн (env) админыг энд хасах боломжгүй — серверийн ADMIN_DISCORD_IDS-ээс хасна' });
  }
  if (!(await dbOk())) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  try {
    const r = await db.query('DELETE FROM admin_whitelist WHERE discord_id = $1', [discordId]);
    res.json({ ok: true, removed: r.rowCount });
  } catch (e) {
    console.error('[Admin] remove admin:', e.message);
    res.status(500).json({ error: 'Failed to remove admin' });
  }
});

module.exports = router;
