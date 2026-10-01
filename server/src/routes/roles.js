// ══════════════════════════════════════════════════════════════
// Платформын цол (2026-10-02): Moderator — нийтийн Room 1–20-д LAN тоглоом нээх (host) эрх.
//  • Хэрэглэгч «Moderator авах» хүсэлт илгээнэ → эзэн (эхний ээлжинд) / админ батална эсвэл татгалзана.
//  • Шинэ хүсэлт ирэхэд эзэн/админуудын socket руу 'staff:notify' (апп-д тэмдэг + дуу).
//  • Цаашид (Ш2): Admin / Manager цол, kick лог, бан хүсэлт энэ модульд нэмэгдэнэ.
// ══════════════════════════════════════════════════════════════
const express = require('express');
const auth = require('../middleware/auth');
const adminMW = require('../middleware/admin');

let db;
try { db = require('../config/db'); } catch { db = null; }
const router = express.Router();
let _io = null;
function setIO(io) { _io = io; }
const NOTE_MAX = 300;
// Moderator-уудын санах ойн жагсаалт — өрөөний гишүүдийн «MOD» тэмдэгт (DB асуулгагүй, хурдан)
const modSet = new Set();
async function loadMods() { try { const r = await db.query("SELECT user_id FROM platform_roles WHERE role = 'moderator'"); modSet.clear(); r.rows.forEach((x) => modSet.add(String(x.user_id))); } catch {} }
function isModCached(userId) { return modSet.has(String(userId)); }

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }
async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS platform_roles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(16) NOT NULL,
      granted_by INTEGER,
      granted_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`CREATE TABLE IF NOT EXISTS role_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(16) NOT NULL DEFAULT 'moderator',
      note TEXT DEFAULT '',
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      decided_by INTEGER,
      decided_at TIMESTAMPTZ,
      decision_note TEXT DEFAULT ''
    )`);
    await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS role_requests_one_pending ON role_requests (user_id, role) WHERE status = 'pending'`);
    await loadMods();
  } catch (e) { console.error('[Migration] roles:', e.message); }
  // Гишүүдийн идэвх (эзний самбар): сүүлд идэвхтэй байсан цаг + өрөө нээсэн түүх (өрөө устсан ч үлдэнэ)
  try {
    await db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ');
    await db.query(`CREATE TABLE IF NOT EXISTS room_log (
      room_id INTEGER PRIMARY KEY,
      host_id INTEGER,
      name VARCHAR(255),
      game_type VARCHAR(100),
      kind VARCHAR(16),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      closed_at TIMESTAMPTZ
    )`);
    await db.query('CREATE INDEX IF NOT EXISTS room_log_host ON room_log (host_id, created_at DESC)');
    await db.query(`CREATE TABLE IF NOT EXISTS kick_log (
      id SERIAL PRIMARY KEY,
      room_id INTEGER,
      target_id INTEGER,
      by_id INTEGER,
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await db.query(`
      CREATE OR REPLACE FUNCTION garena_room_log() RETURNS trigger AS $$
      BEGIN
        IF TG_OP = 'INSERT' THEN
          INSERT INTO room_log (room_id, host_id, name, game_type, kind, created_at)
          VALUES (NEW.id, NEW.host_id, NEW.name, NEW.game_type, COALESCE(NEW.kind, 'room'), NOW())
          ON CONFLICT (room_id) DO NOTHING;
          RETURN NEW;
        END IF;
        UPDATE room_log SET closed_at = NOW() WHERE room_id = OLD.id AND closed_at IS NULL;
        RETURN OLD;
      END; $$ LANGUAGE plpgsql;
    `);
    await db.query(`
      DROP TRIGGER IF EXISTS garena_room_log_ins ON rooms;
      CREATE TRIGGER garena_room_log_ins AFTER INSERT ON rooms FOR EACH ROW EXECUTE FUNCTION garena_room_log();
      DROP TRIGGER IF EXISTS garena_room_log_del ON rooms;
      CREATE TRIGGER garena_room_log_del AFTER DELETE ON rooms FOR EACH ROW EXECUTE FUNCTION garena_room_log();
    `);
  } catch (e) { console.error('[Migration] activity:', e.message); }
}

