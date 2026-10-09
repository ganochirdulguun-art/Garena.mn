'use strict';
// ── Хакны зөрчлийн хэрэг (2026-10-04, эзэн) ──
// Урсгал: клиент илрүүлнэ (процессын нэр / WC3-д ачаалагдсан DLL / Game.dll санах ойн өөрчлөлт) → энд «хэрэг» нээгдэнэ →
//   ЭЗЭН ба ADMIN-уудад 🔔 мэдэгдэл (staff:notify {type:'anticheat'}).
//   ADMIN: хэргийг шалгаад «Бан жагсаалтад оруулах» (тайлбартай) эсвэл «Хэрэгсэхгүй».
//   ЭЗЭН: жагсаалт + ADMIN-ы тайлбарыг харж BAN хийнэ / хэрэгсэхгүй; эсвэл хэрэггүйгээр шууд BAN (нэр дээр баруун товч).
// Автомат бан БАЙХГҮЙ — бан зөвхөн эзний шийдвэрээр.
// Эрх: эзэн + глобал ADMIN бүх хэргийг; Room-ын ADMIN зөвхөн өөрийн Room-д гарсан хэргийг харж санал болгоно.
const express = require('express');
const authMW = require('../middleware/auth');
const adminMW = require('../middleware/admin');

let db; try { db = require('../config/db'); } catch { db = null; }
const router = express.Router();
let _io = null;
function setIO(io) { _io = io; }
// Тоглогчид системийн DM илгээх (index.js тохируулна): (userId, text) → true/false
let _dm = null;
function setSystemDM(fn) { _dm = typeof fn === 'function' ? fn : null; }

