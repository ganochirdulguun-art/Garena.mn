// ── Тоглогч-хост LAN (RGC/GameRanger загвар) ──
// Өрөөний гишүүн ӨӨРИЙН PC дээр WC3 LAN тоглоом нээнэ. Клиент нь public relay-ээр
// дамжуулан бусад гишүүдтэй холбогдоно. Платформ зөвхөн ДОХИОЛОЛ хийнэ:
//   POST /rooms/:id/lan-host/begin    → host relay endpoint + game token авна
//   POST /rooms/:id/lan-host/announce → GAMEINFO зарлана → room:lan_lobby (зөвхөн өрөөнд)
//   DELETE /rooms/:id/lan-host/:token → зогсооно → room:lan_lobby_gone
//   GET /rooms/:id/lan-host           → өрөөний идэвхтэй тоглоомууд (шинэ гишүүнд)
// ӨРӨӨ-ТУСГААРЛАЛТ: бүх emit нь _io.to(roomId) → зөвхөн тухайн өрөөний гишүүд харна.
const express = require('express');
const crypto = require('crypto');
const authMW = require('../middleware/auth');

let roomRoutes = null;
try { roomRoutes = require('./rooms'); } catch { roomRoutes = null; }
let db = null;
try { db = require('../config/db'); } catch { db = null; }

let _io = null;
function setIO(io) { _io = io; }
function emitRoom(roomId, event, payload) { if (_io && roomId) _io.to(String(roomId)).emit(event, payload); }

// Өрөөнд идэвхтэй LAN тоглоом байвал өрөөг 'playing' (тоглолт эхэлсэн) болгоно → гаднын хүн
// нэгдэж чадахгүй. Тоглоом дуусаж/зогсоод хоосон болвол 'waiting' болгож дахин нээлттэй болгоно.
async function syncRoomStatus(roomId) {
  if (!db) return;
  const m = roomGames.get(String(roomId));
  const active = !!(m && m.size > 0);
  try {
    if (active) await db.query("UPDATE rooms SET status='playing', playing_since=NOW() WHERE id=$1 AND status='waiting'", [roomId]);
    else await db.query("UPDATE rooms SET status='waiting', playing_since=NULL WHERE id=$1 AND status='playing'", [roomId]);
    if (_io) _io.emit('rooms:updated');
  } catch (e) { /* статус синк алдаа — эмзэг биш */ }
}

