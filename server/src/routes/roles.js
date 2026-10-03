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
// ADMIN цол ЗӨВХӨН ӨӨРИЙН ROOM-Д (2026-10-03, эзэн): platform_roles.room_id — тэр Room-д л kick/зарлал/LAN нээх/@everyone эрхтэй.
// room_id NULL (хуучин олголт) = глобал ажилтан хэвээр (эзэн самбараас Room сонгож дахин олговол Room-д хязгаарлагдана).
const adminRooms = new Map();   // userId -> room_id (String) | null (глобал)
async function loadMods() {
  try {
    const r = await db.query("SELECT user_id, role, room_id FROM platform_roles WHERE role IN ('moderator','admin')");
    modSet.clear(); adminRooms.clear();
    r.rows.forEach((x) => (x.role === 'admin' ? adminRooms.set(String(x.user_id), x.room_id == null ? null : String(x.room_id)) : modSet.add(String(x.user_id))));
  } catch {}
}
// Кэшийг 5 мин тутам DB-ээс сэргээнэ — асах үед DB түр унасан / миграц алгассан үед ADMIN цолтнууд эрхгүй үлддэг байв
if (db) setInterval(() => { loadMods(); }, 5 * 60 * 1000).unref();
function isModCached(userId) { return modSet.has(String(userId)); }
// Глобал ADMIN (room_id NULL) — платформын хэмжээний эрх (эзний самбар, хүсэлт батлах, өрөө нээх г.м.)
function isAdminCached(userId) { return adminRooms.has(String(userId)) && adminRooms.get(String(userId)) === null; }
// Тухайн Room-ын ADMIN (эсвэл глобал ADMIN)
function isRoomAdmin(userId, roomId) {
  const id = String(userId); if (!adminRooms.has(id)) return false;
  const rid = adminRooms.get(id); return rid === null || (roomId != null && rid === String(roomId));
}
function adminRoomOf(userId) { return adminRooms.has(String(userId)) ? adminRooms.get(String(userId)) : undefined; }
function cacheRole(userId, role, roomId = null) { const id = String(userId); modSet.delete(id); adminRooms.delete(id); if (role === 'moderator') modSet.add(id); if (role === 'admin') adminRooms.set(id, roomId == null ? null : String(roomId)); }

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }

// ── Автомат батлалт: until (ISO) хүртэл шинэ Moderator хүсэлтийг шууд батална ──
const AUTO_DEFAULT_UNTIL = '2026-10-09T23:59:59+08:00';
const AUTO_NOTE = 'Автомат батлалт (эзний тохиргоо)';
let _autoCache = null;   // { until: ms|null, at }
async function autoUntil() {
  if (_autoCache && Date.now() - _autoCache.at < 30000) return _autoCache.until;
  let until = null;
  try { const r = await db.query("SELECT value FROM platform_settings WHERE key = 'mod_auto_approve_until'"); const t = Date.parse(r.rows[0]?.value || ''); until = Number.isFinite(t) ? t : null; } catch {}
  _autoCache = { until, at: Date.now() };
  return until;
}
async function autoActive() { const u = await autoUntil(); return !!u && u > Date.now(); }
async function approveRequest(rq, decidedBy, note) {
  await db.query(`UPDATE role_requests SET status = 'approved', decided_by = $2, decided_at = NOW(), decision_note = $3 WHERE id = $1 AND status = 'pending'`, [rq.id, decidedBy, note]);
  await db.query(`INSERT INTO platform_roles (user_id, role, granted_by) VALUES ($1, $2, $3)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW()`, [rq.user_id, rq.role || 'moderator', decidedBy]);
  cacheRole(rq.user_id, rq.role || 'moderator');
  if (_io) _io.to(`user:${rq.user_id}`).emit('role:decided', { role: rq.role || 'moderator', approved: true, note, auto: !decidedBy });
}
// Хүлээгдэж буй бүх хүсэлтийг батална (асаах үед / сервер асахад). ADMIN цол хүссэн хүсэлт ирэхгүй (зөвхөн moderator).
async function sweepAutoApprove() {
  if (!await dbOk() || !await autoActive()) return 0;
  const r = await db.query(`SELECT rq.id, rq.user_id, rq.role FROM role_requests rq JOIN users u ON u.id = rq.user_id
    WHERE rq.status = 'pending' AND rq.role = 'moderator' AND NOT COALESCE(u.banned, FALSE)`);
  for (const rq of r.rows) { try { await approveRequest(rq, null, AUTO_NOTE); } catch (e) { console.error('[roles] auto', e.message); } }
  if (r.rows.length) { console.log(`[roles] автоматаар ${r.rows.length} Moderator хүсэлт батлав`); notifyStaff({ type: 'role_decided', pending_count: await pendingCount() }); }
  return r.rows.length;
}

