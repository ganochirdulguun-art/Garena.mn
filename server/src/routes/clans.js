// ══════════════════════════════════════════════════════════════
// Кланууд (2026-09-30) — GameRanger X-ийн Clans маяг.
//  • Клан байгуулах: зөвхөн хамгийн өндөр Premium (GOLD) гишүүн — эсвэл платформын эзэн/админ.
//  • Хоёр төрөл: 'player' (тоглогчийн клан) ба 'discord' (бүртгэлтэй Discord серверийн клан).
//  • Эрх: lord (Clan Lord, 1) · admin · member. Lord/Admin: хүсэлт батлах/татгалзах, гишүүн нэмэх/хасах.
//    Lord: admin томилох/буулгах, кланы мэдээлэл засах, Lord шилжүүлэх, клан устгах.
//  • Кланы өрөө (rooms.clan_id): зөвхөн тухайн кланы гишүүд харж, үүсгэж, нэгдэнэ (rooms.js-ээс clanAccess-ийг дуудна).
// ══════════════════════════════════════════════════════════════
const express = require('express');
const auth = require('../middleware/auth');
const adminMW = require('../middleware/admin');

let db;
try { db = require('../config/db'); } catch { db = null; }

const router = express.Router();
let _io = null;
function setIO(io) { _io = io; }

