// ── 📡 Радар — relay capture-аас hero-гийн хөдөлгөөн/үхлийн симуляц (2026-09-06, эзний хүсэлт) ──
// Урсгал (replay): relay тоглоом дуусахад hostbot/reportGame.js → radarExtract → POST /relay/radar (x-relay-key)
//   → radar_games. Апп/вэб: GET /radar/games (жагсаалт), GET /radar/:token (бүрэн өгөгдөл).
// Урсгал (LIVE, Шат 2): VPS hostbot/radarLive.js 5 с тутамд POST /relay/radar/live (delta) → санах ойн LIVE store
//   → GET /radar/live (жагсаалт), GET /radar/live/:token?since= (саатал ХЭРЭГЖҮҮЛСЭН харагдац).
// ЭРХ (эзний шийдвэр 2026-09-06): Радар = GOLD гишүүнчлэлийн онцлог. Эзэн → 0 с саатал. GOLD → 120 с саатал.
//   Bronze/Silver → GET /radar/access {ok:false} + GET /radar/demo (дууссан тоглолтын үзүүлэнгийн симуляц).
//   Саатлыг ХЭН Ч богиносгохгүй (шүүгч/админ/зохион байгуулагч бүгд 120 с); тоглолтын оролцогч өөрийн тоглолтыг харахгүй.
// Тоглоомын замд (relay, LAN proxy) огт хүрэхгүй — бүх ажил capture файл дээр, тусдаа процессоор.
const express = require('express');
const crypto = require('crypto');
const authMW = require('../middleware/auth');
const adminMW = require('../middleware/admin');
const lanhost = require('./lanhost');

let db;
try { db = require('../config/db'); } catch { db = null; }
let roomRoutes = null;
try { roomRoutes = require('./rooms'); } catch { roomRoutes = null; }

const REPORT_KEY = process.env.RELAY_REPORT_KEY || '';
const MAX_PATH_POINTS = 20000;     // нэг тоглогчид
const MAX_PLAYERS = 12;
const PUBLIC_DELAY_SEC = 120;      // эзнээс бусад ХЭН Ч — өөрчлөхгүй
const OWNER_DELAY_SEC = 0;
const LIVE_KEEP_AFTER_END_MS = (PUBLIC_DELAY_SEC + 60) * 1000;   // дууссаны дараа саатлын үзэгчид дуусгаж үзнэ
const LIVE_STALE_MS = 10 * 60 * 1000;                             // daemon-оос 10 мин мэдээ ирэхгүй бол хаяна

// DotA hero код → нэр + icon (config/dota_heroes.json — DotA 6.72 replay-parser хүснэгт + Dota 2 slug).
let HEROES = {};
try { HEROES = require('../config/dota_heroes.json'); } catch { HEROES = {}; }
const ICON_BASE = 'https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/icons/';
// Icon эрэмбэ: (1) ОРИГИНАЛ WC3/DotA BTN icon — public/assets/heroes/<code>.png (эзний шаардлага); (2) Dota 2 CDN fallback.
const LOCAL_BASE = (process.env.PUBLIC_BASE_URL || 'https://garenamn-production.up.railway.app').replace(/\/$/, '');
function heroInfo(code) {
  const h = code ? HEROES[code] : null;
  if (!h) return { hero_name: code || null, hero_proper: null, hero_icon: null };
  const icon = h.icon ? `${LOCAL_BASE}${h.icon}` : (h.d2 ? `${ICON_BASE}${h.d2}.png` : null);
  return { hero_name: h.name || code, hero_proper: h.proper || null, hero_icon: icon };
}
const enrichPlayers = (players) => (Array.isArray(players) ? players : []).map((p) => ({ ...p, ...heroInfo(p.hero) }));

function keyOk(req) {
  const k = String(req.headers['x-relay-key'] || '');
  if (!REPORT_KEY || !k || k.length !== REPORT_KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(k), Buffer.from(REPORT_KEY));
}