// Цол хураасныг role_requests-д 'revoked' мөрөөр тэмдэглэнэ (автомат батлалт тойрохоос хамгаална)
async function markRevoked(userId, byId) {
  try { await db.query("INSERT INTO role_requests (user_id, role, note, status, decided_by, decided_at) VALUES ($1, 'moderator', '', 'revoked', $2, NOW())", [userId, byId]); } catch (e) { console.error('[roles] markRevoked', e.message); }
}

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
    await db.query('ALTER TABLE platform_roles ADD COLUMN IF NOT EXISTS room_id INTEGER');   // ADMIN → Room (2026-10-03)
  } catch (e) { console.error('[Migration] roles:', e.message); }
  await loadMods();   // хүснэгт үүсгэлт алдсан ч кэшийг ачаална
  // /roles/activity-ийн дэд асуулгууд бүтэн скан хийдэг байв
  try {
    await db.query('CREATE INDEX IF NOT EXISTS idx_lan_games_host ON lan_games (host_user_id)');
    await db.query('CREATE INDEX IF NOT EXISTS idx_play_awards_user ON play_awards (user_id, created_at DESC)');
  } catch (e) { console.error('[Migration] roles idx:', e.message); }
  // Moderator хүсэлтийн АВТОМАТ батлалт (2026-10-02, эзэн: «энэ 7 хоногт» — ADMIN алга тул) — эхлэлийн утга 10-09 23:59 (УБ)
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS platform_settings (key VARCHAR(64) PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await db.query(`INSERT INTO platform_settings (key, value) VALUES ('mod_auto_approve_until', $1) ON CONFLICT (key) DO NOTHING`, [AUTO_DEFAULT_UNTIL]);
    _autoCache = null;
    setTimeout(() => sweepAutoApprove().catch(() => {}), 5000);   // хүлээгдэж буй хүсэлтүүдийг батална
  } catch (e) { console.error('[Migration] platform_settings:', e.message); }
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
async function canHostInChannel(user, roomId = null) {
  if (await isStaff(user)) return true;
  if (roomId != null && isRoomAdmin(user.id, roomId)) return true;   // тухайн Room-ын ADMIN
  return (await roleOf(user.id)) === 'moderator';
}
/** Бан авсан хэрэглэгчийн Moderator/ADMIN цолыг хураана (anticheat.js дуудна). */
async function revokeOnBan(userId) {
  if (!db || !userId) return;
  try {
    const r = await db.query('DELETE FROM platform_roles WHERE user_id = $1 RETURNING role', [userId]);
    cacheRole(userId, null);
    await db.query("UPDATE role_requests SET status = 'rejected', decided_at = NOW(), decision_note = 'banned' WHERE user_id = $1 AND status = 'pending'", [userId]);
    if (r.rows[0]) { await markRevoked(userId, null); if (_io) _io.to(`user:${userId}`).emit('role:decided', { role: 'moderator', approved: false, revoked: true, note: 'ban' }); }
  } catch (e) { console.error('[roles] revokeOnBan', e.message); }
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
    const globalStaff = await isStaff(req.user);
    const role = await roleOf(req.user.id);
    const roomQ = req.query.room != null && req.query.room !== '' ? String(req.query.room) : null;
    const adminRoomId = role === 'admin' ? (adminRoomOf(req.user.id) ?? null) : null;
    const roomAdmin = !!(roomQ && role === 'admin' && isRoomAdmin(req.user.id, roomQ));   // ?room=<id> — тэр Room-д ажилтны эрхтэй
    const staff = globalStaff || roomAdmin;
    const p = await db.query("SELECT id, role, created_at FROM role_requests WHERE user_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1", [req.user.id]);
    return res.json({ role, staff, global_staff: globalStaff, room_admin: roomAdmin, admin_room_id: adminRoomId, owner: adminMW.isOwnerUser(req.user), can_host_channel: staff || role === 'moderator', pending: p.rows[0] || null, auto_approve: await autoActive(), pending_count: globalStaff ? await pendingCount() : undefined });
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
    // Сүүлийн 30 хоногт татгалзсан/хураагдсан хүнийг автоматаар батлахгүй — эзэн/админ гараар шийднэ (аудит 2026-10-02)
    const prior = await db.query("SELECT 1 FROM role_requests WHERE user_id = $1 AND status IN ('rejected','revoked') AND COALESCE(decided_at, created_at) > NOW() - INTERVAL '30 days' LIMIT 1", [req.user.id]);
    if (!prior.rows[0] && await autoActive()) {
      await approveRequest({ id: r.rows[0].id, user_id: req.user.id, role: 'moderator' }, null, AUTO_NOTE);
      notifyStaff({ type: 'role_auto', id: r.rows[0].id, username: req.user.username, note, pending_count: await pendingCount() });
      return res.json({ ok: true, id: r.rows[0].id, auto: true, approved: true });
    }
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
    if (approve) {
      const bq = await db.query('SELECT COALESCE(banned,FALSE) AS banned FROM users WHERE id = $1', [rq.user_id]);
      if (bq.rows[0]?.banned) return res.status(400).json({ error: 'Бандуулсан хэрэглэгчийг батлах боломжгүй' });
    }
    await db.query(`UPDATE role_requests SET status = $2, decided_by = $3, decided_at = NOW(), decision_note = $4 WHERE id = $1`,
      [rq.id, approve ? 'approved' : 'rejected', req.user.id, note]);
    if (approve) {
      await db.query(`INSERT INTO platform_roles (user_id, role, granted_by) VALUES ($1, $2, $3)
        ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW()`, [rq.user_id, rq.role, req.user.id]);
      cacheRole(rq.user_id, rq.role);
    }
    if (_io) _io.to(`user:${rq.user_id}`).emit('role:decided', { role: rq.role, approved: approve, note });
    notifyStaff({ type: 'role_decided', id: rq.id, pending_count: await pendingCount() });
    return res.json({ ok: true, pending_count: await pendingCount() });
  } catch (e) { console.error('[roles] decide', e.message); return res.status(500).json({ error: 'Server error' }); }
}
router.post('/requests/:id/approve', auth, staffOnly, (req, res) => decide(req, res, true));