const KINDS = ['process', 'module', 'memory', 'fogclick', 'report', 'unverified'];
const KIND_LABEL = { process: 'Хориотой програм', module: 'WC3-д сэжигтэй DLL', memory: 'Game.dll санах ой өөрчлөгдсөн', fogclick: 'FOGCLICK (replay)', report: 'Тоглогчийн гомдол', unverified: 'Шалгагдаагүй WC3 (elevated)' };

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }
async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS anticheat_cases (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER REFERENCES users(id) ON DELETE CASCADE,
        kind          VARCHAR(16) NOT NULL,
        tool          VARCHAR(80),
        severity      VARCHAR(8) NOT NULL DEFAULT 'review',
        detail        JSONB,
        room_id       INTEGER,
        hits          INTEGER NOT NULL DEFAULT 1,
        status        VARCHAR(12) NOT NULL DEFAULT 'new',
        nominated_by  INTEGER, nominate_note VARCHAR(500), nominated_at TIMESTAMPTZ,
        decided_by    INTEGER, decision_note VARCHAR(500), decided_at TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ac_cases_status ON anticheat_cases (status, last_at DESC);
      CREATE INDEX IF NOT EXISTS idx_ac_cases_user ON anticheat_cases (user_id, last_at DESC);
      -- «Ижил өөрчлөлтийг цаашид үл тоох»: гэмгүй Game.dll өөрчлөлт (sig) / DLL нэр (module) дахин хэрэг үүсгэхгүй
      CREATE TABLE IF NOT EXISTS anticheat_ignores (
        kind VARCHAR(16) NOT NULL, sig VARCHAR(2000) NOT NULL, note VARCHAR(300), created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (kind, sig)
      );
      -- WC3 сессийн мэдээлэл (2026-10-10, эзэн): elevated WC3 = зөрчил биш, мэдээлэл л; Game.dll файлын хэш — олонхоос ялгаатайг олох
      CREATE TABLE IF NOT EXISTS anticheat_wc3_info (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        verified BOOLEAN NOT NULL DEFAULT TRUE, unverified_hits INTEGER NOT NULL DEFAULT 0, sessions INTEGER NOT NULL DEFAULT 0,
        cause VARCHAR(200), diag JSONB, game_sha VARCHAR(64), game_size BIGINT, game_ver VARCHAR(40), game_path VARCHAR(300),
        first_at TIMESTAMPTZ DEFAULT NOW(), last_at TIMESTAMPTZ DEFAULT NOW()
      );
      UPDATE anticheat_cases SET status = 'dismissed', decided_at = NOW(), decision_note = 'Эзний шийдвэр 2026-10-10: administrator эрхтэй WC3 зөрчил биш — мэдээлэл болгон хадгална'
        WHERE kind = 'unverified' AND status IN ('new','nominated');
    `);
  } catch (e) { console.error('[acCases] ensureTables:', e.message); }
}

function roles() { return require('./roles'); }
const isOwner = (u) => adminMW.isOwnerUser(u);
async function isGlobalStaff(u) { try { return await roles().isStaff(u); } catch { return isOwner(u); } }
function adminRoom(u) { try { const r = roles().adminRoomOf(u?.id); return r === undefined ? undefined : r; } catch { return undefined; } }
// Хэрэгт хандах эрх: 'all' (эзэн/глобал), 'room:<id>' (Room ADMIN), null
async function scopeOf(u) {
  if (!u) return null;
  if (isOwner(u) || await isGlobalStaff(u)) return 'all';
  const r = adminRoom(u); if (r) return `room:${r}`;
  return null;
}
const canSee = (scope, c) => scope === 'all' || (scope && c && c.room_id != null && scope === `room:${c.room_id}`);

/** Эзэн/ADMIN-уудад мэдэгдэл (Room ADMIN — зөвхөн өөрийн Room-ын хэрэг). */
async function notify(payload, roomId = null) {
  if (!_io) return;
  try {
    for (const s of _io.sockets.sockets.values()) {
      if (!s.user) continue;
      const sc = await scopeOf(s.user);
      if (sc === 'all' || (roomId != null && sc === `room:${roomId}`)) s.emit('staff:notify', { type: 'anticheat', ...payload });
    }
  } catch {}
}

const clip = (v, n) => String(v ?? '').slice(0, n);
function cleanDetail(d) {
  try { const s = JSON.stringify(d ?? {}); return s.length > 12000 ? { truncated: true, head: s.slice(0, 12000) } : JSON.parse(s); } catch { return {}; }
}

/** Хэрэг нээх / давтагдвал (24ц дотор ижил хэрэглэгч+төрөл+хэрэгсэл, нээлттэй) hits+1. */
// Хэрэглэгчийн одоогийн Room (socket.data.roomId) — Room ADMIN-д мэдэгдэх хүрээ
function userRoom(userId) {
  try { for (const s of _io?.sockets?.sockets?.values?.() || []) if (String(s.user?.id) === String(userId) && s.data?.roomId) { const n = Number(s.data.roomId); if (Number.isInteger(n)) return n; } } catch {}
  return null;
}
// WC3 сессийн мэдээлэл (хэрэг биш): unverified = elevated тул шалгагдаагүй; wc3info = шалгагдсан сесс. Game.dll хэш/хувилбар upsert.
async function recordWc3Info(userId, kind, detail = {}) {
  if (!userId || !await dbOk()) return null;
  const gf = (detail && detail.game_file) || {};
  const unv = kind === 'unverified';
  try {
    await db.query(`INSERT INTO anticheat_wc3_info (user_id, verified, unverified_hits, sessions, cause, diag, game_sha, game_size, game_ver, game_path, last_at)
        VALUES ($1, $2, $3, 1, $4, $5::jsonb, $6, $7, $8, $9, NOW())
        ON CONFLICT (user_id) DO UPDATE SET verified = EXCLUDED.verified, unverified_hits = anticheat_wc3_info.unverified_hits + $3,
          sessions = anticheat_wc3_info.sessions + 1, cause = COALESCE(EXCLUDED.cause, anticheat_wc3_info.cause), diag = COALESCE(EXCLUDED.diag, anticheat_wc3_info.diag),
          game_sha = COALESCE(EXCLUDED.game_sha, anticheat_wc3_info.game_sha), game_size = COALESCE(EXCLUDED.game_size, anticheat_wc3_info.game_size),
          game_ver = COALESCE(EXCLUDED.game_ver, anticheat_wc3_info.game_ver), game_path = COALESCE(EXCLUDED.game_path, anticheat_wc3_info.game_path), last_at = NOW()`,
      [userId, !unv, unv ? 1 : 0, unv ? clip(detail.cause, 200) || null : null, unv && detail.diag ? JSON.stringify(cleanDetail(detail.diag)) : null,
       gf.sha256 ? clip(gf.sha256, 64) : null, gf.size != null && Number(gf.size) > 0 ? Number(gf.size) : null, gf.version ? clip(gf.version, 40) : null, gf.path ? clip(gf.path, 300) : null]);
    return { info: true };
  } catch (e) { console.warn('[acCases] wc3info:', e.message); return null; }
}

async function openCase({ userId, kind, tool, detail, roomId = null, severity = 'review' }) {   // eslint-disable-line
  if (kind === 'unverified' || kind === 'wc3info') return recordWc3Info(userId, kind, detail);   // хэрэг биш (эзэн 2026-10-10)
  if (!userId || !KINDS.includes(kind) || !await dbOk()) return null;
  if (roomId == null) roomId = userRoom(userId);
  // Үл тоох жагсаалт (эзэн/глобал ADMIN тэмдэглэсэн гэмгүй өөрчлөлт/DLL)
  try {
    if (kind === 'memory' && detail?.sig) {
      const ig = await db.query('SELECT 1 FROM anticheat_ignores WHERE kind = $1 AND sig = $2', ['memory', clip(detail.sig, 2000)]);
      if (ig.rows[0]) return { ignored: true };
    }
    if (kind === 'module' && severity !== 'high' && Array.isArray(detail?.modules)) {
      const names = detail.modules.map((m) => String(m).split(/[\\/]/).pop().toLowerCase());
      const ig = await db.query('SELECT sig FROM anticheat_ignores WHERE kind = $1 AND sig = ANY($2)', ['module', names]);
      const ign = new Set(ig.rows.map((x) => x.sig));
      const left = detail.modules.filter((m, i) => !ign.has(names[i]));
      if (!left.length) return { ignored: true };
      if (left.length !== detail.modules.length) { detail = { ...detail, modules: left }; tool = `${left.length} танигдаагүй DLL`; }
    }
  } catch { /* хүснэгт хараахан үүсээгүй */ }
  const t = clip(tool || kind, 80);
  try {
    const ex = await db.query(`SELECT id FROM anticheat_cases WHERE user_id = $1 AND kind = $2 AND COALESCE(tool,'') = $3 AND status IN ('new','nominated') AND last_at > NOW() - INTERVAL '24 hours' ORDER BY id DESC LIMIT 1`, [userId, kind, t]);
    let id, fresh = false;
    if (ex.rows[0]) {
      id = ex.rows[0].id;
      // detail-ийг клиентийн шинэ мэдээллээр солихдоо анхааруулгын түүхийг (warned_at/warn_count) хадгална
      await db.query(`UPDATE anticheat_cases SET hits = hits + 1, last_at = NOW(), room_id = COALESCE($3, room_id),
        detail = $2::jsonb || jsonb_strip_nulls(jsonb_build_object('warned_at', detail->'warned_at', 'warn_count', detail->'warn_count')) WHERE id = $1`, [id, JSON.stringify(cleanDetail(detail)), roomId]);
    } else {
      const r = await db.query(`INSERT INTO anticheat_cases (user_id, kind, tool, severity, detail, room_id) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING id`,
        [userId, kind, t, severity === 'high' ? 'high' : 'review', JSON.stringify(cleanDetail(detail)), roomId]);
      id = r.rows[0].id; fresh = true;
    }
    if (fresh) {
      const u = (await db.query('SELECT username FROM users WHERE id = $1', [userId])).rows[0] || {};
      notify({ case_id: id, user_id: userId, username: u.username || `#${userId}`, kind, kind_label: KIND_LABEL[kind], tool: t, severity, room_id: roomId }, roomId);
      console.log(`[AntiCheat] хэрэг #${id}: ${u.username || userId} — ${KIND_LABEL[kind]} «${t}» (${severity})`);
    }
    return { id, fresh };
  } catch (e) { console.error('[acCases] openCase:', e.message); return null; }
}