// Ирсэн payload-ыг цэвэрлэж (хэмжээ, төрөл), DB-д бичих хэлбэрт оруулна — цэвэр функц (tests/radar.test.js)
function sanitizeRadar(b) {
  const token = String(b.game_token || '').replace(/[^0-9a-f]/gi, '').slice(0, 64);
  if (!token) throw new Error('game_token дутуу');
  const players = (Array.isArray(b.players) ? b.players : []).slice(0, MAX_PLAYERS).map((p) => ({
    pid: Number(p.pid) | 0, colour: Number(p.colour) | 0, team: Number(p.team) === 2 ? 2 : 1,
    name: p.name ? String(p.name).slice(0, 32) : null,
    hero: p.hero ? String(p.hero).slice(0, 8) : null,
    hero_orders: Number(p.hero_orders) | 0,
  }));
  const paths = {};
  for (const [pid, arr] of Object.entries(b.paths || {})) {
    if (!/^\d+$/.test(pid) || !Array.isArray(arr)) continue;
    paths[pid] = arr.slice(0, MAX_PATH_POINTS)
      .filter((q) => Array.isArray(q) && q.length >= 3 && q.every((v) => Number.isFinite(Number(v))))
      .map((q) => [Math.round(q[0]), Math.round(q[1]), Math.round(q[2])]);
  }
  const kills = (Array.isArray(b.kills) ? b.kills : []).slice(0, 500)
    .filter((k) => k && Number.isFinite(Number(k.t)))
    .map((k) => ({ t: Math.round(k.t), killer: Number(k.killer) | 0, victim: Number(k.victim) | 0 }));
  const events = (Array.isArray(b.events) ? b.events : []).slice(0, 2000)
    .filter((e) => e && Number.isFinite(Number(e.t)) && e.key)
    .map((e) => ({ t: Math.round(e.t), key: String(e.key).slice(0, 32), v: Number(e.v) >>> 0 }));
  return {
    token, players, paths, kills, events,
    game_time_sec: Math.max(0, Number(b.game_time_sec) | 0),
    winner_team: [1, 2].includes(Number(b.winner_team)) ? Number(b.winner_team) : null,
    map_name: b.map_name ? String(b.map_name).slice(0, 120) : null,
    // ended_at: ISO мөр ЭСВЭЛ Unix ms тоо (relay meta.endedAt тоо байдаг) — аль нь ч биш бол одоо
    played_at: (typeof b.ended_at === 'number' && b.ended_at > 1e12) ? new Date(b.ended_at)
      : (b.ended_at && !Number.isNaN(Date.parse(b.ended_at)) ? new Date(b.ended_at) : new Date()),
  };
}

// Жагсаалтын мөр (жижиг) — бүрэн paths ачаалахгүй
function summaryRow(r) {
  const players = Array.isArray(r.players) ? r.players : [];
  return {
    token: r.token, room_id: r.room_id, room_name: r.room_name, host_name: r.host_name, map_name: r.map_name,
    game_time_sec: r.game_time_sec, winner_team: r.winner_team, kills: Array.isArray(r.kills) ? r.kills.length : Number(r.kill_count || 0),
    players: enrichPlayers(players.map((p) => ({ pid: p.pid, team: p.team, name: p.name, hero: p.hero }))),
    played_at: r.played_at,
  };
}

// ── Эрх: эзэн 0 с / GOLD 120 с / бусад — үгүй ──
function goldActive(row) {
  if (!row || String(row.membership || '').toLowerCase() !== 'gold') return false;
  const until = row.membership_until ? new Date(row.membership_until).getTime() : 0;
  return until > Date.now();
}
const accessCache = new Map();   // userId → { at, res } (30 с) — 5 с тутмын poll-д DB-г дарахгүй
async function resolveAccess(user) {
  if (!user || user.id == null) return { ok: false, tier: 'guest', need: 'gold', delay_sec: PUBLIC_DELAY_SEC };
  if (adminMW.isOwnerUser(user)) return { ok: true, tier: 'owner', delay_sec: OWNER_DELAY_SEC };
  const c = accessCache.get(String(user.id));
  if (c && Date.now() - c.at < 30 * 1000) return c.res;
  let row = null;
  try { if (db) row = (await db.query('SELECT membership, membership_until FROM users WHERE id = $1', [user.id])).rows[0] || null; } catch {}
  const tier = row ? String(row.membership || 'bronze').toLowerCase() : 'bronze';
  const res = goldActive(row) ? { ok: true, tier: 'gold', delay_sec: PUBLIC_DELAY_SEC }
    : { ok: false, tier: goldActive(row) ? tier : (tier === 'gold' ? 'bronze' : tier), need: 'gold', delay_sec: PUBLIC_DELAY_SEC };
  accessCache.set(String(user.id), { at: Date.now(), res });
  return res;
}
const requireAccess = async (req, res, next) => {
  const a = await resolveAccess(req.user);
  if (!a.ok) return res.status(403).json({ error: 'Радар — GOLD гишүүнчлэлийн онцлог', ...a });
  req.radarAccess = a; next();
};