// Автомат батлалтын төлөв (ажилтан харна) / тохируулах (зөвхөн эзэн): { days: 0..30 } — 0 = унтраах
router.get('/auto', auth, staffOnly, async (req, res) => {
  const until = await autoUntil();
  return res.json({ until: until ? new Date(until).toISOString() : null, active: !!until && until > Date.now(), can_edit: adminMW.isOwnerUser(req.user) });
});
router.post('/auto', auth, staffOnly, async (req, res) => {
  if (!adminMW.isOwnerUser(req.user)) return res.status(403).json({ error: 'Зөвхөн эзэн тохируулна' });
  const days = Math.max(0, Math.min(30, Number(req.body?.days) || 0));
  const until = days ? new Date(Date.now() + days * 864e5).toISOString() : new Date(0).toISOString();
  try {
    await db.query(`INSERT INTO platform_settings (key, value, updated_at) VALUES ('mod_auto_approve_until', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [until]);
    _autoCache = null;
    const swept = days ? await sweepAutoApprove() : 0;
    return res.json({ ok: true, until: days ? until : null, active: !!days, swept });
  } catch (e) { console.error('[roles] auto set', e.message); return res.status(500).json({ error: 'Server error' }); }
});
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
    const u = await db.query('SELECT id, discord_id, COALESCE(banned,FALSE) AS banned FROM users WHERE id = $1', [uid]);
    if (!u.rows[0]) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    if (u.rows[0].banned) return res.status(400).json({ error: 'Бандуулсан хэрэглэгч' });
    if (adminMW.isOwnerUser(u.rows[0]) || ((await roleOf(uid)) === 'admin' && !adminMW.isOwnerUser(req.user))) return res.status(403).json({ error: 'ADMIN/эзний цолд зөвхөн эзэн хүрнэ' });
    // ADMIN цолтой хүнд «Moderator өгөх» дарахад чимээгүй буурдаг байв (аудит 2026-10-02) — цолыг нэр дээр баруун товчоор өөрчилнө
    if ((await roleOf(uid)) === 'admin') return res.status(409).json({ error: 'Энэ хэрэглэгч ADMIN цолтой (Moderator эрхийг багтаасан). Цолыг өөрчлөх бол нэр дээр баруун товч дарна уу.' });
    await db.query(`INSERT INTO platform_roles (user_id, role, granted_by) VALUES ($1, 'moderator', $2)
      ON CONFLICT (user_id) DO UPDATE SET role = 'moderator', granted_by = EXCLUDED.granted_by, granted_at = NOW()`, [uid, req.user.id]);
    await db.query(`UPDATE role_requests SET status = 'approved', decided_by = $2, decided_at = NOW() WHERE user_id = $1 AND status = 'pending'`, [uid, req.user.id]);
    cacheRole(uid, 'moderator');
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

// ── Хэрэглэгчийн нэр дээр баруун товч → цол (2026-10-02) ──
// Эзэн: ADMIN ба Moderator өгөх/хураах. Админ: зөвхөн Moderator өгөх/хураах; өөр админ/эзэнд хүрэхгүй.
router.get('/user/:userId', auth, staffOnly, async (req, res) => {
  try {
    const uid = Number(req.params.userId);
    const u = await db.query('SELECT id, username, discord_id FROM users WHERE id = $1', [uid]);
    if (!u.rows[0]) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    const owner = adminMW.isOwnerUser(u.rows[0]);
    const role = owner ? 'owner' : (await roleOf(uid)) || (await isStaff(u.rows[0]) ? 'admin' : null);
    const iAmOwner = adminMW.isOwnerUser(req.user);
    let roomId = null, roomName = null;
    if (role === 'admin') {
      const pr = await db.query('SELECT pr.room_id, rm.name FROM platform_roles pr LEFT JOIN rooms rm ON rm.id = pr.room_id WHERE pr.user_id = $1', [uid]);
      roomId = pr.rows[0]?.room_id ?? null; roomName = pr.rows[0]?.name || null;
    }
    return res.json({ id: uid, username: u.rows[0].username, role, room_id: roomId, room_name: roomName, can_set_admin: iAmOwner && !owner, can_set_mod: !owner && (iAmOwner || role !== 'admin') });
  } catch (e) { console.error('[roles] user', e.message); return res.status(500).json({ error: 'Server error' }); }
});
// Цол олгох/хураах нийтлэг логик — /set/:userId (баруун товчны цэс) ба /admins (эзний самбар) хоёулаа дуудна.
// ADMIN → заавал Room (room_id): тэр Room-д л эрх нь хэрэгжинэ (2026-10-03, эзэн).
async function applyRole(actor, uid, role, roomIdRaw) {
  if (role !== null && role !== 'moderator' && role !== 'admin') return [400, { error: 'Буруу цол' }];
  if (String(uid) === String(actor.id)) return [400, { error: 'Өөрийнхөө цолыг өөрчлөх боломжгүй' }];
  const u = await db.query('SELECT id, username, discord_id, COALESCE(banned,FALSE) AS banned FROM users WHERE id = $1', [uid]);
  const target = u.rows[0]; if (!target) return [404, { error: 'Хэрэглэгч олдсонгүй' }];
  if (adminMW.isOwnerUser(target)) return [403, { error: 'Эзний цолыг өөрчлөх боломжгүй' }];
  const iAmOwner = adminMW.isOwnerUser(actor);
  const cur = await roleOf(uid);
  if (!iAmOwner && (role === 'admin' || cur === 'admin')) return [403, { error: 'ADMIN цолыг зөвхөн эзэн өгнө/хураана' }];
  if (role && target.banned) return [400, { error: 'Бандуулсан хэрэглэгч' }];
  let roomId = null, roomName = null;
  if (role === 'admin') {
    roomId = Number.parseInt(roomIdRaw, 10);
    if (!Number.isInteger(roomId)) return [400, { error: 'ADMIN цолыг Room сонгож олгоно (аль Room-д эрхтэй байх вэ)' }];
    const rm = await db.query("SELECT id, name FROM rooms WHERE id = $1 AND COALESCE(kind,'room') = 'channel'", [roomId]);
    if (!rm.rows[0]) return [404, { error: 'Ийм нийтийн Room олдсонгүй' }];
    roomName = rm.rows[0].name;
  }
  if (role === null) await db.query('DELETE FROM platform_roles WHERE user_id = $1', [uid]);
  else await db.query(`INSERT INTO platform_roles (user_id, role, granted_by, room_id) VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, granted_by = EXCLUDED.granted_by, granted_at = NOW(), room_id = EXCLUDED.room_id`, [uid, role, actor.id, roomId]);
  if (role) await db.query(`UPDATE role_requests SET status = 'approved', decided_by = $2, decided_at = NOW() WHERE user_id = $1 AND status = 'pending'`, [uid, actor.id]);
  cacheRole(uid, role, roomId);
  if (_io) _io.to(`user:${uid}`).emit('role:decided', { role: role || cur || 'moderator', approved: !!role, revoked: !role, room_id: roomId, room_name: roomName });
  notifyStaff({ type: 'role_decided', pending_count: await pendingCount() });
  console.log(`[Roles] ${actor.username} → ${target.username}: ${cur || '—'} → ${role || '—'}${roomId ? ` (Room #${roomId} ${roomName})` : ''}`);
  return [200, { ok: true, role, room_id: roomId, room_name: roomName, username: target.username }];
}
router.post('/set/:userId', auth, staffOnly, async (req, res) => {
  try {
    const role = req.body?.role == null || req.body.role === '' ? null : String(req.body.role);
    const [code, body] = await applyRole(req.user, Number(req.params.userId), role, req.body?.room_id);
    return res.status(code).json(body);
  } catch (e) { console.error('[roles] set', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// ── Эзний самбар → «ADMIN-ууд»: хэнд, аль Room-д ADMIN өгөх/солих/хураах (2026-10-03) ──
const ownerOnly = (req, res, next) => (adminMW.isOwnerUser(req.user) ? next() : res.status(403).json({ error: 'Зөвхөн эзэн' }));
router.get('/admins', auth, ownerOnly, async (req, res) => {
  try {
    const a = await db.query(`SELECT pr.user_id, u.username, u.tierbot_tier AS tier, pr.room_id, rm.name AS room_name, pr.granted_at, g.username AS granted_by_name
      FROM platform_roles pr JOIN users u ON u.id = pr.user_id LEFT JOIN rooms rm ON rm.id = pr.room_id LEFT JOIN users g ON g.id = pr.granted_by
      WHERE pr.role = 'admin' ORDER BY pr.room_id NULLS FIRST, pr.granted_at DESC LIMIT 500`);
    const r = await db.query("SELECT id, name, game_type FROM rooms WHERE COALESCE(kind,'room') = 'channel' ORDER BY id");
    return res.json({ admins: a.rows, rooms: r.rows });
  } catch (e) { console.error('[roles] admins', e.message); return res.status(500).json({ error: 'Server error' }); }
});
router.post('/admins', auth, ownerOnly, async (req, res) => {
  try {
    const name = String(req.body?.username || '').trim();
    if (!name) return res.status(400).json({ error: 'Хэрэглэгчийн нэр оруулна уу' });
    const u = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1', [name]);
    if (!u.rows[0]) return res.status(404).json({ error: `«${name}» нэртэй хэрэглэгч олдсонгүй` });
    const [code, body] = await applyRole(req.user, Number(u.rows[0].id), 'admin', req.body?.room_id);
    return res.status(code).json(body);
  } catch (e) { console.error('[roles] admins add', e.message); return res.status(500).json({ error: 'Server error' }); }
});

router.get('/moderators', auth, staffOnly, async (req, res) => {
  try {
    const r = await db.query(`SELECT pr.user_id, u.username, u.tierbot_tier AS tier, pr.role, pr.granted_at, g.username AS granted_by_name, pr.room_id, rm.name AS room_name
      FROM platform_roles pr JOIN users u ON u.id = pr.user_id LEFT JOIN users g ON g.id = pr.granted_by LEFT JOIN rooms rm ON rm.id = pr.room_id
      ORDER BY pr.granted_at DESC LIMIT 1000`);
    return res.json({ moderators: r.rows });
  } catch (e) { console.error('[roles] mods', e.message); return res.status(500).json({ error: 'Server error' }); }
});
router.delete('/moderators/:userId', auth, staffOnly, async (req, res) => {
  try {
    if ((await roleOf(req.params.userId)) === 'admin' && !adminMW.isOwnerUser(req.user)) return res.status(403).json({ error: 'ADMIN цолыг зөвхөн эзэн хураана' });
    const r = await db.query('DELETE FROM platform_roles WHERE user_id = $1 RETURNING role', [req.params.userId]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Олдсонгүй' });
    cacheRole(req.params.userId, null);
    await markRevoked(req.params.userId, req.user.id);
    if (_io) _io.to(`user:${req.params.userId}`).emit('role:decided', { role: r.rows[0].role, approved: false, revoked: true });
    return res.json({ ok: true });
  } catch (e) { console.error('[roles] revoke', e.message); return res.status(500).json({ error: 'Server error' }); }
});

module.exports = { router, ensureTables, setIO, canHostInChannel, roleOf, isStaff, isModCached, isAdminCached, isRoomAdmin, adminRoomOf, loadMods, revokeOnBan, cacheRole };