async function dbOk() {
  if (!db) return false;
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

const ROLES = ['lord', 'admin', 'member'];
const NAME_RE = /^[\p{L}\p{N} ._\-]{3,32}$/u;
const TAG_RE = /^[A-Za-z0-9А-Яа-яӨөҮүЁё]{2,6}$/u;

async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS clans (
        id           SERIAL PRIMARY KEY,
        name         VARCHAR(40) NOT NULL,
        tag          VARCHAR(8)  NOT NULL,
        description  VARCHAR(300) DEFAULT '',
        kind         VARCHAR(10) NOT NULL DEFAULT 'player',
        discord_server_id INTEGER,
        guild_id     VARCHAR(30),
        invite_url   TEXT,
        icon_url     TEXT,
        join_mode    VARCHAR(10) NOT NULL DEFAULT 'request',
        owner_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at   TIMESTAMP DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS clans_name_unique ON clans (LOWER(name));
      CREATE UNIQUE INDEX IF NOT EXISTS clans_tag_unique ON clans (LOWER(tag));
      CREATE UNIQUE INDEX IF NOT EXISTS clans_discord_unique ON clans (discord_server_id) WHERE discord_server_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS clan_members (
        clan_id   INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
        user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role      VARCHAR(10) NOT NULL DEFAULT 'member',
        joined_at TIMESTAMP DEFAULT NOW(),
        PRIMARY KEY (clan_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS clan_members_user ON clan_members(user_id);
      CREATE TABLE IF NOT EXISTS clan_requests (
        id         SERIAL PRIMARY KEY,
        clan_id    INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message    VARCHAR(200) DEFAULT '',
        status     VARCHAR(10) NOT NULL DEFAULT 'pending',
        decided_by INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        decided_at TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS clan_requests_pending ON clan_requests(clan_id, user_id) WHERE status = 'pending';
      -- Кланы урилга (2026-10-03, эзэн): Lord/админ хүний нэр дээр баруун товч → «Кланд урих»; хүлээн авагч 🔔-оос Нэгдэх/татгалзах
      CREATE TABLE IF NOT EXISTS clan_invites (
        id         SERIAL PRIMARY KEY,
        clan_id    INTEGER NOT NULL REFERENCES clans(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        invited_by INTEGER,
        status     VARCHAR(10) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        decided_at TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS clan_invites_pending ON clan_invites(clan_id, user_id) WHERE status = 'pending';
      ALTER TABLE rooms ADD COLUMN IF NOT EXISTS clan_id INTEGER REFERENCES clans(id) ON DELETE SET NULL;
      ALTER TABLE clans ADD COLUMN IF NOT EXISTS icon_data BYTEA;
      ALTER TABLE clans ADD COLUMN IF NOT EXISTS icon_mime VARCHAR(20);
    `);
  } catch (e) { console.error('[Migration] clans:', e.message); }
}
// Хүснэгтүүдийг зөвхөн db/migrate.js дараалан үүсгэнэ (модуль ачаалахад зэрэг ажиллуулбал 'deadlock detected', 2026-09-30)

function isPlatformStaff(user) { return adminMW.isOwnerUser(user); }
async function isStaff(user) {
  if (isPlatformStaff(user)) return true;
  try { return await adminMW.isAdminDiscordId(user?.discord_id); } catch { return false; }
}
async function topTier(userId) {
  try { const { tierOf } = require('./membership'); return (await tierOf(userId)) === 'gold'; } catch { return false; }
}
async function roleOf(clanId, userId) {
  const r = await db.query('SELECT role FROM clan_members WHERE clan_id = $1 AND user_id = $2', [clanId, userId]);
  return r.rows[0]?.role || null;
}
/** Кланы өрөөнд хандах эрх: гишүүн бол true (rooms.js ашиглана). clanId хоосон бол true. */
async function clanAccess(userId, clanId) {
  if (clanId === null || clanId === undefined || clanId === '') return true;
  if (!await dbOk()) return false;
  try { return !!(await roleOf(clanId, userId)); } catch { return false; }
}
/** Хэрэглэгчийн гишүүн кланы id-ууд (өрөөний жагсаалтыг шүүхэд). */
async function memberClanIds(userId) {
  if (!userId || !await dbOk()) return [];
  try {
    const r = await db.query('SELECT clan_id FROM clan_members WHERE user_id = $1', [userId]);
    return r.rows.map((x) => Number(x.clan_id));
  } catch { return []; }
}
// Кланы нэрийг мэдэгдэлд хавсаргана (🔔 мэдэгдлийн цэс, 2026-10-03)
async function clanName(id) { try { const r = await db.query('SELECT name FROM clans WHERE id = $1', [id]); return r.rows[0]?.name || ''; } catch { return ''; } }
function notify(userIds, payload) {
  if (!_io) return;
  (Array.isArray(userIds) ? userIds : [userIds]).forEach((id) => { try { _io.to(`user:${id}`).emit('clan:updated', payload); } catch {} });
}
async function clanManagers(clanId) {
  const r = await db.query("SELECT user_id FROM clan_members WHERE clan_id = $1 AND role IN ('lord','admin')", [clanId]);
  return r.rows.map((x) => x.user_id);
}
function bad(res, code, error, extra) { return res.status(code).json({ error, ...(extra || {}) }); }

async function loadClan(id) {
  const r = await db.query(`
    SELECT c.id, c.name, c.tag, c.description, c.kind, c.discord_server_id, c.guild_id, c.invite_url, c.icon_url, c.join_mode, c.owner_id, c.created_at,
      u.username AS owner_name,
      (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id)::int AS member_count
    FROM clans c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = $1`, [id]);
  return r.rows[0] || null;
}

// ── Жагсаалт (Discover) — ?q= хайлт, ?kind=player|discord ──
router.get('/', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const q = String(req.query.q || '').trim().slice(0, 40);
    const kind = ['player', 'discord'].includes(req.query.kind) ? req.query.kind : null;
    const r = await db.query(`
      SELECT c.id, c.name, c.tag, c.description, c.kind, c.icon_url, c.invite_url, c.join_mode, c.created_at,
        u.username AS owner_name,
        (SELECT COUNT(*) FROM clan_members m WHERE m.clan_id = c.id)::int AS member_count,
        (SELECT role FROM clan_members m WHERE m.clan_id = c.id AND m.user_id = $1) AS my_role,
        EXISTS (SELECT 1 FROM clan_requests q WHERE q.clan_id = c.id AND q.user_id = $1 AND q.status = 'pending') AS my_pending
      FROM clans c LEFT JOIN users u ON u.id = c.owner_id
      WHERE ($2 = '' OR c.name ILIKE '%' || $2 || '%' OR c.tag ILIKE '%' || $2 || '%')
        AND ($3::text IS NULL OR c.kind = $3)
      ORDER BY member_count DESC, c.created_at ASC
      LIMIT 200`, [req.user.id, q, kind]);
    return res.json(r.rows);
  } catch (e) { console.error('[clans] list', e.message); return bad(res, 500, 'Server error'); }
});

// ── Миний кланууд + байгуулах эрх ──
router.get('/mine', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const r = await db.query(`
      SELECT c.id, c.name, c.tag, c.description, c.kind, c.icon_url, c.invite_url, c.join_mode, m.role,
        (SELECT COUNT(*) FROM clan_members x WHERE x.clan_id = c.id)::int AS member_count,
        (SELECT COUNT(*) FROM clan_requests q WHERE q.clan_id = c.id AND q.status = 'pending')::int AS pending_count
      FROM clan_members m JOIN clans c ON c.id = m.clan_id
      WHERE m.user_id = $1 ORDER BY (m.role = 'lord') DESC, c.name`, [req.user.id]);
    const staff = await isStaff(req.user);
    const gold = await topTier(req.user.id);
    return res.json({ clans: r.rows, can_create: staff || gold, is_staff: staff, need_tier: 'gold' });
  } catch (e) { console.error('[clans] mine', e.message); return bad(res, 500, 'Server error'); }
});

// ── Нэг клан: мэдээлэл + гишүүд (+ хүсэлтүүд — зөвхөн lord/admin) ──
// Миний хүлээгдэж буй урилгууд (🔔 цэс асах үед ачаална — офлайн байхад ирсэн урилга ч харагдана)
router.get('/invites', auth, async (req, res) => {
  if (!await dbOk()) return res.json({ invites: [] });
  try {
    const r = await db.query(`
      SELECT i.id, i.clan_id, c.name AS clan_name, c.tag AS clan_tag, u.username AS by_username, i.created_at
      FROM clan_invites i JOIN clans c ON c.id = i.clan_id LEFT JOIN users u ON u.id = i.invited_by
      WHERE i.user_id = $1 AND i.status = 'pending' ORDER BY i.created_at DESC LIMIT 20`, [req.user.id]);
    return res.json({ invites: r.rows });
  } catch (e) { console.error('[clans] invites', e.message); return res.json({ invites: [] }); }
});
// ↑ '/:id'-ээс ӨМНӨ байх ёстой (эс бөгөөс 'invites'-ийг кланы id гэж барина)
router.get('/:id', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const clan = await loadClan(req.params.id);
    if (!clan) return bad(res, 404, 'Клан олдсонгүй');
    const myRole = await roleOf(clan.id, req.user.id);
    const mem = await db.query(`
      SELECT u.id::text AS id, u.username, u.avatar_url, u.tierbot_tier, m.role, m.joined_at
      FROM clan_members m JOIN users u ON u.id = m.user_id WHERE m.clan_id = $1
      ORDER BY CASE m.role WHEN 'lord' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.joined_at`, [clan.id]);
    let requests = [];
    if (myRole === 'lord' || myRole === 'admin') {
      const rq = await db.query(`
        SELECT q.id, q.user_id::text AS user_id, u.username, u.discord_username, u.avatar_url, q.message, q.created_at
        FROM clan_requests q JOIN users u ON u.id = q.user_id
        WHERE q.clan_id = $1 AND q.status = 'pending' ORDER BY q.created_at`, [clan.id]);
      requests = rq.rows;
    }
    const pend = await db.query("SELECT 1 FROM clan_requests WHERE clan_id = $1 AND user_id = $2 AND status = 'pending'", [clan.id, req.user.id]);
    return res.json({ ...clan, my_role: myRole, my_pending: pend.rows.length > 0, members: mem.rows, requests });
  } catch (e) { console.error('[clans] get', e.message); return bad(res, 500, 'Server error'); }
});

// ── Клан байгуулах (GOLD) — kind: 'player' | 'discord' (discord_server_id) ──
router.post('/', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  const uid = req.user.id;
  const name = String(req.body?.name || '').trim();
  const tag = String(req.body?.tag || '').trim();
  const description = String(req.body?.description || '').trim().slice(0, 300);
  const joinMode = req.body?.join_mode === 'open' ? 'open' : 'request';
  const kind = req.body?.kind === 'discord' ? 'discord' : 'player';
  if (!NAME_RE.test(name)) return bad(res, 400, 'Кланы нэр 3–32 тэмдэгт (үсэг, тоо, зай, . _ -) байна');
  if (!TAG_RE.test(tag)) return bad(res, 400, 'Таг 2–6 үсэг/тоо байна');
  try {
    const staff = await isStaff(req.user);
    if (!staff && !await topTier(uid)) {
      return bad(res, 403, 'Клан байгуулах нь зөвхөн GOLD гишүүнд нээлттэй', { code: 'TIER_REQUIRED', need_tier: 'gold' });
    }
    if (!staff) {
      const owned = await db.query("SELECT 1 FROM clan_members WHERE user_id = $1 AND role = 'lord'", [uid]);
      if (owned.rows.length) return bad(res, 409, 'Та аль хэдийн нэг кланы Lord байна');
    }
    let ds = null;
    if (kind === 'discord') {
      const dsId = Number(req.body?.discord_server_id);
      if (!dsId) return bad(res, 400, 'Discord сервер сонгоно уу');
      const d = await db.query('SELECT * FROM discord_servers WHERE id = $1', [dsId]);
      ds = d.rows[0];
      if (!ds) return bad(res, 404, 'Discord сервер олдсонгүй');
      if (!staff && String(ds.added_by_id) !== String(uid)) return bad(res, 403, 'Зөвхөн энэ Discord серверийг бүртгүүлсэн хүн клан болгож болно');
    }
    const dup = await db.query('SELECT 1 FROM clans WHERE LOWER(name) = LOWER($1) OR LOWER(tag) = LOWER($2)', [name, tag]);
    if (dup.rows.length) return bad(res, 409, 'Ийм нэр эсвэл тагтай клан байна');
    const icon = ds?.guild_id && ds?.guild_icon ? `https://cdn.discordapp.com/icons/${ds.guild_id}/${ds.guild_icon}.png?size=128` : null;
    const ins = await db.query(`
      INSERT INTO clans (name, tag, description, kind, discord_server_id, guild_id, invite_url, icon_url, join_mode, owner_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [name, tag, description, kind, ds?.id || null, ds?.guild_id || null, ds?.invite_url || null, icon, joinMode, uid]);
    const clan = ins.rows[0];
    await db.query("INSERT INTO clan_members (clan_id, user_id, role) VALUES ($1,$2,'lord')", [clan.id, uid]);
    return res.status(201).json({ ...clan, my_role: 'lord', member_count: 1 });
  } catch (e) {
    if (e.code === '23505') return bad(res, 409, 'Ийм нэр, таг эсвэл Discord сервертэй клан байна');
    console.error('[clans] create', e.message); return bad(res, 500, 'Server error');
  }
});

// ── Засах (Lord) — description, join_mode ──
router.patch('/:id', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const role = await roleOf(req.params.id, req.user.id);
    if (role !== 'lord' && !await isStaff(req.user)) return bad(res, 403, 'Зөвхөн Clan Lord засна');
    const sets = []; const vals = [];
    if (req.body?.description !== undefined) { vals.push(String(req.body.description).trim().slice(0, 300)); sets.push(`description = $${vals.length}`); }
    if (req.body?.join_mode !== undefined) { vals.push(req.body.join_mode === 'open' ? 'open' : 'request'); sets.push(`join_mode = $${vals.length}`); }
    if (!sets.length) return bad(res, 400, 'Өөрчлөх зүйл алга');
    vals.push(req.params.id);
    const r = await db.query(`UPDATE clans SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING id, name, tag, description, join_mode, icon_url`, vals);
    return res.json(r.rows[0] || {});
  } catch (e) { console.error('[clans] patch', e.message); return bad(res, 500, 'Server error'); }
});

// ── Устгах (Lord эсвэл эзэн) — кланы хүлээлгийн өрөөнүүдийг хаана ──
router.delete('/:id', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const role = await roleOf(req.params.id, req.user.id);
    if (role !== 'lord' && !await isStaff(req.user)) return bad(res, 403, 'Зөвхөн Clan Lord устгана');
    const mem = await db.query('SELECT user_id FROM clan_members WHERE clan_id = $1', [req.params.id]);
    await db.query("UPDATE rooms SET status = 'done' WHERE clan_id = $1 AND status = 'waiting'", [req.params.id]);
    await db.query('DELETE FROM clans WHERE id = $1', [req.params.id]);
    notify(mem.rows.map((x) => x.user_id), { clan_id: Number(req.params.id), deleted: true });
    return res.json({ ok: true });
  } catch (e) { console.error('[clans] delete', e.message); return bad(res, 500, 'Server error'); }
});

// ── Кланы зураг (лого) — Lord эсвэл эзэн оруулна: { image: data:image/png|jpeg|webp;base64 ≤ 1MB } ──
router.post('/:id/icon', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const role = await roleOf(req.params.id, req.user.id);
    if (role !== 'lord' && !await isStaff(req.user)) return bad(res, 403, 'Зөвхөн Clan Lord кланы зургийг солино');
    const { parseImageDataUrl } = require('./roomBg');
    const img = parseImageDataUrl(req.body?.image, 1024 * 1024);
    if (!img) return bad(res, 400, 'JPG/PNG/WebP зураг, 1MB-с ихгүй байх ёстой');
    const base = `${req.protocol}://${req.get('host')}`;
    const url = `${base}/clans/${Number(req.params.id)}/icon?v=${Date.now().toString(36)}`;
    await db.query('UPDATE clans SET icon_data = $1, icon_mime = $2, icon_url = $3 WHERE id = $4', [img.buf, img.mime, url, req.params.id]);
    return res.json({ ok: true, icon_url: url });
  } catch (e) { console.error('[clans] icon', e.message); return bad(res, 500, 'Server error'); }
});
// Зургийг нээлттэй үйлчилнэ (<img> токен илгээдэггүй; кланы лого нууц биш)
router.get('/:id/icon', async (req, res) => {
  if (!await dbOk()) return res.status(503).end();
  try {
    const r = await db.query('SELECT icon_data, icon_mime FROM clans WHERE id = $1', [req.params.id]);
    const row = r.rows[0];
    if (!row?.icon_data) return res.status(404).end();
    res.set({ 'Content-Type': row.icon_mime || 'image/png', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    return res.end(row.icon_data);
  } catch { return res.status(500).end(); }
});

// ── Нэгдэх: open → шууд гишүүн; request → хүсэлт ──
router.post('/:id/join', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const clan = await loadClan(req.params.id);
    if (!clan) return bad(res, 404, 'Клан олдсонгүй');
    if (await roleOf(clan.id, req.user.id)) return res.json({ ok: true, status: 'member' });
    if (clan.join_mode === 'open') {
      await db.query("INSERT INTO clan_members (clan_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [clan.id, req.user.id]);
      return res.json({ ok: true, status: 'member' });
    }
    const msg = String(req.body?.message || '').trim().slice(0, 200);
    await db.query("INSERT INTO clan_requests (clan_id, user_id, message) VALUES ($1,$2,$3) ON CONFLICT (clan_id, user_id) WHERE status = 'pending' DO NOTHING", [clan.id, req.user.id, msg]);
    notify(await clanManagers(clan.id), { clan_id: clan.id, request: true, clan_name: clan.name, from_user_id: req.user.id, from_username: req.user.username, message: msg });
    return res.json({ ok: true, status: 'pending' });
  } catch (e) { console.error('[clans] join', e.message); return bad(res, 500, 'Server error'); }
});

// ── Кланы урилга (2026-10-03): Lord/админ → хэрэглэгч ──
router.post('/:id/invite', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const role = await roleOf(req.params.id, req.user.id);
    if (role !== 'lord' && role !== 'admin') return bad(res, 403, 'Зөвхөн Clan Lord эсвэл админ урина');
    const uid = Number.parseInt(req.body?.user_id, 10);
    if (!Number.isInteger(uid)) return bad(res, 400, 'Хэрэглэгч заана уу');
    if (String(uid) === String(req.user.id)) return bad(res, 400, 'Өөрийгөө урих боломжгүй');
    const u = await db.query('SELECT id, username FROM users WHERE id = $1', [uid]);
    if (!u.rows[0]) return bad(res, 404, 'Хэрэглэгч олдсонгүй');
    if (await roleOf(req.params.id, uid)) return bad(res, 409, `${u.rows[0].username} аль хэдийн энэ кланд байна`);
    const name = await clanName(req.params.id);
    const ins = await db.query(
      `INSERT INTO clan_invites (clan_id, user_id, invited_by) VALUES ($1, $2, $3)
       ON CONFLICT (clan_id, user_id) WHERE status = 'pending' DO UPDATE SET invited_by = EXCLUDED.invited_by, created_at = NOW()
       RETURNING id`, [req.params.id, uid, req.user.id]);
    notify(uid, { clan_id: Number(req.params.id), invite: true, invite_id: ins.rows[0]?.id, clan_name: name, by_username: req.user.username });
    return res.json({ ok: true, invite_id: ins.rows[0]?.id, username: u.rows[0].username, clan_name: name });
  } catch (e) { console.error('[clans] invite', e.message); return bad(res, 500, 'Server error'); }
});
router.post('/invites/:iid/:action(accept|decline)', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const r = await db.query("SELECT * FROM clan_invites WHERE id = $1 AND user_id = $2 AND status = 'pending'", [req.params.iid, req.user.id]);
    const inv = r.rows[0]; if (!inv) return bad(res, 404, 'Урилга олдсонгүй (хугацаа дууссан эсвэл цуцлагдсан)');
    const accept = req.params.action === 'accept';
    await db.query('UPDATE clan_invites SET status = $1, decided_at = NOW() WHERE id = $2', [accept ? 'accepted' : 'declined', inv.id]);
    if (accept) {
      await db.query("INSERT INTO clan_members (clan_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [inv.clan_id, req.user.id]);
      await db.query("UPDATE clan_requests SET status = 'accepted', decided_at = NOW() WHERE clan_id = $1 AND user_id = $2 AND status = 'pending'", [inv.clan_id, req.user.id]);
    }
    const name = await clanName(inv.clan_id);
    notify(await clanManagers(inv.clan_id), { clan_id: Number(inv.clan_id), invite_answer: accept ? 'accepted' : 'declined', clan_name: name, from_username: req.user.username });
    return res.json({ ok: true, accepted: accept, clan_id: Number(inv.clan_id), clan_name: name });
  } catch (e) { console.error('[clans] invite answer', e.message); return bad(res, 500, 'Server error'); }
});

// ── Хүсэлтээ цуцлах ──
router.delete('/:id/join', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    await db.query("UPDATE clan_requests SET status = 'cancelled', decided_at = NOW() WHERE clan_id = $1 AND user_id = $2 AND status = 'pending'", [req.params.id, req.user.id]);
    return res.json({ ok: true });
  } catch (e) { return bad(res, 500, 'Server error'); }
});

// ── Хүсэлт батлах / татгалзах (Lord, Admin) ──
router.post('/:id/requests/:rid/:action(accept|decline)', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const role = await roleOf(req.params.id, req.user.id);
    if (role !== 'lord' && role !== 'admin') return bad(res, 403, 'Зөвхөн Clan Lord эсвэл админ');
    const rq = await db.query("SELECT * FROM clan_requests WHERE id = $1 AND clan_id = $2 AND status = 'pending'", [req.params.rid, req.params.id]);
    const r = rq.rows[0];
    if (!r) return bad(res, 404, 'Хүсэлт олдсонгүй');
    const accept = req.params.action === 'accept';
    await db.query('UPDATE clan_requests SET status = $1, decided_by = $2, decided_at = NOW() WHERE id = $3', [accept ? 'accepted' : 'declined', req.user.id, r.id]);
    if (accept) await db.query("INSERT INTO clan_members (clan_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [r.clan_id, r.user_id]);
    notify(r.user_id, { clan_id: Number(r.clan_id), accepted: accept, declined: !accept, clan_name: await clanName(r.clan_id), by_username: req.user.username });
    return res.json({ ok: true });
  } catch (e) { console.error('[clans] decide', e.message); return bad(res, 500, 'Server error'); }
});