// Relay серверүүд (public IP) — платформ хостод зааж өгнө.
// 2026-09-28: олон relay + автомат failover. LAN_RELAY_IP/PORT = үндсэн; LAN_RELAY_FALLBACKS="ip:port,ip:port" = нөөц.
// Сервер relay бүрийг 30с тутам TCP-ээр шалгана; үндсэн нь 3 удаа дараалан хариу өгөхгүй бол ШИНЭ тоглолтууд
// дараагийн эрүүл relay-г авна (эхэлсэн тоглолт өөрийн relay-дээ үлдэнэ). Бүгд унасан бол үндсэнийг өгнө.
const RELAY_KEY = process.env.LAN_RELAY_KEY || '';   // MVP: заавал биш (game_token = таамаглашгүй, өрөө-хамрах тусгаарлалт)
function parseRelays() {
  const out = [];
  const add = (ip, port) => { ip = String(ip || '').trim(); port = Number(port || 7000); if (ip && !out.some((r) => r.ip === ip && r.port === port)) out.push({ ip, port, fails: 0, ok: true, checkedAt: 0 }); };
  add(process.env.LAN_RELAY_IP, process.env.LAN_RELAY_PORT);
  for (const part of String(process.env.LAN_RELAY_FALLBACKS || '').split(',')) { const [ip, port] = part.split(':'); add(ip, port); }
  return out;
}
const RELAYS = parseRelays();
const RELAY_IP = RELAYS[0]?.ip || '';          // хуучин экспорт/тестүүдэд
const RELAY_PORT = RELAYS[0]?.port || 7000;
const FAILS_TO_DOWN = 3;
// 2026-10-01: үндсэн relay олон процесст хуваагдсан (CPU core бүрт нэг) — LAN_RELAY_SHARD_PORTS="7000,7001,7002,7003".
// Тоглоом бүрийн портыг токены hash-аар тодорхойлно (детерминист → сервер restart-ын дараа ч хост/joiner ижил портыг авна).
// Зөвхөн үндсэн relay-д хамаарна; failover-ын нөөц relay өөрийн нэг портоороо үлдэнэ.
const SHARD_PORTS = String(process.env.LAN_RELAY_SHARD_PORTS || '').split(',').map((x) => Number(String(x).trim())).filter((p) => Number.isInteger(p) && p > 0 && p < 65536);
function shardFor(r, token) {
  if (!r || !SHARD_PORTS.length || r !== RELAYS[0]) return r;
  const h = crypto.createHash('sha1').update(String(token)).digest().readUInt32BE(0);
  return { ip: r.ip, port: SHARD_PORTS[h % SHARD_PORTS.length] };
}
function relayConfigured() { return RELAYS.length > 0; }
function currentRelay() { return RELAYS.find((r) => r.fails < FAILS_TO_DOWN) || RELAYS[0] || null; }
function probeRelay(r, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const sock = require('net').connect({ host: r.ip, port: r.port });
    const done = (ok) => { try { sock.destroy(); } catch {} resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
  });
}
async function checkRelays() {
  for (const r of RELAYS) {
    const ok = await probeRelay(r);
    const wasUp = r.fails < FAILS_TO_DOWN;
    r.fails = ok ? 0 : r.fails + 1; r.ok = ok; r.checkedAt = Date.now();
    const isUp = r.fails < FAILS_TO_DOWN;
    if (wasUp !== isUp) console.warn(`[LAN] relay ${r.ip}:${r.port} ${isUp ? 'ДАХИН АМЬД' : 'УНАСАН'} → одоогийн relay ${currentRelay()?.ip}`);
  }
}
if (RELAYS.length > 1 && process.env.NODE_ENV !== 'test') {
  setInterval(() => { checkRelays().catch(() => {}); }, 30 * 1000).unref?.();
  setTimeout(() => { checkRelays().catch(() => {}); }, 3000).unref?.();
}
// Ш3 (2026-09-28): ХОСТ-ТАЛЫН бичлэг — mesh (P2P) тоглолтод урсгал relay-ээр дамждаггүй тул хост клиент өөрөө бичиж
// LAN_CAPTURE_RELAY ("ip:port", шинэ relay.js + RELAY_REPORT_KEY-тэй) руу урсгана. key = HMAC(RELAY_REPORT_KEY, token)[:32] —
// зөвхөн /begin-ийн хариуд (хостод) очно, lobby payload-д ОРОХГҮЙ тул joiner хуурамч бичлэг илгээж чадахгүй.
const CAPTURE_RELAY = (() => { const [ip, port] = String(process.env.LAN_CAPTURE_RELAY || '').split(':'); return ip ? { ip, port: Number(port || 7000) } : null; })();
function captureFor(token) {
  const k = process.env.RELAY_REPORT_KEY || '';
  if (!CAPTURE_RELAY || !k) return null;
  return { ip: CAPTURE_RELAY.ip, port: CAPTURE_RELAY.port, key: crypto.createHmac('sha256', k).update(String(token)).digest('hex').slice(0, 32) };
}
function isMeshIp(ip) { const p = String(ip || '').split('.').map(Number); return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255); }

// /begin-д хостод өгсөн relay-г токеноор санана → /announce joiner-уудад ЯГ ТЭР relay-г өгнө (failover дундуур зөрөхгүй)
const beginRelay = new Map();   // token -> { ip, port, at }
function rememberBegin(token, r, userId = null, roomId = null) {
  beginRelay.set(token, { ip: r.ip, port: r.port, at: Date.now(), user_id: userId, room_id: roomId == null ? null : String(roomId) });
  if (beginRelay.size > 5000) { const cut = Date.now() - 6 * 3600 * 1000; for (const [k, v] of beginRelay) if (v.at < cut) beginRelay.delete(k); }
}

// Өрөөний төрөл (kind/game_type) — хэзээ ч өөрчлөгддөггүй тул санах ойд кэшлэнэ (announce бүрт DB асуухгүй)
const _roomMeta = new Map();
async function roomMeta(roomId) {
  const k = String(roomId);
  if (_roomMeta.has(k)) return _roomMeta.get(k);
  if (!db) return null;
  try {
    const r = await db.query("SELECT COALESCE(kind,'room') AS kind, game_type FROM rooms WHERE id = $1", [k]);
    const v = r.rows[0] || null;
    if (v) { _roomMeta.set(k, v); if (_roomMeta.size > 2000) _roomMeta.delete(_roomMeta.keys().next().value); }
    return v;
  } catch { return null; }
}