/** Бан: users.banned + цол хураах + socket салгах. Зөвхөн эзэн дуудна.
 *  ЗӨВХӨН ТУХАЙН ACCOUNT (эзэн 2026-10-04): IP / компьютер / сүлжээгээр бандахгүй — интернет кафед нэг хүн бан авахад
 *  ижил IP-тай бусад тоглогч хохирохгүй. user_ips нь зөвхөн бүртгэл, бан шалгалтад ашиглагдахгүй. */
async function banUser(userId, reason, by) {
  await db.query('UPDATE users SET banned = TRUE, ban_reason = $2, banned_at = NOW() WHERE id = $1', [userId, clip(reason || 'MapHack', 200)]);
  try { await roles().revokeOnBan(userId); } catch {}
  try { await db.query('INSERT INTO maphack_events (user_id, tool, warnings, banned) VALUES ($1, $2, NULL, TRUE)', [userId, clip(reason, 64)]); } catch {}
  await db.query(`UPDATE anticheat_cases SET status = 'banned', decided_by = $2, decided_at = NOW(), decision_note = COALESCE(decision_note, $3) WHERE user_id = $1 AND status IN ('new','nominated')`, [userId, by?.id || null, clip(reason, 500)]);
  if (_io) for (const s of [...(_io.sockets?.sockets?.values?.() || [])]) {
    if (String(s.user?.id) === String(userId)) { try { s.emit('user:banned', { reason }); s.disconnect(true); } catch {} }
  }
  console.log(`[AntiCheat] БАН — user #${userId}: ${reason} (эзэн ${by?.username || by?.id || '?'})`);
}