// ── Гишүүн нэмэх (Lord, Admin) — user_id эсвэл username ──
router.post('/:id/members', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const role = await roleOf(req.params.id, req.user.id);
    if (role !== 'lord' && role !== 'admin') return bad(res, 403, 'Зөвхөн Clan Lord эсвэл админ');
    const ref = String(req.body?.user_id || req.body?.username || '').trim();
    if (!ref) return bad(res, 400, 'Хэрэглэгч заана уу');
    const u = /^\d+$/.test(ref)
      ? await db.query('SELECT id, username FROM users WHERE id = $1', [ref])
      : await db.query('SELECT id, username FROM users WHERE LOWER(username) = LOWER($1)', [ref]);
    if (u.rows.length !== 1) return bad(res, 404, 'Хэрэглэгч олдсонгүй');
    const target = u.rows[0];
    await db.query("INSERT INTO clan_members (clan_id, user_id, role) VALUES ($1,$2,'member') ON CONFLICT DO NOTHING", [req.params.id, target.id]);
    await db.query("UPDATE clan_requests SET status = 'accepted', decided_by = $1, decided_at = NOW() WHERE clan_id = $2 AND user_id = $3 AND status = 'pending'", [req.user.id, req.params.id, target.id]);
    notify(target.id, { clan_id: Number(req.params.id), added: true, clan_name: await clanName(req.params.id), by_username: req.user.username });
    return res.json({ ok: true, user: { id: String(target.id), username: target.username } });
  } catch (e) { console.error('[clans] add', e.message); return bad(res, 500, 'Server error'); }
});

