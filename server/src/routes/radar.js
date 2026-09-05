// ── 📡 Радар — relay capture-аас hero-гийн хөдөлгөөн/үхлийн симуляц (2026-09-06, эзний хүсэлт) ──
// Урсгал: relay тоглоом дуусахад hostbot/reportGame.js → radarExtract → POST /relay/radar (x-relay-key)
//   → radar_games. Апп/вэб: GET /radar/games (жагсаалт), GET /radar/:token (бүрэн өгөгдөл) — нэвтэрсэн хэрэглэгч.
// Саатлын бодлого (ЭЗНИЙ ХАТУУ ШИЙДВЭР): ЗӨВХӨН эзэн 0 с; бусад ХЭН Ч (шүүгч/админ/зохион байгуулагч) 120 с;
//   оролцогчид харахгүй. Энэ файл = тоглолт ДУУССАНЫ ДАРААХ replay (саатал хамаарахгүй); live урсгал Шат 2.
// Тоглоомын замд (relay, LAN proxy) огт хүрэхгүй — бүх ажил дууссан capture дээр, тусдаа процессоор.
const express = require('express');
const crypto = require('crypto');
const authMW = require('../middleware/auth');
const lanhost = require('./lanhost');

let db;
try { db = require('../config/db'); } catch { db = null; }

const REPORT_KEY = process.env.RELAY_REPORT_KEY || '';
const MAX_PATH_POINTS = 20000;     // нэг тоглогчид
const MAX_PLAYERS = 12;

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
    played_at: b.ended_at && !Number.isNaN(Date.parse(b.ended_at)) ? new Date(b.ended_at) : new Date(),
  };
}

// Жагсаалтын мөр (жижиг) — бүрэн paths ачаалахгүй
function summaryRow(r) {
  const players = Array.isArray(r.players) ? r.players : [];
  return {
    token: r.token, room_id: r.room_id, room_name: r.room_name, host_name: r.host_name, map_name: r.map_name,
    game_time_sec: r.game_time_sec, winner_team: r.winner_team, kills: Array.isArray(r.kills) ? r.kills.length : Number(r.kill_count || 0),
    players: players.map((p) => ({ pid: p.pid, team: p.team, name: p.name, hero: p.hero })),
    played_at: r.played_at,
  };
}

// ── relay → сервер ──
const relayRouter = express.Router();
relayRouter.post('/radar', async (req, res) => {
  if (!keyOk(req)) return res.status(401).json({ error: 'relay key' });
  if (!db) return res.status(503).json({ error: 'db' });
  let s;
  try { s = sanitizeRadar(req.body || {}); } catch (e) { return res.status(400).json({ error: e.message }); }
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
  try {
    await db.query(
      `INSERT INTO radar_games (token, room_id, room_name, host_name, game_time_sec, winner_team, players, kills, events, paths, map_name, played_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (token) DO UPDATE SET players = EXCLUDED.players, kills = EXCLUDED.kills, events = EXCLUDED.events, paths = EXCLUDED.paths,
         game_time_sec = EXCLUDED.game_time_sec, winner_team = EXCLUDED.winner_team, room_id = COALESCE(EXCLUDED.room_id, radar_games.room_id),
         room_name = COALESCE(EXCLUDED.room_name, radar_games.room_name), host_name = COALESCE(EXCLUDED.host_name, radar_games.host_name)`,
      [s.token, roomId, roomName, hostName, s.game_time_sec, s.winner_team, JSON.stringify(s.players), JSON.stringify(s.kills),
       JSON.stringify(s.events), JSON.stringify(s.paths), s.map_name, s.played_at],
    );
    const pts = Object.values(s.paths).reduce((n, a) => n + a.length, 0);
    console.log(`[Radar] хадгалав token=${s.token.slice(0, 12)} room=${roomId} ${s.game_time_sec}с тоглогч=${s.players.length} цэг=${pts} kill=${s.kills.length}`);
    return res.json({ ok: true, token: s.token, room_id: roomId, points: pts });
  } catch (e) {
    console.error('[Radar] хадгалалт:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// ── апп/вэб ──
const router = express.Router();
router.get('/games', authMW, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'db' });
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  try {
    const r = await db.query(
      `SELECT token, room_id, room_name, host_name, map_name, game_time_sec, winner_team, players, jsonb_array_length(kills) AS kill_count, played_at
       FROM radar_games ORDER BY played_at DESC LIMIT $1`, [limit]);
    const base = `https://${req.get('host')}`;
    return res.json({ minimap_url: `${base}/assets/radar/lod-minimap@2x.png`, games: r.rows.map(summaryRow) });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

router.get('/:token', authMW, async (req, res) => {
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
      game_time_sec: g.game_time_sec, winner_team: g.winner_team, players: g.players, kills: g.kills, events: g.events, paths: g.paths,
      played_at: g.played_at, minimap_url: `${base}/assets/radar/lod-minimap@2x.png`,
      bounds: { x0: -8192, x1: 8192, y0: -8192, y1: 8192 },   // LoD 6.74c: war3map.w3e 129×129 tile, center −8192
    });
  } catch (e) { return res.status(500).json({ error: e.message }); }
});

module.exports = { router, relayRouter, sanitizeRadar, summaryRow };