// ── Эрхийн шалгалт ──
const need = (fn) => async (req, res, next) => { try { const sc = await scopeOf(req.user); if (!fn(sc, req.user)) return res.status(403).json({ error: 'Эрх хүрэхгүй' }); req.acScope = sc; next(); } catch { res.status(500).json({ error: 'Server error' }); } };
const staffOrRoomAdmin = need((sc) => !!sc);
const ownerOnly = need((sc, u) => isOwner(u));

async function loadCase(id) {
  const r = await db.query(`SELECT c.*, u.username, u.discord_id, u.account_no, u.tierbot_tier AS tier, COALESCE(u.banned,FALSE) AS user_banned, u.ban_reason,
      n.username AS nominated_by_name, d.username AS decided_by_name, rm.name AS room_name,
      (SELECT COUNT(*)::int FROM anticheat_cases x WHERE x.user_id = c.user_id) AS user_cases
    FROM anticheat_cases c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users n ON n.id = c.nominated_by
    LEFT JOIN users d ON d.id = c.decided_by LEFT JOIN rooms rm ON rm.id = c.room_id WHERE c.id = $1`, [id]);
  return r.rows[0] || null;
}

// Жагсаалт: ?status=open (new+nominated, анхдагч) | nominated | closed (dismissed+banned) | all
router.get('/cases', authMW, staffOrRoomAdmin, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'db unavailable' });
  try {
    const st = String(req.query.status || 'open');
    const where = st === 'nominated' ? "c.status = 'nominated'" : st === 'closed' ? "c.status IN ('dismissed','banned')" : st === 'all' ? 'TRUE' : "c.status IN ('new','nominated')";
    const params = []; let scopeSql = '';
    if (req.acScope !== 'all') { params.push(Number(String(req.acScope).slice(5))); scopeSql = ` AND c.room_id = $${params.length}`; }
    const r = await db.query(`SELECT c.id, c.user_id, c.kind, c.tool, c.severity, c.detail, c.room_id, c.hits, c.status, c.nominate_note, c.nominated_at, c.decision_note, c.decided_at, c.created_at, c.last_at,
        u.username, u.account_no, u.tierbot_tier AS tier, COALESCE(u.banned,FALSE) AS user_banned, n.username AS nominated_by_name, d.username AS decided_by_name, rm.name AS room_name,
        (SELECT COUNT(*)::int FROM anticheat_cases x WHERE x.user_id = c.user_id) AS user_cases
      FROM anticheat_cases c LEFT JOIN users u ON u.id = c.user_id LEFT JOIN users n ON n.id = c.nominated_by LEFT JOIN users d ON d.id = c.decided_by LEFT JOIN rooms rm ON rm.id = c.room_id
      WHERE ${where}${scopeSql} ORDER BY (c.status = 'nominated') DESC, (c.severity = 'high') DESC, c.last_at DESC LIMIT 200`, params);
    const cnt = await db.query(`SELECT COUNT(*) FILTER (WHERE status = 'new')::int AS new, COUNT(*) FILTER (WHERE status = 'nominated')::int AS nominated FROM anticheat_cases c WHERE TRUE${scopeSql}`, params);
    return res.json({ cases: r.rows.map((c) => ({ ...c, kind_label: KIND_LABEL[c.kind] || c.kind })), counts: cnt.rows[0], is_owner: isOwner(req.user), scope: req.acScope });
  } catch (e) { console.error('[acCases] list:', e.message); return res.status(500).json({ error: 'Server error' }); }
});
router.get('/cases/count', authMW, staffOrRoomAdmin, async (req, res) => {
  if (!await dbOk()) return res.json({ new: 0, nominated: 0 });
  try {
    const params = []; let scopeSql = '';
    if (req.acScope !== 'all') { params.push(Number(String(req.acScope).slice(5))); scopeSql = ` AND room_id = $1`; }
    const r = await db.query(`SELECT COUNT(*) FILTER (WHERE status = 'new')::int AS new, COUNT(*) FILTER (WHERE status = 'nominated')::int AS nominated FROM anticheat_cases WHERE TRUE${scopeSql}`, params);
    return res.json({ ...r.rows[0], is_owner: isOwner(req.user) });
  } catch { return res.json({ new: 0, nominated: 0 }); }
});

