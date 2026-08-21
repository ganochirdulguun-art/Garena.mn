// ── RGC маягийн бот хост ──
// Платформ тал (JWT): өрөөний host "Бот хост" дарна → bot_jobs дараалалд орно.
// Бот тал (x-bot-key): VPS дээрх hostbot/bridge.js ажил авч GHost++-ээр хостолж, lobby/started/result мэдээлнэ.
// Бүх төлөвийн өөрчлөлт өрөөний socket room руу 'room:bot_*' event-ээр очно.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const authMW = require('../middleware/auth');
const { recordGameResult } = require('../services/results');

let db;
try { db = require('../config/db'); } catch { db = null; }

let _io = null;
function setIO(io) { _io = io; }
function emitRoom(roomId, event, payload) {
  if (_io && roomId) _io.to(String(roomId)).emit(event, payload);
}

const MAPS = (() => {
  try { return require(path.join(__dirname, '..', 'config', 'maps.json')).maps || []; } catch { return []; }
})();
const BOT_KEYS = String(process.env.BOT_API_KEYS || process.env.BOT_API_KEY || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
const BOT_STALE_SEC = 90;                 // heartbeat энэ хугацаанд ирэхгүй бол бот offline
const LOBBY_TIMEOUT_MIN = 30;             // lobby энэ хугацаанд эхлэхгүй бол ажил cancelled

const bots = new Map();                   // bot_name -> { last_seen, games, max_games, version }

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }
function safeEqual(a, b) { const A = Buffer.from(String(a)), B = Buffer.from(String(b)); return A.length === B.length && crypto.timingSafeEqual(A, B); }
function botAuth(req, res, next) {
  const key = req.get('x-bot-key') || '';
  if (!BOT_KEYS.length || !BOT_KEYS.some((k) => safeEqual(k, key))) return res.status(401).json({ error: 'bot key invalid' });
  next();
}
function onlineBots() {
  const now = Date.now();
  return [...bots.entries()].filter(([, b]) => now - b.last_seen < BOT_STALE_SEC * 1000).map(([name, b]) => ({ name, ...b }));
}
function botsEnabled() { return BOT_KEYS.length > 0; }
function pickMap(mapKey, gameType) {
  if (mapKey) return MAPS.find((m) => m.key === mapKey) || null;
  return MAPS.find((m) => m.default) || MAPS[0] || null;
}
function sanitizeGameName(s) {
  return String(s || 'Garena.mn').replace(/[^\w\s\-\.#!А-Яа-яӨөҮүЁё]/g, '').trim().slice(0, 31) || 'Garena.mn';
}
async function jobToPublic(job) {
  if (!job) return null;
  return {
    id: job.id, room_id: job.room_id, status: job.status, map_key: job.map_key, map_name: job.map_name,
    game_name: job.game_name, owner_name: job.owner_name, bot_name: job.bot_name,
    host_ip: job.host_ip, host_port: job.host_port, gameinfo_b64: job.status === 'lobby' || job.status === 'started' ? job.gameinfo_b64 : null,
    error: job.error, created_at: job.created_at, started_at: job.started_at, finished_at: job.finished_at,
    game_result_id: job.game_result_id,
  };
}
async function activeJobForRoom(roomId) {
  const r = await db.query(
    `SELECT * FROM bot_jobs WHERE room_id = $1 AND status IN ('queued','hosting','lobby','started') ORDER BY id DESC LIMIT 1`,
    [roomId]
  );
  return r.rows[0] || null;
}

// ════════════════ Платформ тал ════════════════
const roomRouter = express.Router();   // mount: /rooms

// Бот хост боломжтой эсэх + map жагсаалт
roomRouter.get('/bot-host/status', authMW, async (_req, res) => {
  res.json({ enabled: botsEnabled(), bots: onlineBots().map((b) => ({ name: b.name, games: b.games, max_games: b.max_games })), maps: MAPS.map(({ key, name, type, players, game_types, default: d }) => ({ key, name, type, players, game_types, default: !!d })) });
});

roomRouter.get('/:id/bot-host', authMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const job = await activeJobForRoom(req.params.id);
    if (job) return res.json(await jobToPublic(job));
    const last = await db.query('SELECT * FROM bot_jobs WHERE room_id = $1 ORDER BY id DESC LIMIT 1', [req.params.id]);
    return res.json(last.rows[0] ? await jobToPublic(last.rows[0]) : null);
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Host: "Бот хост" — { map_key? }
roomRouter.post('/:id/bot-host', authMW, async (req, res) => {
  const roomId = req.params.id;
  if (!botsEnabled()) return res.status(503).json({ error: 'Бот хост идэвхжээгүй (BOT_API_KEY тохируулаагүй)', code: 'BOT_DISABLED' });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const rr = await db.query('SELECT id, host_id, status, name, game_type FROM rooms WHERE id = $1', [roomId]);
    const room = rr.rows[0];
    if (!room) return res.status(404).json({ error: 'Өрөө олдсонгүй' });
    if (String(room.host_id) !== String(req.user.id)) return res.status(403).json({ error: 'Зөвхөн өрөөний host бот дуудна' });
    if (room.status === 'playing') return res.status(409).json({ error: 'Тоглолт аль хэдийн явагдаж байна' });
    if (await activeJobForRoom(roomId)) return res.status(409).json({ error: 'Энэ өрөөнд бот хост аль хэдийн хүсэгдсэн байна' });
    const map = pickMap(req.body?.map_key, room.game_type);
    if (!map) return res.status(400).json({ error: 'Map олдсонгүй' });
    if (!onlineBots().length) return res.status(503).json({ error: 'Одоогоор онлайн бот алга — түр хүлээгээд дахин оролдоно уу', code: 'NO_BOT_ONLINE' });

    const members = await db.query(
      'SELECT u.id, u.username FROM room_players rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = $1', [roomId]
    );
    const gameName = sanitizeGameName(`GMN#${roomId} ${room.name}`);
    const ins = await db.query(
      `INSERT INTO bot_jobs (room_id, requested_by, map_key, map_name, game_name, owner_name, expected_players, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'queued') RETURNING *`,
      [roomId, req.user.id, map.key, map.name, gameName, req.user.username, JSON.stringify(members.rows.map((m) => ({ user_id: m.id, name: m.username })))]
    );
    const pub = await jobToPublic(ins.rows[0]);
    emitRoom(roomId, 'room:bot_job', pub);
    return res.status(201).json(pub);
  } catch (e) { console.error('[bot-host]', e); return res.status(500).json({ error: 'Server error' }); }
});

// Host: цуцлах
roomRouter.delete('/:id/bot-host', authMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const job = await activeJobForRoom(req.params.id);
    if (!job) return res.json({ ok: true });
    const rr = await db.query('SELECT host_id FROM rooms WHERE id = $1', [req.params.id]);
    if (String(rr.rows[0]?.host_id) !== String(req.user.id)) return res.status(403).json({ error: 'Зөвхөн host' });
    if (job.status === 'started') return res.status(409).json({ error: 'Тоглолт эхэлсэн тул цуцлах боломжгүй' });
    await db.query(`UPDATE bot_jobs SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [job.id]);
    emitRoom(job.room_id, 'room:bot_job', await jobToPublic({ ...job, status: 'cancelled' }));
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// ════════════════ Бот тал (hostbot/bridge.js) ════════════════
const botRouter = express.Router();    // mount: /bot
botRouter.use(botAuth);

botRouter.post('/heartbeat', (req, res) => {
  const name = String(req.body?.bot || req.query.bot || 'bot').slice(0, 64);
  bots.set(name, { last_seen: Date.now(), games: Number(req.body?.games || 0), max_games: Number(req.body?.max_games || 1), version: String(req.body?.version || '') });
  res.json({ ok: true, server_time: new Date().toISOString() });
});

botRouter.get('/maps', (_req, res) => res.json(MAPS));

// Дараагийн ажлыг атомаар авна (queued → hosting)
botRouter.get('/jobs/next', async (req, res) => {
  const name = String(req.query.bot || 'bot').slice(0, 64);
  bots.set(name, { ...(bots.get(name) || { games: 0, max_games: 1, version: '' }), last_seen: Date.now() });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    // queued ажлууд дотроос 30 минутаас хуучныг нь cancel
    await db.query(`UPDATE bot_jobs SET status='cancelled', error='timeout (queued)', updated_at=NOW() WHERE status='queued' AND created_at < NOW() - INTERVAL '${LOBBY_TIMEOUT_MIN} minutes'`);
    await db.query(`UPDATE bot_jobs SET status='cancelled', error='timeout (lobby)', updated_at=NOW() WHERE status IN ('hosting','lobby') AND updated_at < NOW() - INTERVAL '${LOBBY_TIMEOUT_MIN} minutes'`);
    const r = await db.query(
      `UPDATE bot_jobs SET status = 'hosting', bot_name = $1, updated_at = NOW()
       WHERE id = (SELECT id FROM bot_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [name]
    );
    const job = r.rows[0];
    if (!job) return res.json(null);
    const map = MAPS.find((m) => m.key === job.map_key) || null;
    emitRoom(job.room_id, 'room:bot_job', await jobToPublic(job));
    return res.json({ ...job, map });
  } catch (e) { console.error('[bot/jobs/next]', e); return res.status(500).json({ error: 'Server error' }); }
});

async function loadJob(req, res) {
  if (!await dbOk()) { res.status(503).json({ error: 'Service temporarily unavailable' }); return null; }
  const r = await db.query('SELECT * FROM bot_jobs WHERE id = $1', [req.params.id]);
  if (!r.rows[0]) { res.status(404).json({ error: 'job not found' }); return null; }
  return r.rows[0];
}

// Lobby нээгдлээ: { host_ip, host_port, gameinfo_b64, game_name? }
botRouter.post('/jobs/:id/lobby', async (req, res) => {
  const job = await loadJob(req, res); if (!job) return;
  const { host_ip, host_port, gameinfo_b64, game_name } = req.body || {};
  if (!host_ip || !host_port || !gameinfo_b64) return res.status(400).json({ error: 'host_ip, host_port, gameinfo_b64 required' });
  if (String(gameinfo_b64).length > 4096) return res.status(400).json({ error: 'gameinfo too large' });
  try {
    const r = await db.query(
      `UPDATE bot_jobs SET status = CASE WHEN status IN ('hosting','lobby') THEN 'lobby' ELSE status END,
         host_ip = $1, host_port = $2, gameinfo_b64 = $3, game_name = COALESCE($4, game_name), updated_at = NOW()
       WHERE id = $5 RETURNING *`,
      [String(host_ip).slice(0, 64), Number(host_port), String(gameinfo_b64), game_name ? sanitizeGameName(game_name) : null, job.id]
    );
    const pub = await jobToPublic(r.rows[0]);
    emitRoom(job.room_id, 'room:bot_lobby', pub);
    return res.json({ ok: true, job: pub });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Тоглолт эхэллээ: { players: [{name, slot?, team?}] }
botRouter.post('/jobs/:id/started', async (req, res) => {
  const job = await loadJob(req, res); if (!job) return;
  try {
    await db.query(`UPDATE bot_jobs SET status = 'started', started_at = NOW(), updated_at = NOW() WHERE id = $1`, [job.id]);
    if (job.room_id) {
      await db.query(`UPDATE rooms SET status = 'playing' WHERE id = $1`, [job.room_id]);
      if (_io) { _io.to(String(job.room_id)).emit('room:started'); _io.emit('rooms:updated'); }
    }
    emitRoom(job.room_id, 'room:bot_started', { job_id: job.id, players: req.body?.players || [] });
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Дүн: { winner_team (1 Sentinel | 2 Scourge), duration_minutes, players: [{name, team, kills, deaths, assists, hero, left_at_sec, is_leaver}] }
botRouter.post('/jobs/:id/result', async (req, res) => {
  const job = await loadJob(req, res); if (!job) return;
  const { winner_team, duration_minutes, players } = req.body || {};
  if (![1, 2].includes(Number(winner_team)) || !Array.isArray(players)) return res.status(400).json({ error: 'winner_team (1|2) + players[] required' });
  if (job.status === 'finished') return res.json({ ok: true, already: true, game_result_id: job.game_result_id });
  try {
    const out = await recordGameResult({
      roomId: job.room_id, winnerTeam: Number(winner_team), durationMinutes: Number(duration_minutes || 0),
      players, source: 'bot', botJobId: job.id, mapName: job.map_name, gameName: job.game_name,
    });
    await db.query(`UPDATE bot_jobs SET status = 'finished', finished_at = NOW(), updated_at = NOW(), game_result_id = $1 WHERE id = $2`, [out.result?.id || null, job.id]);
    if (_io && job.room_id) {
      _io.to(String(job.room_id)).emit('room:bot_result', {
        job_id: job.id, winner_team: Number(winner_team), duration_minutes: Number(duration_minutes || 0),
        players: (out.players || []).map((p) => ({ user_id: p.user_id, name: p.wc3_name, team: p.team, is_winner: p.is_winner, kills: p.kills, deaths: p.deaths, assists: p.assists, hero: p.hero, is_leaver: p.is_leaver, xp_earned: p.xp_earned, diamonds_earned: p.diamonds_earned })),
        duplicate: !!out.duplicate,
      });
      _io.to(String(job.room_id)).emit('room:host_game_ended');
      _io.emit('rooms:updated');
    }
    return res.status(201).json({ ok: true, game_result_id: out.result?.id, duplicate: !!out.duplicate });
  } catch (e) {
    console.error('[bot/result]', e);
    return res.status(500).json({ error: e.message || 'Server error' });
  }
});

// Алдаа: { error }
botRouter.post('/jobs/:id/failed', async (req, res) => {
  const job = await loadJob(req, res); if (!job) return;
  try {
    await db.query(`UPDATE bot_jobs SET status = 'failed', error = $1, finished_at = NOW(), updated_at = NOW() WHERE id = $2`, [String(req.body?.error || 'unknown').slice(0, 500), job.id]);
    if (job.room_id) {
      await db.query(`UPDATE rooms SET status = 'waiting' WHERE id = $1 AND status = 'playing'`, [job.room_id]);
    }
    emitRoom(job.room_id, 'room:bot_job', await jobToPublic({ ...job, status: 'failed', error: req.body?.error }));
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

module.exports = { roomRouter, botRouter, setIO, botsEnabled, MAPS };
