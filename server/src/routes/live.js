'use strict';
// ── Room Live (2026-10-03, эзэн): Discord маягийн дэлгэц дамжуулалт ──
//  • Streamer Room-доо «🔴 Live» дарна → LiveKit SFU (Датаком relay дээр ТУСДАА процесс, ws://…:7880) руу
//    720p 30fps ≤2 Mbps H.264 нэг урсгал илгээнэ; SFU үзэгч бүрт тараана (streamer-ийн upload нэмэгдэхгүй).
//  • Room-ын гишүүдийн нэрний ард «● LIVE» — дарвал тусдаа үзэгчийн цонх (live.html).
//  • Хориг: streamer-тэй НЭГ LAN тоглоомд байгаа хүн үзэхгүй (lan_game_players + хост); үзэж байгаад тэр тоглоомд
//    нэгдвэл шууд хаагдана (lanhost join → onLanJoin). Зөвхөн тухайн Room-ын гишүүн үзнэ.
//  • Хязгаар (100 Mbps порт, эзний сонголт): Live тус бүр 35 үзэгч, нийт 35 үзэгч, зэрэг 3 Live. ENV-ээр өөрчилнө.
//  • Энэ модуль зөвхөн токен олгож, төлөв хадгална — видео Railway-ээр дамжихгүй.
const db = require('../config/db');

const n = (v, d) => { const x = parseInt(v, 10); return Number.isFinite(x) && x > 0 ? x : d; };
const CFG = {
  url: process.env.LIVEKIT_URL || '',
  key: process.env.LIVEKIT_API_KEY || '',
  secret: process.env.LIVEKIT_API_SECRET || '',
  MAX_VIEWERS: n(process.env.LIVE_MAX_VIEWERS, 35),
  MAX_VIEWERS_TOTAL: n(process.env.LIVE_MAX_VIEWERS_TOTAL, 35),
  MAX_STREAMS: n(process.env.LIVE_MAX_STREAMS, 3),
  // Streamer-ийн socket түр тасрахад (гадаадаас холбогдсон, Wi-Fi) Live-ийг шууд зогсоохгүй — клиент live:resume-ээр сэргээнэ (2026-10-04)
  RESUME_GRACE_MS: process.env.LIVE_RESUME_GRACE_MS != null ? Math.max(0, parseInt(process.env.LIVE_RESUME_GRACE_MS, 10) || 0) : 25000,
  // Эзний сонголт: 720p 30fps 2 Mbps (~35 үзэгч / 100 Mbps)
  // Кодек VP8 (2026-10-04): Electron-ий OpenH264 дэлгэцийн контентыг 320×180 ~15kbps хүртэл буулгаж үзэгчид бараг юу ч
  // харагддаггүй байв (Датаком дээр хэмжсэн: видео пакет 300B-аас бага). VP8 (libvpx) эхний секундээс 1280×720.
  ENCODING: { width: 1280, height: 720, fps: 30, maxBitrate: 2_000_000, codec: /^(h264|vp8|vp9|av1)$/.test(process.env.LIVE_CODEC || '') ? process.env.LIVE_CODEC : 'vp8' },
};
function enabled() { return !!(CFG.url && CFG.key && CFG.secret); }

let _io = null;
function setIO(io) { _io = io; }

// streamerId(String) → { userId, username, roomId(String), lkRoom, socketId, startedAt, viewers: Map(viewerId → { username, socketId }) }
const lives = new Map();

function publicState(l) {
  return { userId: String(l.userId), username: l.username, roomId: String(l.roomId), roomName: l.roomName || '', public: !!l.public, viewers: l.viewers.size, max: CFG.MAX_VIEWERS, startedAt: l.startedAt };
}
// Нийтийн чатад зарласан Live-үүд (Room-д байхгүй хүн ч үзнэ — сурталчилгаа, эзэн 2026-10-03)
function publicLives() { return [...lives.values()].filter((l) => l.public).map(publicState); }
let _lastPublic = '';
function broadcastPublic(force = false) {
  try {
    const list = publicLives();
    const key = JSON.stringify(list.map((l) => [l.userId, l.viewers]));
    if (force || key !== _lastPublic) { _lastPublic = key; _io?.emit('live:public', { lives: list }); }
  } catch {}
}
function livesInRoom(roomId) { return [...lives.values()].filter((l) => l.roomId === String(roomId)).map(publicState); }
function liveOf(userId) { return lives.get(String(userId)) || null; }
function totalViewers() { let t = 0; for (const l of lives.values()) t += l.viewers.size; return t; }
let _lastLobby = '';
function broadcastRoom(roomId) {
  try { _io?.to(String(roomId)).emit('live:state', { lives: livesInRoom(roomId) }); } catch {}
  // Лоббийн жагсаалтын «● LIVE» тэмдэг: Live-тай өрөөний олонлог өөрчлөгдвөл л бүх хүнд rooms:updated (үзэгчийн тоо бүрт биш)
  try { const key = [...new Set([...lives.values()].map((l) => l.roomId))].sort().join(','); if (key !== _lastLobby) { _lastLobby = key; _io?.emit('rooms:updated'); } } catch {}
  broadcastPublic();
}

