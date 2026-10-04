'use strict';
// Room Live (routes/live.js): start/stop/watch/leave, хязгаар (Live тус бүр / нийт / зэрэг Live), нэг LAN тоглоомын хориг,
// Room-оос гарах / socket салах / LAN-д нэгдэх үеийн автомат цэвэрлэгээ, токен (LiveKit JWT) grant.
const assert = require('node:assert/strict');
const path = require('node:path');
const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
Object.assign(process.env, { NODE_ENV: 'test', LIVEKIT_URL: 'ws://127.0.0.1:7880', LIVEKIT_API_KEY: 'testkey', LIVEKIT_API_SECRET: 'x'.repeat(40), LIVE_MAX_VIEWERS: '2', LIVE_MAX_VIEWERS_TOTAL: '3', LIVE_MAX_STREAMS: '2' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
const players = [];   // { token, user_id }
async function query(sql, p = []) {
  const s = sql.replace(/\s+/g, ' ');
  if (s.startsWith('SELECT token, user_id FROM lan_game_players')) return { rows: players.filter((x) => p[0].includes(x.token) && p[1].includes(Number(x.user_id))) };
  return { rows: [] };
}
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query } };
const live = require(path.join(serverDir, 'src', 'routes', 'live.js'));
const sent = [];
live.setIO({ to: (room) => ({ emit: (ev, data) => sent.push({ room, ev, data }) }) });
const games = new Map([['tokA', { host_user_id: 10 }]]);   // Room 901-д 10 хост