// ── LIVE store (санах ой) ──
const LIVE = new Map();   // token → live game
function sweepLive(now = Date.now()) {
  for (const [t, g] of LIVE) {
    if ((g.ended_at && now - g.ended_at > LIVE_KEEP_AFTER_END_MS) || now - g.updated_at > LIVE_STALE_MS) LIVE.delete(t);
  }
}
// daemon-ийн delta-г нэгтгэнэ (fromMs=0 → бүтнээр солино) — цэвэр функц
function mergeLive(g, s, gameTimeMs, fromMs, now = Date.now()) {
  if (fromMs <= 0) { g.paths = {}; g.kills = []; g.events = []; }
  for (const [pid, arr] of Object.entries(s.paths)) {
    const cur = g.paths[pid] || (g.paths[pid] = []);
    for (const q of arr) if (!cur.length || q[0] > cur[cur.length - 1][0] || fromMs > 0) cur.push(q);
    if (cur.length > MAX_PATH_POINTS) cur.splice(0, cur.length - MAX_PATH_POINTS);
  }
  g.kills.push(...s.kills); g.events.push(...s.events);
  const oldNames = {}; for (const p of g.players || []) if (p.name) oldNames[p.pid] = p.name;
  g.players = s.players.map((p) => ({ ...p, name: p.name || oldNames[p.pid] || null }));
  g.game_time_ms = Math.max(g.game_time_ms || 0, gameTimeMs);
  g.offset_ms = now - g.game_time_ms;      // wall ↔ тоглоомын цаг; сүүлийн хэмжилт (саатал ХЭЗЭЭ Ч богиносохгүй тал руу)
  g.updated_at = now;
  return g;
}
// Үзэгчийн харах эрхтэй тоглоомын цаг (ms): wall − саатал − offset; өгөгдлийн захаас хэтрэхгүй
function visibleMs(g, delaySec, now = Date.now()) {
  const tv = now - delaySec * 1000 - (g.offset_ms || 0);
  return Math.max(-1, Math.min(tv, g.game_time_ms || 0));
}
// Саатал хэрэгжүүлсэн харагдац — цэвэр функц (tests). since ≥ 0 бол delta (t > since)
function visibleView(g, tv, since = -1) {
  const paths = {};
  for (const [pid, arr] of Object.entries(g.paths || {})) paths[pid] = arr.filter((q) => q[0] <= tv && q[0] > since);
  const firstT = (pid) => { const a = g.paths?.[pid]; return a && a.length ? a[0][0] : Infinity; };
  const players = (g.players || []).filter((p) => firstT(p.pid) <= tv);
  return {
    game_time_ms: Math.max(0, tv), game_time_sec: Math.max(0, Math.floor(tv / 1000)),
    players: enrichPlayers(players), paths,
    kills: (g.kills || []).filter((k) => k.t <= tv && k.t > since),
    events: (g.events || []).filter((e) => e.t <= tv && e.t > since),
  };
}
function isParticipant(g, user) {
  if (!user) return true;
  if (g.participants?.has(String(user.id))) return true;
  const u = String(user.username || '').trim().toLowerCase();
  if (u && (g.players || []).some((p) => p.name && p.name.trim().toLowerCase() === u)) return true;
  return false;
}
async function liveMeta(token, s) {
  const meta = { room_id: null, room_name: null, host_name: null, host_user_id: null, participants: new Set() };
  try {
    const game = await lanhost.findGameByToken(token);
    if (game) {
      meta.room_id = game.room_id ?? null; meta.host_user_id = game.host_user_id ?? null;
      if (meta.host_user_id != null) meta.participants.add(String(meta.host_user_id));
      const room = meta.room_id != null && roomRoutes?.memRooms ? roomRoutes.memRooms.get(Number(meta.room_id)) || roomRoutes.memRooms.get(meta.room_id) : null;
      if (room) { meta.room_name = room.name || null; for (const id of (room.players?.keys?.() || [])) meta.participants.add(String(id)); }
      if (!meta.room_name && meta.room_id && db) { try { meta.room_name = (await db.query('SELECT name FROM rooms WHERE id = $1', [meta.room_id])).rows[0]?.name || null; } catch {} }
      if (meta.host_user_id && db) { try { meta.host_name = (await db.query('SELECT username FROM users WHERE id = $1', [meta.host_user_id])).rows[0]?.username || null; } catch {} }
      if (!meta.host_name) meta.host_name = game.host_wc3_name || null;
    }
  } catch (e) { console.warn('[Radar live] meta:', e.message); }
  if (!meta.host_name) meta.host_name = (s.players.find((p) => p.pid === 1) || {}).name || null;
  if (!meta.room_name) meta.room_name = meta.host_name ? `${meta.host_name}-ын тоглолт` : null;
  return meta;
}
function liveRow(g, delaySec, now = Date.now()) {
  const tv = visibleMs(g, delaySec, now);
  const v = visibleView(g, tv);
  return {
    token: g.token, room_id: g.room_id, room_name: g.room_name, host_name: g.host_name, map_name: g.map_name,
    started_at: g.started_at, live: true, ended: !!g.ended_at, delay_sec: delaySec,
    visible_in_sec: tv < 0 ? Math.ceil((-(now - delaySec * 1000 - (g.offset_ms || 0))) / 1000) : 0,
    game_time_sec: v.game_time_sec, kills: v.kills.length,
    players: v.players.map((p) => ({ pid: p.pid, team: p.team, name: p.name, hero: p.hero, hero_name: p.hero_name, hero_icon: p.hero_icon })),
  };
}