// ADMIN (эсвэл эзэн): бан жагсаалтад санал болгох — тайлбар заавал
router.post('/cases/:id/nominate', authMW, staffOrRoomAdmin, async (req, res) => {
  try {
    const c = await loadCase(req.params.id); if (!c || !canSee(req.acScope, c)) return res.status(404).json({ error: 'Хэрэг олдсонгүй' });
    if (!['new', 'nominated'].includes(c.status)) return res.status(409).json({ error: 'Энэ хэрэг аль хэдийн шийдэгдсэн' });
    const note = clip(String(req.body?.note || '').trim(), 500);
    if (note.length < 3) return res.status(400).json({ error: 'Тайлбар бичнэ үү (яагаад бан хийх ёстой вэ)' });
    await db.query(`UPDATE anticheat_cases SET status = 'nominated', nominated_by = $2, nominate_note = $3, nominated_at = NOW() WHERE id = $1`, [c.id, req.user.id, note]);
    notify({ case_id: c.id, user_id: c.user_id, username: c.username, kind: c.kind, kind_label: KIND_LABEL[c.kind], tool: c.tool, nominated: true, by_username: req.user.username, note }, c.room_id);
    return res.json({ ok: true });
  } catch (e) { console.error('[acCases] nominate:', e.message); return res.status(500).json({ error: 'Server error' }); }
});
// Хэрэгсэхгүй: ADMIN — зөвхөн «new» хэргийг; эзэн — аль ч нээлттэйг
router.post('/cases/:id/dismiss', authMW, staffOrRoomAdmin, async (req, res) => {
  try {
    const c = await loadCase(req.params.id); if (!c || !canSee(req.acScope, c)) return res.status(404).json({ error: 'Хэрэг олдсонгүй' });
    if (!['new', 'nominated'].includes(c.status)) return res.status(409).json({ error: 'Энэ хэрэг аль хэдийн шийдэгдсэн' });
    if (c.status === 'nominated' && !isOwner(req.user)) return res.status(403).json({ error: 'Бан санал болгосон хэргийг зөвхөн эзэн шийднэ' });
    await db.query(`UPDATE anticheat_cases SET status = 'dismissed', decided_by = $2, decision_note = $3, decided_at = NOW() WHERE id = $1`, [c.id, req.user.id, clip(req.body?.note || '', 500) || null]);
    // «Цаашид үл тоох» — зөвхөн эзэн/глобал ADMIN, зөвхөн шалгах шаардлагатай (review) memory/module хэрэгт
    let ignored = 0;
    if (req.body?.ignore && req.acScope === 'all' && c.severity !== 'high') {
      const d = c.detail || {};
      const sigs = c.kind === 'memory' && d.sig ? [String(d.sig)] : c.kind === 'module' && Array.isArray(d.modules) ? d.modules.map((m) => String(m).split(/[\\/]/).pop().toLowerCase()) : [];
      for (const sg of sigs) { try { await db.query('INSERT INTO anticheat_ignores (kind, sig, note, created_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [c.kind, clip(sg, 2000), clip(req.body?.note || '', 300), req.user.id]); ignored++; } catch {} }
    }
    return res.json({ ok: true, ignored });
  } catch (e) { console.error('[acCases] dismiss:', e.message); return res.status(500).json({ error: 'Server error' }); }
});
// ЭЗЭН: хэргээр бан
router.post('/cases/:id/ban', authMW, ownerOnly, async (req, res) => {
  try {
    const c = await loadCase(req.params.id); if (!c) return res.status(404).json({ error: 'Хэрэг олдсонгүй' });
    if (isOwner({ id: c.user_id, discord_id: c.discord_id })) return res.status(400).json({ error: 'Эзнийг бандах боломжгүй' });
    const reason = clip(String(req.body?.note || '').trim() || `MapHack: ${KIND_LABEL[c.kind] || c.kind} «${c.tool || ''}»`, 200);
    await banUser(c.user_id, reason.startsWith('MapHack') ? reason : `MapHack: ${reason}`, req.user);
    await db.query('UPDATE anticheat_cases SET decision_note = $2 WHERE id = $1', [c.id, reason]);
    return res.json({ ok: true, username: c.username });
  } catch (e) { console.error('[acCases] ban:', e.message); return res.status(500).json({ error: 'Server error' }); }
});
// ЭЗЭН: хэрэггүйгээр шууд бан / цуцлах (нэр дээр баруун товч)
router.post('/users/:uid/ban', authMW, ownerOnly, async (req, res) => {
  try {
    const uid = Number.parseInt(req.params.uid, 10); if (!Number.isInteger(uid)) return res.status(400).json({ error: 'Буруу хэрэглэгч' });
    const u = (await db.query('SELECT id, username, discord_id, COALESCE(banned,FALSE) AS banned FROM users WHERE id = $1', [uid])).rows[0];
    if (!u) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    if (isOwner(u) || String(uid) === String(req.user.id)) return res.status(400).json({ error: 'Эзнийг бандах боломжгүй' });
    const reason = clip(String(req.body?.reason || '').trim() || 'Эзний шийдвэр', 200);
    await banUser(uid, reason, req.user);
    return res.json({ ok: true, username: u.username });
  } catch (e) { console.error('[acCases] direct ban:', e.message); return res.status(500).json({ error: 'Server error' }); }
});
router.post('/users/:uid/unban', authMW, ownerOnly, async (req, res) => {
  try {
    const uid = Number.parseInt(req.params.uid, 10); if (!Number.isInteger(uid)) return res.status(400).json({ error: 'Буруу хэрэглэгч' });
    const r = await db.query('UPDATE users SET banned = FALSE, ban_reason = NULL, banned_at = NULL, maphack_warnings = 0 WHERE id = $1 RETURNING username', [uid]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    console.log(`[AntiCheat] бан цуцлав — user #${uid} (${r.rows[0].username}) — эзэн ${req.user.username}`);
    return res.json({ ok: true, username: r.rows[0].username });
  } catch (e) { console.error('[acCases] unban:', e.message); return res.status(500).json({ error: 'Server error' }); }
});
router.get('/users/:uid/status', authMW, staffOrRoomAdmin, async (req, res) => {
  try {
    const r = await db.query('SELECT id, username, COALESCE(banned,FALSE) AS banned, ban_reason, banned_at FROM users WHERE id = $1', [req.params.uid]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    const open = await db.query("SELECT COUNT(*)::int AS n FROM anticheat_cases WHERE user_id = $1 AND status IN ('new','nominated')", [req.params.uid]);
    return res.json({ ...r.rows[0], open_cases: open.rows[0].n, can_ban: isOwner(req.user) });
  } catch { return res.status(500).json({ error: 'Server error' }); }
});

// Эзэн/глобал ADMIN: WC3 сессийн мэдээлэл — хэн шалгагдсан/шалгагдаагүй, Game.dll хувилбар/хэшийн тархалт (олонхоос ялгаатай = сэжигтэй)
router.get('/wc3info', authMW, need((sc) => sc === 'all'), async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'db unavailable' });
  const rows = (await db.query('SELECT w.*, u.username FROM anticheat_wc3_info w JOIN users u ON u.id = w.user_id ORDER BY w.last_at DESC LIMIT 300')).rows;
  const hashes = {};
  for (const r of rows) if (r.game_sha) hashes[r.game_sha] = (hashes[r.game_sha] || 0) + 1;
  res.json({ rows, hashes, total: rows.length });
});

module.exports = { router, ensureTables, setIO, setSystemDM, openCase, recordWc3Info, banUser, KINDS, KIND_LABEL, _scopeOf: scopeOf };