(async () => {
  assert.equal(live.enabled(), true); ok('ENV байвал идэвхтэй');
  let r = await live.start({ userId: 10, username: 'Streamer', roomId: 901, socketId: 's10' });
  assert.equal(r.ok, true); assert.match(r.token, /^eyJ/); assert.equal(r.url, 'ws://127.0.0.1:7880'); assert.equal(r.encoding.width, 1280); assert.equal(r.encoding.fps, 30); assert.equal(r.encoding.maxBitrate, 2_000_000); assert.equal(r.encoding.codec, 'vp8');
  ok('Live эхэлнэ → JWT токен, 720p30 2Mbps тохиргоо');
  const payload = JSON.parse(Buffer.from(r.token.split('.')[1], 'base64url').toString());
  assert.equal(payload.video.canPublish, true); assert.equal(payload.video.canSubscribe, false); assert.equal(payload.video.room, r.lkRoom); assert.equal(payload.sub, 'u10');
  ok('Streamer токен: publish=true, subscribe=false, зөвхөн өөрийн room');
  assert.equal(sent.some((x) => x.room === '901' && x.ev === 'live:state' && x.data.lives[0].userId === '10'), true); ok('Room-д live:state мэдэгдэнэ');
  assert.deepEqual(live.livesInRoom(901).map((l) => [l.username, l.viewers, l.max]), [['Streamer', 0, 2]]); ok('livesInRoom: үзэгч 0 / max 2');

  r = await live.watch({ viewerId: 20, viewerName: 'V1', viewerRoomId: 901, streamerId: 10, socketId: 's20', games });
  assert.equal(r.ok, true); const vp = JSON.parse(Buffer.from(r.token.split('.')[1], 'base64url').toString());
  assert.equal(vp.video.canPublish, false); assert.equal(vp.video.canSubscribe, true); assert.equal(r.state.viewers, 1); ok('Үзэгч нэгдэнэ: subscribe-only токен, үзэгч 1');
  r = await live.watch({ viewerId: 21, viewerName: 'V2', viewerRoomId: 902, streamerId: 10, socketId: 's21', games }); assert.equal(r.ok, false); ok('Өөр Room-ын хүн үзэхгүй');
  r = await live.watch({ viewerId: 10, viewerName: 'Streamer', viewerRoomId: 901, streamerId: 10, socketId: 's10', games }); assert.equal(r.ok, false); ok('Өөрийн Live-ийг үзэхгүй');
  players.push({ token: 'tokA', user_id: 22 });
  r = await live.watch({ viewerId: 22, viewerName: 'InGame', viewerRoomId: 901, streamerId: 10, socketId: 's22', games }); assert.equal(r.ok, false); assert.equal(r.code, 'SAME_GAME'); ok('Streamer-тэй нэг LAN тоглоомд байгаа хүн үзэхгүй (SAME_GAME)');
  r = await live.watch({ viewerId: 23, viewerName: 'V3', viewerRoomId: 901, streamerId: 10, socketId: 's23', games }); assert.equal(r.ok, true); assert.equal(r.state.viewers, 2);
  r = await live.watch({ viewerId: 24, viewerName: 'V4', viewerRoomId: 901, streamerId: 10, socketId: 's24', games }); assert.equal(r.ok, false); assert.equal(r.code, 'FULL'); ok('Live-ийн үзэгчийн дээд хязгаар (2) дүүрвэл татгалзана');
  r = await live.watch({ viewerId: 20, viewerName: 'V1', viewerRoomId: 901, streamerId: 10, socketId: 's20b', games }); assert.equal(r.ok, true); assert.equal(r.state.viewers, 2); ok('Байгаа үзэгч дахин нэгдвэл давхар тоологдохгүй');

  // LAN-д нэгдэх → kick
  sent.length = 0; players.push({ token: 'tokA', user_id: 23 });
  await live.onLanJoin({ roomId: 901, token: 'tokA', userId: 23, games });
  assert.equal(live.livesInRoom(901)[0].viewers, 1); assert.equal(sent.some((x) => x.room === 'user:23' && x.ev === 'live:kick'), true); ok('Үзэж байгаад streamer-ийн тоглоомд нэгдвэл live:kick, үзэгч хасагдана');
  live.leave(20, 10); assert.equal(live.livesInRoom(901)[0].viewers, 0); ok('leave → үзэгч 0');

  // lanhost.gamesIn() массив буцаана (index.js live:watch) — индексийг токен гэж андуурахгүй
  players.push({ token: 'tokArr', user_id: 77 });
  assert.equal(await live.inSameLanGame([{ token: 'tokArr', host_user_id: 76 }], 76, 77), true);
  assert.equal(await live.inSameLanGame([{ token: 'tokArr', host_user_id: 76 }], 76, 78), false);
  ok('inSameLanGame: массив (gamesIn) хэлбэрээр ч тоглогчийг таньна');

  // Нийт хязгаар + зэрэг Live
  r = await live.start({ userId: 11, username: 'S2', roomId: 901, socketId: 's11' }); assert.equal(r.ok, true);
  r = await live.start({ userId: 12, username: 'S3', roomId: 901, socketId: 's12' }); assert.equal(r.ok, false); ok('Зэрэг Live-ийн хязгаар (2)');
  await live.watch({ viewerId: 30, viewerName: 'a', viewerRoomId: 901, streamerId: 10, socketId: 'x', games });
  await live.watch({ viewerId: 31, viewerName: 'b', viewerRoomId: 901, streamerId: 10, socketId: 'x', games });
  await live.watch({ viewerId: 32, viewerName: 'c', viewerRoomId: 901, streamerId: 11, socketId: 'x', games });
  r = await live.watch({ viewerId: 33, viewerName: 'd', viewerRoomId: 901, streamerId: 11, socketId: 'x', games }); assert.equal(r.ok, false); assert.equal(r.code, 'FULL'); ok('Платформын нийт үзэгчийн хязгаар (3)');

  // Socket салах / Room-оос гарах
  sent.length = 0; live.onSocketDisconnect(10, 's10', 0);
  assert.equal(live.liveOf(10), null); assert.equal(sent.filter((x) => x.ev === 'live:ended').length, 2); ok('Streamer socket салбал Live зогсож үзэгчдэд live:ended');
  live.onSocketDisconnect(11, 'other-socket'); assert.ok(live.liveOf(11)); ok('Өөр socket салахад Live зогсохгүй');
  live.onRoomLeave(11, 901); assert.equal(live.liveOf(11), null); ok('Room-оос гарвал Live зогсоно');
  // Нийтийн чатад зарласан Live: Room-д байхгүй хүн үзнэ; хувийн Live-ийг үзэхгүй; live:public мэдэгдэл
  sent.length = 0;
  r = await live.start({ userId: 40, username: 'Pub', roomId: 901, socketId: 's40', isPublic: true, roomName: 'WC3 Room 1' }); assert.equal(r.ok, true); assert.equal(r.state.public, true); assert.equal(r.state.roomName, 'WC3 Room 1');
  assert.equal(sent.some((x) => x.room === undefined && x.ev === 'live:public'), false); ok('start(public) → төлөвт public/roomName');
  assert.deepEqual(live.publicLives().map((l) => l.username), ['Pub']); ok('publicLives()');
  r = await live.watch({ viewerId: 50, viewerName: 'Lobby', viewerRoomId: null, streamerId: 40, socketId: 's50', games: null, gamesOf: () => games }); assert.equal(r.ok, true); ok('Нийтийн Live-ийг лоббиос (Room-гүй) үзнэ');
  players.push({ token: 'tokA', user_id: 51 }); games.set('tokA', { host_user_id: 40 });
  r = await live.watch({ viewerId: 51, viewerName: 'InGame', viewerRoomId: null, streamerId: 40, socketId: 's51', games: null, gamesOf: () => games }); assert.equal(r.code, 'SAME_GAME'); ok('Лоббиос ч нэг LAN тоглоомд байгаа хүн үзэхгүй (gamesOf)');
  r = await live.start({ userId: 41, username: 'Priv', roomId: 901, socketId: 's41' }); assert.equal(r.ok, true);
  r = await live.watch({ viewerId: 52, viewerName: 'Lobby2', viewerRoomId: null, streamerId: 41, socketId: 's52', games: null, gamesOf: () => games }); assert.equal(r.ok, false); ok('Хувийн Live-ийг Room-гүй хүн үзэхгүй');
  live.stop(40); live.stop(41);

  // Socket түр тасрах → grace → live:resume (2026-10-04: Чехээс холбогдсон streamer-ийн Live 26с-д зогссон)
  r = await live.start({ userId: 60, username: 'Flaky', roomId: 901, socketId: 's60' }); const lk60 = r.lkRoom;
  live.onSocketDisconnect(60, 's60', 80); assert.ok(live.liveOf(60)); ok('Streamer socket тасрахад Live шууд зогсохгүй (grace)');
  assert.equal(live.resume({ userId: 60, lkRoom: 'wrong', socketId: 's60b' }).ok, false); ok('resume: өөр lkRoom → татгалзана');
  assert.equal(live.resume({ userId: 60, lkRoom: lk60, socketId: 's60b' }).ok, true);
  await new Promise((res) => setTimeout(res, 150)); assert.ok(live.liveOf(60)); assert.equal(live.liveOf(60).socketId, 's60b'); ok('resume → grace дууссан ч Live үргэлжилнэ, шинэ socket холбогдоно');
  live.onSocketDisconnect(60, 's60b', 60); await new Promise((res) => setTimeout(res, 120)); assert.equal(live.liveOf(60), null); ok('resume хийгээгүй бол grace-ийн дараа зогсоно');
  assert.equal(live.resume({ userId: 60, lkRoom: lk60, socketId: 'x' }).ok, false); ok('зогссон Live-ийг resume хийхгүй');
  assert.deepEqual(live.stats(), { enabled: true, lives: 0, viewers: 0, max_streams: 2, max_viewers: 2, max_viewers_total: 3 }); ok('stats()');
  console.log(`\n=== live: ${pass} PASS ===`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