async function mintToken({ identity, name, room, publish }) {
  const { AccessToken } = require('livekit-server-sdk');
  const at = new AccessToken(CFG.key, CFG.secret, { identity: String(identity), name: String(name || '').slice(0, 64), ttl: '3h' });
  at.addGrant({ roomJoin: true, room, canPublish: !!publish, canSubscribe: !publish, canPublishData: false, canUpdateOwnMetadata: false });
  return at.toJwt();
}

/** Streamer Live эхлүүлнэ. */
async function start({ userId, username, roomId, socketId, isPublic = false, roomName = '' }) {
  if (!enabled()) return { ok: false, error: 'Live сервер тохируулагдаагүй байна' };
  if (!roomId) return { ok: false, error: 'Эхлээд Room-д орно уу' };
  const id = String(userId);
  if (lives.has(id)) stop(id, 'restart');
  if (lives.size >= CFG.MAX_STREAMS) return { ok: false, error: `Зэрэг ${CFG.MAX_STREAMS} Live-ийн хязгаар дүүрсэн — дараа дахин оролдоно уу` };
  const lkRoom = `live-${roomId}-${id}-${Date.now().toString(36)}`;
  const l = { userId: id, username, roomId: String(roomId), roomName: String(roomName || '').slice(0, 80), public: !!isPublic, lkRoom, socketId, startedAt: new Date().toISOString(), viewers: new Map() };
  lives.set(id, l);
  const token = await mintToken({ identity: `u${id}`, name: username, room: lkRoom, publish: true });
  broadcastRoom(roomId);
  console.log(`[Live] ${username} (#${id}) Room ${roomId} эхлэв (${lkRoom})`);
  return { ok: true, token, url: CFG.url, lkRoom, encoding: CFG.ENCODING, state: publicState(l) };
}

/** Live-ийг зогсооно; үзэгчдэд live:ended илгээнэ. */
function stop(userId, reason = 'stop') {
  const id = String(userId);
  const l = lives.get(id); if (!l) return null;
  if (l.graceTimer) { clearTimeout(l.graceTimer); l.graceTimer = null; }
  lives.delete(id);
  for (const [vid] of l.viewers) { try { _io?.to(`user:${vid}`).emit('live:ended', { streamerId: id, reason }); } catch {} }
  broadcastRoom(l.roomId);
  console.log(`[Live] ${l.username} (#${id}) зогсов (${reason}, үзэгч ${l.viewers.size})`);
  return l;
}

/** Streamer ба viewer нэг LAN тоглоомд байна уу (хост эсвэл бүртгэлтэй тоглогч) — games = lanhost.gamesIn(roomId). */
async function inSameLanGame(games, a, b) {
  const A = String(a), B = String(b);
  const tokens = [];
  const mine = { [A]: new Set(), [B]: new Set() };
  if (games && typeof games.forEach === 'function') {
    games.forEach((g, tok) => {
      // Map(token → g) эсвэл массив (lanhost.gamesIn) — массивын индексийг токен гэж андуурдаг байв (2026-10-04)
      const t = String(g?.token ?? tok);
      tokens.push(t);
      const h = String(g?.host_user_id ?? '');
      if (h === A) mine[A].add(t);
      if (h === B) mine[B].add(t);
    });
  }
  if (tokens.length && db) {
    try {
      const r = await db.query('SELECT token, user_id FROM lan_game_players WHERE token = ANY($1) AND user_id = ANY($2)', [tokens, [Number(A), Number(B)].filter(Number.isFinite)]);
      r.rows.forEach((x) => { const u = String(x.user_id); if (mine[u]) mine[u].add(String(x.token)); });
    } catch (e) { console.warn('[Live] sameGame:', e.message); }
  }
  for (const t of mine[A]) if (mine[B].has(t)) return true;
  return false;
}

/** Үзэгч нэгдэнэ. games = тухайн Room-ын LAN тоглоомууд (lanhost.gamesIn). */
async function watch({ viewerId, viewerName, viewerRoomId, streamerId, socketId, games, gamesOf = null }) {
  if (!enabled()) return { ok: false, error: 'Live сервер тохируулагдаагүй байна' };
  const l = lives.get(String(streamerId));
  if (!l) return { ok: false, error: 'Энэ Live дууссан байна' };
  const vid = String(viewerId);
  if (vid === l.userId) return { ok: false, error: 'Өөрийнхөө Live-ийг үзэх шаардлагагүй' };
  if (!l.public && String(viewerRoomId || '') !== l.roomId) return { ok: false, error: 'Зөвхөн тухайн Room-ын гишүүд үзнэ' };
  const g = games || (typeof gamesOf === 'function' ? gamesOf(l.roomId) : null);   // лоббиос үзэгч: streamer-ийн Room-ын тоглоомуудаар шалгана
  if (await inSameLanGame(g, l.userId, vid)) return { ok: false, error: 'Нэг LAN тоглоомд байгаа хүн Live үзэх боломжгүй', code: 'SAME_GAME' };
  if (!l.viewers.has(vid)) {
    if (l.viewers.size >= CFG.MAX_VIEWERS) return { ok: false, error: `Үзэгчийн хязгаар дүүрсэн (${CFG.MAX_VIEWERS})`, code: 'FULL' };
    if (totalViewers() >= CFG.MAX_VIEWERS_TOTAL) return { ok: false, error: `Платформын нийт үзэгчийн хязгаар дүүрсэн (${CFG.MAX_VIEWERS_TOTAL})`, code: 'FULL' };
  }
  l.viewers.set(vid, { username: viewerName, socketId });
  const token = await mintToken({ identity: `u${vid}`, name: viewerName, room: l.lkRoom, publish: false });
  broadcastRoom(l.roomId);
  return { ok: true, token, url: CFG.url, lkRoom: l.lkRoom, state: publicState(l) };
}