// Санах ой дахь идэвхтэй тоглоомууд: roomId -> Map<token, game>
const roomGames = new Map();

function sanitizeWc3Name(s) { const v = String(s || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 31); return v || null; }

async function inRoom(userId, roomId) {
  try { return roomRoutes && await roomRoutes.isUserInRoom(userId, roomId); } catch { return false; }
}
function gamesOf(roomId) { let m = roomGames.get(String(roomId)); if (!m) { m = new Map(); roomGames.set(String(roomId), m); } return m; }
function gamePublic(g) {
  // endpoints (Ш3, клиент 2.9+): эхлээд шууд mesh, дараа нь relay. Хуучин клиент relay_ip/port-ыг л ашиглана.
  const endpoints = [];
  if (g.direct) endpoints.push({ type: 'direct', ip: g.direct.ip, port: g.direct.port });
  endpoints.push({ type: 'relay', ip: g.relay_ip, port: g.relay_port });
  return { game_token: g.token, relay_ip: g.relay_ip, relay_port: g.relay_port, gameinfo_b64: g.gameinfo_b64, endpoints,
           host_user_id: g.host_user_id, host_username: g.host_username, host_wc3_name: g.host_wc3_name, created_at: g.created_at,
           started_at: g.started_at || null };
}

// Хэрэглэгчийн бүх тоглоомыг өрөөнөөс устгах (leave/disconnect дээр index.js дуудна)
function removeUserGames(roomId, userId) {
  const m = roomGames.get(String(roomId));
  if (!m) return;
  for (const [tok, g] of [...m.entries()]) {
    if (String(g.host_user_id) === String(userId)) {
      m.delete(tok);
      emitRoom(roomId, 'room:lan_lobby_gone', { game_token: tok });
    }
  }
  if (!m.size) roomGames.delete(String(roomId));
  syncRoomStatus(roomId);   // хостын тоглоом устсан бол өрөөг 'waiting' болгоно (fire-and-forget)
}
function clearRoom(roomId) { roomGames.delete(String(roomId)); syncRoomStatus(roomId); }

const router = express.Router();

// Хост тоглоом нээхээр бэлдэнэ — relay endpoint + game token авна
router.post('/:id/lan-host/begin', authMW, async (req, res) => {
  const roomId = String(req.params.id);
  if (!relayConfigured()) return res.status(503).json({ error: 'LAN relay тохируулаагүй' });
  if (!await inRoom(req.user.id, roomId)) return res.status(403).json({ error: 'Та энэ өрөөнд байхгүй байна' });
  // Нийтийн Room 1–20: LAN тоглоом нээх (host) эрх зөвхөн Moderator / эзэн / админ (2026-10-02)
  if (db) {
    try {
      const k = await db.query("SELECT COALESCE(kind,'room') AS kind, game_type FROM rooms WHERE id=$1", [roomId]);
      // WC3 LAN relay зөвхөн Warcraft III-ийн нийтийн Room-д (CS/Q3 — ipserver, Red Alert 2 — хараахан алга)
      if (k.rows[0]?.kind === 'channel' && k.rows[0]?.game_type && !/warcraft|frozen throne/i.test(k.rows[0].game_type)) {
        return res.status(400).json({ error: 'Энэ тоглоомын онлайн холболт удахгүй нээгдэнэ.', code: 'GAME_NOT_READY' });
      }
      if (k.rows[0]?.kind === 'channel' && !await require('./roles').canHostInChannel(req.user, roomId)) {
        return res.status(403).json({ error: 'Нийтийн Room-д тоглоом нээх эрх зөвхөн Moderator-д. Зарлалын самбар дээрх «Moderator авах» товчоор хүсэлт илгээнэ үү.', code: 'MODERATOR_REQUIRED' });
      }
    } catch {}
  }
  const token = crypto.randomBytes(18).toString('hex');   // санамсаргүй, таамаглах боломжгүй → зөвхөн өрөөнд тарна
  const r = shardFor(currentRelay(), token);
  rememberBegin(token, r, req.user.id, roomId);
  return res.json({ game_token: token, relay_ip: r.ip, relay_port: r.port, relay_key: RELAY_KEY, capture: captureFor(token) });
});