// ── Гишүүн хасах (Lord: хэнийг ч (өөрөөс бусад); Admin: зөвхөн member) ──
router.delete('/:id/members/:uid', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const myRole = await roleOf(req.params.id, req.user.id);
    const theirRole = await roleOf(req.params.id, req.params.uid);
    if (!theirRole) return bad(res, 404, 'Гишүүн олдсонгүй');
    if (theirRole === 'lord') return bad(res, 403, 'Clan Lord-ыг хасах боломжгүй');
    const allowed = myRole === 'lord' || (myRole === 'admin' && theirRole === 'member');
    if (!allowed) return bad(res, 403, 'Эрх хүрэхгүй');
    await db.query('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2', [req.params.id, req.params.uid]);
    notify(req.params.uid, { clan_id: Number(req.params.id), removed: true, clan_name: await clanName(req.params.id) });
    return res.json({ ok: true });
  } catch (e) { console.error('[clans] remove', e.message); return bad(res, 500, 'Server error'); }
});

// ── Эрх өөрчлөх (зөвхөн Lord): admin ↔ member; role='lord' → Lord шилжүүлэх ──
router.patch('/:id/members/:uid', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const role = String(req.body?.role || '');
    if (!ROLES.includes(role)) return bad(res, 400, 'Буруу эрх');
    if (await roleOf(req.params.id, req.user.id) !== 'lord') return bad(res, 403, 'Зөвхөн Clan Lord');
    const theirRole = await roleOf(req.params.id, req.params.uid);
    if (!theirRole || String(req.params.uid) === String(req.user.id)) return bad(res, 400, 'Гишүүн олдсонгүй');
    if (role === 'lord') {
      await db.query("UPDATE clan_members SET role = 'admin' WHERE clan_id = $1 AND user_id = $2", [req.params.id, req.user.id]);
      await db.query("UPDATE clan_members SET role = 'lord' WHERE clan_id = $1 AND user_id = $2", [req.params.id, req.params.uid]);
      await db.query('UPDATE clans SET owner_id = $1 WHERE id = $2', [req.params.uid, req.params.id]);
    } else {
      await db.query('UPDATE clan_members SET role = $1 WHERE clan_id = $2 AND user_id = $3', [role, req.params.id, req.params.uid]);
    }
    notify(req.params.uid, { clan_id: Number(req.params.id), role, clan_name: await clanName(req.params.id) });
    return res.json({ ok: true });
  } catch (e) { console.error('[clans] role', e.message); return bad(res, 500, 'Server error'); }
});

// ── Кланаас гарах (Lord гарахгүй — эхлээд шилжүүлнэ эсвэл устгана) ──
router.post('/:id/leave', auth, async (req, res) => {
  if (!await dbOk()) return bad(res, 503, 'Service temporarily unavailable');
  try {
    const role = await roleOf(req.params.id, req.user.id);
    if (!role) return res.json({ ok: true });
    if (role === 'lord') return bad(res, 409, 'Clan Lord гарахаасаа өмнө Lord эрхээ шилжүүлэх эсвэл кланаа устгана');
    await db.query('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2', [req.params.id, req.user.id]);
    return res.json({ ok: true });
  } catch (e) { return bad(res, 500, 'Server error'); }
});

module.exports = { router, setIO, clanAccess, memberClanIds, ensureTables };