// ── relay → сервер ──
const relayRouter = express.Router();
relayRouter.post('/radar', async (req, res) => {
  if (!keyOk(req)) return res.status(401).json({ error: 'relay key' });
  if (!db) return res.status(503).json({ error: 'db' });
  let s;
  try { s = sanitizeRadar(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
  // Хоосон/туршилтын capture (тоглогч < 2 эсвэл < 60 с) — жагсаалтыг бохирдуулахгүй
  if (s.players.length < 2 || s.game_time_sec < 60) return res.status(202).json({ ok: false, reason: 'too-small', players: s.players.length, sec: s.game_time_sec });
  let roomId = null, roomName = null, hostName = null;
  try {
    const game = await lanhost.findGameByToken(s.token);
    if (game) {
      roomId = game.room_id ?? null;
      if (roomId) { const rr = await db.query('SELECT name FROM rooms WHERE id = $1', [roomId]); roomName = rr.rows[0]?.name || null; }
      if (game.host_user_id) { const hr = await db.query('SELECT username FROM users WHERE id = $1', [game.host_user_id]); hostName = hr.rows[0]?.username || game.host_wc3_name || null; }
      else hostName = game.host_wc3_name || null;
    }
  } catch (e) { console.warn('[Radar] lookup:', e.message); }
  if (!hostName) hostName = (s.players.find((p) => p.pid === 1) || {}).name || null;
  // Өрөө тоглолтын дараа устдаг тул нэр нь ихэвчлэн байхгүй → хостын нэрээр нэрлэнэ (клиент "Өрөө #?" гэж харуулахгүй)
  if (!roomName) roomName = hostName ? `${hostName}-ын тоглолт` : null;
  try {
    await db.query(
      `INSERT INTO radar_games (token, room_id, room_name, host_name, game_time_sec, winner_team, players, kills, events, paths, map_name, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (token) DO UPDATE SET players = EXCLUDED.players, kills = EXCLUDED.kills, events = EXCLUDED.events, paths = EXCLUDED.paths,
         game_time_sec = EXCLUDED.game_time_sec, winner_team = EXCLUDED.winner_team, room_id = COALESCE(EXCLUDED.room_id, radar_games.room_id),
         room_name = COALESCE(EXCLUDED.room_name, radar_games.room_name), host_name = COALESCE(EXCLUDED.host_name, radar_games.host_name),
         played_at = EXCLUDED.played_at, map_name = COALESCE(EXCLUDED.map_name, radar_games.map_name)`,
      [s.token, roomId, roomName, hostName, s.game_time_sec, s.winner_team, JSON.stringify(s.players), JSON.stringify(s.kills),
       JSON.stringify(s.events), JSON.stringify(s.paths), s.map_name, s.played_at],
    );
    const pts = Object.values(s.paths).reduce((n, a) => n + a.length, 0);
    console.log(`[Radar] хадгалав token=${s.token.slice(0, 12)} room=${roomId} ${s.game_time_sec}с тоглогч=${s.players.length} цэг=${pts} kill=${s.kills.length}`);
    const live = LIVE.get(s.token); if (live && !live.ended_at) live.ended_at = Date.now();
    return res.json({ ok: true, token: s.token, room_id: roomId, points: pts });
  } catch (e) {
    console.error('[Radar] хадгалалт:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// LIVE delta (hostbot/radarLive.js, 5 с тутам). from_ms=0 → бүтэн; store-д байхгүй + from_ms>0 → 409 (бүтнээр дахин)
relayRouter.post('/radar/live', async (req, res) => {
  if (!keyOk(req)) return res.status(401).json({ error: 'relay key' });
  const b = req.body || {};
  let s;
  try { s = sanitizeRadar(b); } catch (e) { return res.status(400).json({ error: e.message }); }
  const gameTimeMs = Math.max(0, Number(b.game_time_ms) | 0), fromMs = Math.max(0, Number(b.from_ms) | 0);
  sweepLive();
  let g = LIVE.get(s.token);
  if (!g && fromMs > 0) return res.status(409).json({ need_full: true });
  if (!g) {
    const meta = await liveMeta(s.token, s);
    g = { token: s.token, started_at: (typeof b.started_at === 'number' && b.started_at > 1e12) ? new Date(b.started_at).toISOString() : new Date().toISOString(),
      map_name: s.map_name || 'DotA v6.74c LoD v5e', players: [], paths: {}, kills: [], events: [], game_time_ms: 0, offset_ms: 0, updated_at: Date.now(), ended_at: null, ...meta };
    LIVE.set(s.token, g);
    console.log(`[Radar live] эхлэв token=${s.token.slice(0, 12)} room=${g.room_id} host=${g.host_name} оролцогч=${g.participants.size}`);
  }
  mergeLive(g, s, gameTimeMs, fromMs);
  if (b.ended && !g.ended_at) { g.ended_at = Date.now(); console.log(`[Radar live] дуусав token=${s.token.slice(0, 12)} t=${Math.round(g.game_time_ms / 1000)}с`); }
  return res.json({ ok: true, game_time_ms: g.game_time_ms, viewers: 0 });
});

// ── апп/вэб ──
const router = express.Router();
router.get('/access', authMW, async (req, res) => res.json(await resolveAccess(req.user)));

// Bronze/Silver-т үзүүлэнгийн симуляц (дууссан, kill олонтой тоглолт) — GOLD шаардахгүй
let demoCache = { at: 0, row: null };
router.get('/demo', authMW, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'db' });
  try {
    if (!demoCache.row || Date.now() - demoCache.at > 10 * 60 * 1000) {
      const r = await db.query(`SELECT * FROM radar_games WHERE game_time_sec BETWEEN 900 AND 3600 AND jsonb_array_length(players) >= 6
        ORDER BY jsonb_array_length(kills) DESC, played_at DESC LIMIT 1`);
      demoCache = { at: Date.now(), row: r.rows[0] || null };
    }
    const g = demoCache.row;
    if (!g) return res.status(404).json({ error: 'демо тоглолт алга' });
    const base = `https://${req.get('host')}`;
    return res.json({
      demo: true, token: g.token, room_name: g.room_name, host_name: g.host_name, map_name: g.map_name,
      game_time_sec: g.game_time_sec, winner_team: g.winner_team, players: enrichPlayers(g.players), kills: g.kills, events: g.events, paths: g.paths,
      played_at: g.played_at, minimap_url: `${base}/assets/radar/lod-minimap@2x.png`, bounds: { x0: -8192, x1: 8192, y0: -8192, y1: 8192 },
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.get('/live', authMW, requireAccess, (req, res) => {
  sweepLive();
  const d = req.radarAccess.delay_sec, owner = req.radarAccess.tier === 'owner';
  const rows = [];
  for (const g of LIVE.values()) {
    if (!owner && isParticipant(g, req.user)) continue;
    rows.push(liveRow(g, d));
  }
  rows.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  return res.json({ delay_sec: d, tier: req.radarAccess.tier, games: rows });
});

router.get('/live/:token', authMW, requireAccess, (req, res) => {
  const token = String(req.params.token || '').replace(/[^0-9a-f]/gi, '').slice(0, 64);
  const g = LIVE.get(token);
  if (!g) return res.status(404).json({ error: 'live тоглолт олдсонгүй (дууссан байж магадгүй — Replay жагсаалтаас үз)' });
  const owner = req.radarAccess.tier === 'owner';
  if (!owner && isParticipant(g, req.user)) return res.status(403).json({ error: 'Өөрийн оролцож буй тоглолтын радарыг харах боломжгүй' });
  const d = req.radarAccess.delay_sec;
  const tv = visibleMs(g, d);
  const since = req.query.since != null ? Math.max(-1, Number(req.query.since) | 0) : -1;
  const v = visibleView(g, tv, since);
  const base = `https://${req.get('host')}`;
  return res.json({
    live: true, delay_sec: d, tier: req.radarAccess.tier, token: g.token, room_id: g.room_id, room_name: g.room_name, host_name: g.host_name, map_name: g.map_name,
    started_at: g.started_at, ended: !!g.ended_at, visible_in_sec: tv < 0 ? Math.ceil(-(Date.now() - d * 1000 - (g.offset_ms || 0)) / 1000) : 0,
    ...v, minimap_url: `${base}/assets/radar/lod-minimap@2x.png`, bounds: { x0: -8192, x1: 8192, y0: -8192, y1: 8192 },
  });
});

router.get('/games', authMW, requireAccess, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'db' });
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  try {
    const r = await db.query(
      `SELECT token, room_id, room_name, host_name, map_name, game_time_sec, winner_team, players, jsonb_array_length(kills) AS kill_count, played_at
       FROM radar_games ORDER BY played_at DESC LIMIT $1`, [limit]);
    const base = `https://${req.get('host')}`;
    return res.json({ minimap_url: `${base}/assets/radar/lod-minimap@2x.png`, delay_sec: req.radarAccess.delay_sec, tier: req.radarAccess.tier, games: r.rows.map(summaryRow) });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.get('/:token', authMW, requireAccess, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'db' });
  const token = String(req.params.token || '').replace(/[^0-9a-f]/gi, '').slice(0, 64);
  if (!token) return res.status(400).json({ error: 'token' });
  try {
    const r = await db.query('SELECT * FROM radar_games WHERE token = $1', [token]);
    if (!r.rows[0]) return res.status(404).json({ error: 'радар олдсонгүй' });
    const g = r.rows[0];
    const base = `https://${req.get('host')}`;
    return res.json({
      token: g.token, room_id: g.room_id, room_name: g.room_name, host_name: g.host_name, map_name: g.map_name,
      game_time_sec: g.game_time_sec, winner_team: g.winner_team, players: enrichPlayers(g.players), kills: g.kills, events: g.events, paths: g.paths,
      played_at: g.played_at, minimap_url: `${base}/assets/radar/lod-minimap@2x.png`,
      bounds: { x0: -8192, x1: 8192, y0: -8192, y1: 8192 },   // LoD 6.74c: war3map.w3e 129×129 tile, center −8192
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

module.exports = { router, relayRouter, sanitizeRadar, summaryRow, heroInfo, goldActive, mergeLive, visibleMs, visibleView, isParticipant, liveRow, PUBLIC_DELAY_SEC, OWNER_DELAY_SEC, _LIVE: LIVE };