// GAMEINFO зарлах / шинэчлэх → room:lan_lobby (зөвхөн өрөөнд)
router.post('/:id/lan-host/announce', authMW, async (req, res) => {
  const roomId = String(req.params.id);
  const { game_token, gameinfo_b64, host_wc3_name, direct } = req.body || {};
  if (!relayConfigured()) return res.status(503).json({ error: 'LAN relay тохируулаагүй' });
  if (!await inRoom(req.user.id, roomId)) return res.status(403).json({ error: 'Та энэ өрөөнд байхгүй байна' });
  if (!game_token || !gameinfo_b64) return res.status(400).json({ error: 'game_token/gameinfo_b64 дутуу' });
  if (String(gameinfo_b64).length > 4096) return res.status(400).json({ error: 'gameinfo хэт урт' });
  if (String(game_token).length > 64) return res.status(400).json({ error: 'game_token хэт урт' });
  // ── Токены эзэмшил (аудит 2026-10-02): /announce нь /begin-ийн эрхийн шалгалтыг тойрч, мөн өөр өрөөнөөс бусдын токеныг
  //    зарлаж хостын дүнг булаах боломжтой байв. Одоо: (1) токен өөр өрөөнд/өөр хостод идэвхтэй бол татгалзана,
  //    (2) /begin-ээр олгогдсон бол яг тэр хэрэглэгч+өрөө байх ёстой, (3) сервер restart-ын дараа DB мөрөөр баталгаажуулна,
  //    (4) нийтийн Room-д announce бүрт Moderator эрх + WC3 эсэхийг дахин шалгана.
  const tok = String(game_token);
  for (const [rid, mm] of roomGames.entries()) {
    const og = mm.get(tok);
    if (og && (String(rid) !== roomId || String(og.host_user_id) !== String(req.user.id))) return res.status(409).json({ error: 'Токен өөр хэрэглэгч/өрөөнийх' });
  }
  const bg = beginRelay.get(tok);
  if (bg && bg.user_id != null && (String(bg.user_id) !== String(req.user.id) || (bg.room_id != null && bg.room_id !== roomId))) {
    return res.status(403).json({ error: 'Токен өөр хэрэглэгч/өрөөнд олгогдсон', code: 'TOKEN_NOT_ISSUED' });
  }
  if (!bg && db) {
    try {
      const row = (await db.query('SELECT host_user_id, room_id FROM lan_games WHERE token = $1', [tok])).rows[0];
      if (row && ((row.host_user_id != null && String(row.host_user_id) !== String(req.user.id)) || (row.room_id != null && String(row.room_id) !== roomId))) {
        return res.status(409).json({ error: 'Токен өөр хэрэглэгч/өрөөнийх' });
      }
    } catch { /* DB түр алдаа — доорх эрхийн шалгалт үлдэнэ */ }
  }
  const meta = await roomMeta(roomId);
  if (meta && meta.kind === 'channel') {
    if (meta.game_type && !/warcraft|frozen throne/i.test(meta.game_type)) return res.status(400).json({ error: 'Энэ тоглоомын онлайн холболт удахгүй нээгдэнэ.', code: 'GAME_NOT_READY' });
    if (!await require('./roles').canHostInChannel(req.user, roomId)) return res.status(403).json({ error: 'Нийтийн Room-д тоглоом нээх эрх зөвхөн Moderator-д.', code: 'MODERATOR_REQUIRED' });
  }
  const m = gamesOf(roomId);
  const existing = m.get(tok);
  if (existing && String(existing.host_user_id) !== String(req.user.id)) return res.status(409).json({ error: 'Токен өөр хэрэглэгчийнх' });
  const br = bg || shardFor(currentRelay(), tok);
  const g = existing || { token: String(game_token), host_user_id: req.user.id, relay_ip: br.ip, relay_port: br.port, created_at: Date.now() };
  g.gameinfo_b64 = String(gameinfo_b64);
  delete g.started_at;   // GAMEINFO дахин ирсэн = лобби нээлттэй (OPEN GAMES)
  // Хостын mesh шууд endpoint (100.64/10 л зөвшөөрнө — өөр хаяг руу joiner-уудыг чиглүүлэх боломжгүй)
  // MESH_DISABLED үед хостын шууд endpoint-ийг зарлахгүй → бүх joiner (хуучин клиент ч) зөвхөн relay-ээр
  const meshOff = /^(1|true|yes)$/i.test(String(process.env.MESH_DISABLED || ''));
  if (!meshOff && direct && isMeshIp(direct.ip) && Number(direct.port) > 0 && Number(direct.port) < 65536) g.direct = { ip: String(direct.ip), port: Number(direct.port) };
  else if (meshOff) delete g.direct;
  g.host_username = req.user.username || req.user.name || '';
  g.host_wc3_name = sanitizeWc3Name(host_wc3_name);
  m.set(g.token, g);
  // Токен↔өрөө/хостыг DB-д ч хадгална: relay-ийн дүн (Алхам 3) сервер restart-ын дараа ч өрөөгөө олно
  if (db) {
    db.query(
      `INSERT INTO lan_games (token, room_id, host_user_id, host_wc3_name) VALUES ($1,$2,$3,$4)
       ON CONFLICT (token) DO UPDATE SET host_wc3_name = EXCLUDED.host_wc3_name, host_user_id = COALESCE(lan_games.host_user_id, EXCLUDED.host_user_id)
         WHERE lan_games.host_user_id IS NULL OR lan_games.host_user_id = EXCLUDED.host_user_id`,
      [g.token, Number(roomId), req.user.id, g.host_wc3_name]
    ).catch((e) => console.warn('[LAN] lan_games save:', e.message));
  }
  emitRoom(roomId, 'room:lan_lobby', gamePublic(g));
  await syncRoomStatus(roomId);   // LAN тоглоом нээгдлээ → өрөө 'playing' (гаднын хүн нэгдэхгүй)
  return res.json({ ok: true });
});