async function isStaff(user) { try { return await adminMW.isAdminUser(user); } catch { return false; } }
async function roleOf(userId) {
  if (!db || !userId) return null;
  try { const r = await db.query('SELECT role FROM platform_roles WHERE user_id = $1', [userId]); return r.rows[0]?.role || null; } catch { return null; }
}
// Room 1–20-д LAN тоглоом нээх эрх: Moderator эсвэл ажилтан (эзэн/админ)
async function canHostInChannel(user) {
  if (await isStaff(user)) return true;
  return (await roleOf(user.id)) === 'moderator';
}

async function pendingCount() {
  try { const r = await db.query("SELECT COUNT(*)::int AS n FROM role_requests WHERE status = 'pending'"); return r.rows[0]?.n || 0; } catch { return 0; }
}
// Эзэн/админуудын онлайн socket руу мэдэгдэл (user:<id> өрөөнд). Эзэн/админы id-г онлайн socket-оос шүүнэ.
async function notifyStaff(payload) {
  if (!_io) return;
  try {
    for (const s of _io.sockets.sockets.values()) {
      if (s.user && await isStaff(s.user)) s.emit('staff:notify', payload);
    }
  } catch {}
}

// Миний цол + хүлээгдэж буй хүсэлт
router.get('/me', auth, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const staff = await isStaff(req.user);
    const role = await roleOf(req.user.id);
    const p = await db.query("SELECT id, role, created_at FROM role_requests WHERE user_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1", [req.user.id]);
    return res.json({ role, staff, owner: adminMW.isOwnerUser(req.user), can_host_channel: staff || role === 'moderator', pending: p.rows[0] || null, pending_count: staff ? await pendingCount() : undefined });
  } catch (e) { console.error('[roles] me', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// «Moderator авах» хүсэлт
router.post('/request', auth, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    if (await canHostInChannel(req.user)) return res.status(409).json({ error: 'Та аль хэдийн Moderator эрхтэй' });
    const ban = await db.query('SELECT COALESCE(banned,FALSE) AS banned FROM users WHERE id = $1', [req.user.id]);
    if (ban.rows[0]?.banned) return res.status(403).json({ error: 'Бандуулсан хэрэглэгч хүсэлт илгээх боломжгүй' });
    const note = String(req.body?.note || '').replace(/\s+/g, ' ').trim().slice(0, NOTE_MAX);
    const r = await db.query(
      `INSERT INTO role_requests (user_id, role, note) VALUES ($1, 'moderator', $2)
       ON CONFLICT (user_id, role) WHERE status = 'pending' DO NOTHING RETURNING id, created_at`, [req.user.id, note]);
    if (!r.rows[0]) return res.status(409).json({ error: 'Таны хүсэлт аль хэдийн хүлээгдэж байна' });
    notifyStaff({ type: 'role_request', id: r.rows[0].id, username: req.user.username, note, pending_count: await pendingCount() });
    return res.json({ ok: true, id: r.rows[0].id });
  } catch (e) { console.error('[roles] request', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// ── Эзэн/админ ──
async function staffOnly(req, res, next) { if (!await isStaff(req.user)) return res.status(403).json({ error: 'Зөвхөн эзэн/админ' }); next(); }

router.get('/requests', auth, staffOnly, async (req, res) => {
  try {
    const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'pending';
    const r = await db.query(`
      SELECT rq.id, rq.user_id, u.username, u.tierbot_tier AS tier, u.membership, rq.role, rq.note, rq.status, rq.created_at, rq.decided_at,
        (SELECT COUNT(*)::int FROM room_players rp WHERE rp.user_id = rq.user_id) AS in_room,
        COALESCE(u.platform_wins, 0) AS wins, COALESCE(u.platform_losses, 0) AS losses, u.created_at AS joined_at
      FROM role_requests rq JOIN users u ON u.id = rq.user_id
      WHERE rq.status = $1 ORDER BY rq.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 200`, [status]);
    return res.json({ requests: r.rows, pending_count: await pendingCount() });
  } catch (e) { console.error('[roles] list', e.message); return res.status(500).json({ error: 'Server error' }); }
});

async function decide(req, res, approve) {
  try {
    const r = await db.query("SELECT id, user_id, role FROM role_requests WHERE id = $1 AND status = 'pending'", [req.params.id]);
    const rq = r.rows[0]; if (!rq) return res.status(404).json({ error: 'Хүсэлт олдсонгүй эсвэл аль хэдийн шийдэгдсэн' });
    const note = String(req.body?.note || '').trim().slice(0, NOTE_MAX);
    await db.query(`UPDATE role_requests SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4 WHERE id = $1`,
      [rq.id, approve ? 'approved' : 'rejected', req.user.id, note]);
    if (approve) {
      await db.query(`INSERT INTO platform_roles (user_id, role, granted_by) VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW()`, [rq.user_id, rq.role, req.user.id]);
      if (rq.role === 'moderator') modSet.add(String(rq.user_id));
    }
    if (_io) _io.to(`user:${rq.user_id}`).emit('role:decided', { role: rq.role, approved: approve, note });
    notifyStaff({ type: 'role_decided', id: rq.id, pending_count: await pendingCount() });
    return res.json({ ok: true, pending_count: await pendingCount() });
  } catch (e) { console.error('[roles] decide', e.message); return res.status(500).json({ error: 'Server error' }); }
}
router.post('/requests/:id/approve', auth, staffOnly, (req, res) => decide(req, res, true));
router.post('/requests/:id/reject', auth, staffOnly, (req, res) => decide(req, res, false));

// ── Гишүүдийн идэвх (эзэн/админ) — хамгийн идэвхтэйг олж Moderator олгоход ──
// sort: active (тоглосон цаг) | games | hosted | recent | new
router.get('/activity', auth, staffOnly, async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 64);
    const order = {
      games: 'games DESC, play_seconds DESC',
      hosted: 'hosted DESC, play_seconds DESC',
      recent: 'last_active_at DESC NULLS LAST',
      new: 'created_at DESC',
    }[req.query.sort] || 'play_seconds DESC, games DESC';
    const limit = Math.max(10, Math.min(500, Number(req.query.limit) || 200));
    const r = await db.query(`
      SELECT * FROM (
        SELECT u.id, u.username, u.tierbot_tier AS tier, u.membership, u.membership_until, u.created_at, u.last_active_at,
          COALESCE(u.banned, FALSE) AS banned,
          COALESCE(u.play_seconds_total, 0)::int AS play_seconds,
          (COALESCE(u.wins,0) + COALESCE(u.platform_wins,0))::int AS wins,
          (COALESCE(u.losses,0) + COALESCE(u.platform_losses,0))::int AS losses,
          (SELECT COUNT(*)::int FROM play_awards pa WHERE pa.user_id = u.id) AS games,
          (SELECT COUNT(*)::int FROM lan_games lg WHERE lg.host_user_id = u.id) AS hosted,
          (SELECT COUNT(*)::int FROM room_log rl WHERE rl.host_id = u.id) AS rooms_created,
          (SELECT COUNT(*)::int FROM play_awards pa WHERE pa.user_id = u.id AND pa.created_at > NOW() - INTERVAL '7 days') AS games_7d,
          pr.role
        FROM users u
        LEFT JOIN platform_roles pr ON pr.user_id = u.id
        WHERE ($1 = '' OR u.username ILIKE '%' || $1 || '%')
      ) t
      ORDER BY ${order}
      LIMIT ${limit}`, [q]);
    const pending = await db.query("SELECT user_id FROM role_requests WHERE status = 'pending'");
    const pendingSet = new Set(pending.rows.map((x) => String(x.user_id)));
    const online = req.app.get('onlineUserIds') ? req.app.get('onlineUserIds')() : new Set();
    return res.json({ users: r.rows.map((u) => ({ ...u, online: online.has(String(u.id)), requested: pendingSet.has(String(u.id)) })) });
  } catch (e) { console.error('[roles] activity', e.message); return res.status(500).json({ error: 'Server error' }); }
});
router.get('/activity/:userId', auth, staffOnly, async (req, res) => {
  try {
    const uid = Number(req.params.userId);
    const rooms = await db.query(`SELECT room_id, name, game_type, kind, created_at, closed_at,
        EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - created_at))::int AS open_sec
      FROM room_log WHERE host_id = $1 ORDER BY created_at DESC LIMIT 50`, [uid]);
    const games = await db.query(`SELECT pa.created_at, pa.game_sec, pa.ranked, pa.xp, pa.diamonds, pa.room_id
      FROM play_awards pa WHERE pa.user_id = $1 ORDER BY pa.created_at DESC LIMIT 50`, [uid]);
    return res.json({ rooms: rooms.rows, games: games.rows });
  } catch (e) { console.error('[roles] activity/user', e.message); return res.status(500).json({ error: 'Server error' }); }
});
// Эзэн/админ шууд Moderator олгох (хүсэлтгүйгээр) — хүлээгдэж буй хүсэлт байвал батлагдсанд тооцно
router.post('/grant/:userId', auth, staffOnly, async (req, res) => {
  try {
    const uid = Number(req.params.userId);
    const u = await db.query('SELECT id, COALESCE(banned,FALSE) AS banned FROM users WHERE id = $1', [uid]);
    if (!u.rows[0]) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    if (u.rows[0].banned) return res.status(400).json({ error: 'Бандуулсан хэрэглэгч' });
    await db.query(`INSERT INTO platform_roles (user_id, role, granted_by) VALUES ($1, 'moderator', $2)
      ON CONFLICT (user_id) DO UPDATE SET role = 'moderator', granted_by = EXCLUDED.granted_by, granted_at = NOW()`, [uid, req.user.id]);
    await db.query(`UPDATE role_requests SET status = 'approved', decided_by = $2, decided_at = NOW() WHERE user_id = $1 AND status = 'pending'`, [uid, req.user.id]);
    modSet.add(String(uid));
    if (_io) _io.to(`user:${uid}`).emit('role:decided', { role: 'moderator', approved: true, note: '' });
    notifyStaff({ type: 'role_decided', pending_count: await pendingCount() });
    return res.json({ ok: true });
  } catch (e) { console.error('[roles] grant', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// Kick-ийн бүртгэл (нийтийн Room) — хэн, хэнийг, ямар шалтгаанаар
router.get('/kicks', auth, staffOnly, async (req, res) => {
  try {
    const r = await db.query(`SELECT k.id, k.room_id, rm.name AS room_name, k.reason, k.created_at,
        t.username AS target_name, b.username AS by_name, k.target_id, k.by_id
      FROM kick_log k LEFT JOIN users t ON t.id = k.target_id LEFT JOIN users b ON b.id = k.by_id
      LEFT JOIN rooms rm ON rm.id = k.room_id ORDER BY k.created_at DESC LIMIT 300`);
    return res.json({ kicks: r.rows });
  } catch (e) { console.error('[roles] kicks', e.message); return res.status(500).json({ error: 'Server error' }); }
});

router.get('/moderators', auth, staffOnly, async (req, res) => {
  try {
    const r = await db.query(`SELECT pr.user_id, u.username, u.tierbot_tier AS tier, pr.role, pr.granted_at, g.username AS granted_by_name
      FROM platform_roles pr JOIN users u ON u.id = pr.user_id LEFT JOIN users g ON g.id = pr.granted_by
      ORDER BY pr.granted_at DESC LIMIT 1000`);
    return res.json({ moderators: r.rows });
  } catch (e) { console.error('[roles] mods', e.message); return res.status(500).json({ error: 'Server error' }); }
});
router.delete('/moderators/:userId', auth, staffOnly, async (req, res) => {
  try {
    const r = await db.query('DELETE FROM platform_roles WHERE user_id = $1 RETURNING role', [req.params.userId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Олдсонгүй' });
    modSet.delete(String(req.params.userId));
    if (_io) _io.to(`user:${req.params.userId}`).emit('role:decided', { role: r.rows[0].role, approved: false, revoked: true });
    return res.json({ ok: true });
  } catch (e) { console.error('[roles] revoke', e.message); return res.status(500).json({ error: 'Server error' }); }
});

module.exports = { router, ensureTables, setIO, canHostInChannel, roleOf, isStaff, isModCached, loadMods };