/** Үзэгч гарна (streamerId өгөөгүй бол бүх Live-ээс). */
function leave(viewerId, streamerId = null) {
  const vid = String(viewerId); const changed = [];
  for (const l of lives.values()) {
    if (streamerId != null && l.userId !== String(streamerId)) continue;
    if (l.viewers.delete(vid)) changed.push(l);
  }
  changed.forEach((l) => broadcastRoom(l.roomId));
  return changed.length;
}

/** Socket салахад: тэр socket-оор эхлүүлсэн Live RESUME_GRACE_MS хүлээгээд зогсоно (клиент дахин холбогдоод live:resume илгээвэл үргэлжилнэ);
 *  тэр socket-оор үзэж байсан бол гарна. */
function onSocketDisconnect(userId, socketId, graceMs = CFG.RESUME_GRACE_MS) {
  const id = String(userId);
  const l = lives.get(id);
  if (l && l.socketId === socketId) {
    if (!graceMs) stop(id, 'disconnect');
    else {
      l.socketId = null;
      if (l.graceTimer) clearTimeout(l.graceTimer);
      l.graceTimer = setTimeout(() => { if (lives.get(id) === l && !l.socketId) stop(id, 'disconnect'); }, graceMs);
      if (l.graceTimer.unref) l.graceTimer.unref();
      console.log(`[Live] ${l.username} (#${id}) socket тасарлаа — ${Math.round(graceMs / 1000)}с сэргээхийг хүлээнэ`);
    }
  }
  for (const x of lives.values()) { const v = x.viewers.get(id); if (v && v.socketId === socketId) { x.viewers.delete(id); broadcastRoom(x.roomId); } }
}

/** Streamer-ийн клиент дахин холбогдсон → Live үргэлжилнэ (lkRoom таарах ёстой). */
function resume({ userId, lkRoom, socketId }) {
  const id = String(userId);
  const l = lives.get(id);
  if (!l || !lkRoom || l.lkRoom !== String(lkRoom)) return { ok: false, error: 'Live дууссан байна' };
  if (l.graceTimer) { clearTimeout(l.graceTimer); l.graceTimer = null; }
  l.socketId = socketId;
  console.log(`[Live] ${l.username} (#${id}) дахин холбогдож Live үргэлжиллээ`);
  broadcastRoom(l.roomId);
  return { ok: true, state: publicState(l) };
}

/** Room-оос гарахад: Live зогсоно, тэр Room-ын Live-үүдээс үзэгч хасагдана. */
function onRoomLeave(userId, roomId) {
  const id = String(userId);
  const l = lives.get(id); if (l && l.roomId === String(roomId)) stop(id, 'left-room');
  for (const x of lives.values()) if (x.roomId === String(roomId) && x.viewers.delete(id)) { try { _io?.to(`user:${id}`).emit('live:kick', { streamerId: x.userId, reason: 'Room-оос гарсан' }); } catch {} broadcastRoom(x.roomId); }
}

/** LAN тоглоомд нэгдэхэд (lanhost join): тэр тоглоомын хост/тоглогч Live хийж байвал үзэгчийг хасна. */
async function onLanJoin({ roomId, token, userId, games }) {
  const vid = String(userId);
  for (const l of lives.values()) {
    if (l.roomId !== String(roomId) || !l.viewers.has(vid)) continue;
    if (await inSameLanGame(games, l.userId, vid)) {
      l.viewers.delete(vid);
      try { _io?.to(`user:${vid}`).emit('live:kick', { streamerId: l.userId, reason: 'Та энэ Live-ийн тоглоомд нэгдсэн тул үзэх боломжгүй' }); } catch {}
      broadcastRoom(l.roomId);
    }
  }
}

function stats() { return { enabled: enabled(), lives: lives.size, viewers: totalViewers(), max_streams: CFG.MAX_STREAMS, max_viewers: CFG.MAX_VIEWERS, max_viewers_total: CFG.MAX_VIEWERS_TOTAL }; }

module.exports = { CFG, enabled, setIO, start, stop, resume, watch, leave, liveOf, livesInRoom, publicLives, broadcastPublic, onSocketDisconnect, onRoomLeave, onLanJoin, inSameLanGame, stats, _lives: lives };