// Тоглоом эхэлсэн (хостын WC3 лобби SEARCHGAME-д хариулахаа больсон) → STARTED GAMES (RGC маяг, 2026-10-02)
router.post('/:id/lan-host/:token/started', authMW, async (req, res) => {
  const m = roomGames.get(String(req.params.id));
  const g = m && m.get(String(req.params.token));
  if (!g) return res.status(404).json({ error: 'Тоглоом олдсонгүй' });
  if (String(g.host_user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Зөвхөн хост' });
  if (!g.started_at) { g.started_at = Date.now(); emitRoom(String(req.params.id), 'room:lan_lobby', gamePublic(g)); }
  return res.json({ ok: true });
});

// Тоглоом зогсоох → room:lan_lobby_gone
router.delete('/:id/lan-host/:token', authMW, async (req, res) => {
  const roomId = String(req.params.id);
  const token = String(req.params.token);
  const m = roomGames.get(roomId);
  const g = m && m.get(token);
  if (g && String(g.host_user_id) === String(req.user.id)) {
    m.delete(token);
    if (!m.size) roomGames.delete(roomId);
    emitRoom(roomId, 'room:lan_lobby_gone', { game_token: token });
    await syncRoomStatus(roomId);   // тоглоом зогслоо → хоосон бол өрөө 'waiting' (дахин нээлттэй)
  }
  return res.json({ ok: true });
});

// Joiner "Нэгдэх" дарахад WC3 нэрээ бүртгүүлнэ → relay-ийн дүн буцаж ирэхэд нэрээр ЯГ таарна (v2.7.8 клиент)
router.post('/:id/lan-host/:token/join', authMW, async (req, res) => {
  const roomId = String(req.params.id);
  const token = String(req.params.token || '').slice(0, 64);
  if (!token) return res.status(400).json({ error: 'token дутуу' });
  if (!await inRoom(req.user.id, roomId)) return res.status(403).json({ error: 'Та энэ өрөөнд байхгүй байна' });
  const wc3 = sanitizeWc3Name((req.body || {}).wc3_name);
  // Токен ЭНЭ өрөөний тоглоом байх ёстой; бусдын (хост эсвэл түрүүлж бүртгүүлсэн тоглогчийн) WC3 нэрийг авч дүн/💎-г нь
  // булаахаас хамгаална — «анх бүртгүүлсэн нь ялна» (аудит 2026-10-02)
  const lc = (v) => String(v || '').trim().toLowerCase();
  const g = (roomGames.get(roomId) && roomGames.get(roomId).get(token)) || null;
  if (!g) {
    let known = false;
    if (db) { try { const r0 = await db.query('SELECT room_id FROM lan_games WHERE token = $1', [token]); known = !!r0.rows[0] && String(r0.rows[0].room_id) === roomId; } catch {} }
    if (!known) return res.status(404).json({ error: 'Тоглоом олдсонгүй' });
  }
  if (wc3 && g && g.host_wc3_name && lc(g.host_wc3_name) === lc(wc3) && String(g.host_user_id) !== String(req.user.id)) {
    return res.status(409).json({ error: 'Энэ WC3 нэр хостынх', code: 'NAME_TAKEN' });
  }
  if (db) {
    try {
      if (wc3) {
        const taken = await db.query('SELECT 1 FROM lan_game_players WHERE token = $1 AND LOWER(wc3_name) = LOWER($2) AND user_id <> $3 LIMIT 1', [token, wc3, req.user.id]);
        if (taken.rows[0]) return res.status(409).json({ error: 'Энэ WC3 нэр өөр тоглогчид бүртгэлтэй', code: 'NAME_TAKEN' });
      }
      await db.query('INSERT INTO lan_games (token, room_id) VALUES ($1,$2) ON CONFLICT (token) DO NOTHING', [token, Number(roomId)]);
      await db.query(
        `INSERT INTO lan_game_players (token, user_id, wc3_name) VALUES ($1,$2,$3)
         ON CONFLICT (token, user_id) DO UPDATE SET wc3_name = EXCLUDED.wc3_name, joined_at = NOW()`,
        [token, req.user.id, wc3]
      );
    } catch (e) { console.warn('[LAN] join save:', e.message); }
  }
  return res.json({ ok: true });
});

// Токеноор тоглоомыг олно: санах ой (идэвхтэй) → DB (lan_games). Relay-ийн дүн (routes/relayStats.js) дуудна.
async function findGameByToken(token) {
  const t = String(token || '');
  for (const [roomId, m] of roomGames.entries()) {
    const g = m.get(t);
    if (g) return { room_id: Number(roomId), host_user_id: g.host_user_id, host_wc3_name: g.host_wc3_name };
  }
  if (!db) return null;
  try {
    const r = await db.query('SELECT room_id, host_user_id, host_wc3_name FROM lan_games WHERE token = $1', [t]);
    return r.rows[0] || null;
  } catch { return null; }
}

// Өрөөний идэвхтэй тоглоомууд (шинэ гишүүн орж ирэхэд харагдах)
router.get('/:id/lan-host', authMW, async (req, res) => {
  const roomId = String(req.params.id);
  if (!await inRoom(req.user.id, roomId)) return res.status(403).json({ error: 'Та энэ өрөөнд байхгүй байна' });
  const m = roomGames.get(roomId);
  return res.json({ relay_configured: relayConfigured(), games: m ? [...m.values()].map(gamePublic) : [] });
});

// Идэвхтэй тоглоомын токенууд / хостууд — нийтийн Room-ын сүнс-цэвэрлэгээ тоглож буй хүнийг хасахгүйн тулд (2026-10-02)
function gamesIn(roomId) { const m = roomGames.get(String(roomId)); return m ? [...m.values()] : []; }
function activeTokens() { const out = []; for (const m of roomGames.values()) for (const t of m.keys()) out.push(t); return out; }
function activeHostIds() { const out = new Set(); for (const m of roomGames.values()) for (const g of m.values()) out.add(String(g.host_user_id)); return out; }

// Өрөөний идэвхтэй LAN тоглоомын тоо — лоббийн жагсаалтын «🎮 N тоглолт» (санах ой, DB асуулгагүй)
function gameCounts(roomId) {
  const m = roomGames.get(String(roomId)); if (!m || !m.size) return null;
  let open = 0, started = 0; for (const g of m.values()) { if (g.started_at) started++; else open++; }
  return { open, started };
}

module.exports = { router, setIO, gameCounts, gamesIn, activeTokens, activeHostIds, removeUserGames, clearRoom, relayConfigured, findGameByToken, _relays: RELAYS, _checkRelays: checkRelays, currentRelay, captureFor, _shardFor: shardFor };
