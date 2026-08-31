// ── RGC маягийн бот хост ──
// Платформ тал (JWT): өрөөний host "Бот хост" дарна → bot_jobs дараалалд орно.
// Бот тал (x-bot-key): VPS дээрх hostbot/bridge.js ажил авч GHost++-ээр хостолж, lobby/started/result мэдээлнэ.
// Бүх төлөвийн өөрчлөлт өрөөний socket room руу 'room:bot_*' event-ээр очно.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const authMW = require('../middleware/auth');
const { perUser } = require('../middleware/ratelimit');
const { recordGameResult } = require('../services/results');
const botops = require('../services/botops');
const adminMW = require('../middleware/admin');

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
const MAX_GAME_MIN = 240;                 // started тоглолт 4ц-аас удвал гацсан гэж үзэж цуцална

const bots = new Map();                   // bot_name -> { last_seen, games, max_games, version }

// Ботын давуу эрх: env BOT_PRIORITY="ub-bot-1,mn-bot-1" — жагсаалтын эхний АМЬД,
// БАГТААМЖТАЙ бот ажил авна; бусад нь зөвхөн тэр unavailable үед fallback болно.
// (2026-08-31: УБ бот 5ms тул тэргүүн ээлжинд, Tokyo 66ms — нөөц.)
const BOT_PRIORITY = (process.env.BOT_PRIORITY || '').split(',').map((s) => s.trim()).filter(Boolean);

function preferredAliveBot() {
  for (const b of BOT_PRIORITY) {
    const info = bots.get(b);
    if (info && Date.now() - info.last_seen < BOT_STALE_SEC * 1000
        && Number(info.games || 0) < Number(info.max_games || 1)) return b;
  }
  return null;
}

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
function sanitizeGameName(s, maxLen = 31) {
  return String(s || 'Garena.mn').replace(/[^\w\s\-\.#!А-Яа-яӨөҮүЁё]/g, '').trim().slice(0, maxLen).trim() || 'Garena.mn';
}
// WC3-ийн LAN нэр (registry userlocal эсвэл REQJOIN пакетаас): хяналтын тэмдэгтгүй, ≤31
function sanitizeWc3Name(s) {
  const v = String(s || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 31);
  return v || null;
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

// Гацсан ажлуудыг цэвэрлэх watchdog — бот poll хийж байгаа эсэхээс ҮЛ ХАМААРАН ажиллана (setInterval доор).
// Ингэснээр ганц бот offline болоход queued/lobby/started ажил үүрд гацахгүй, өрөө "playing"-д тээглэхгүй.
async function sweepStaleJobs() {
  if (!db || !await dbOk()) return;
  try {
    const r = await db.query(
      `UPDATE bot_jobs SET status='cancelled',
         error = CASE WHEN status='queued' THEN 'timeout (queued)'
                      WHEN status='started' THEN 'timeout (started >4h)'
                      ELSE 'timeout (lobby)' END,
         updated_at=NOW()
       WHERE (status='queued'               AND created_at < NOW() - INTERVAL '${LOBBY_TIMEOUT_MIN} minutes')
          OR (status IN ('hosting','lobby')  AND updated_at < NOW() - INTERVAL '${LOBBY_TIMEOUT_MIN} minutes')
          OR (status='started'               AND started_at < NOW() - INTERVAL '${MAX_GAME_MIN} minutes')
       RETURNING id, room_id`
    );
    for (const row of r.rows) {
      if (!row.room_id) continue;
      await db.query(`UPDATE rooms SET status='waiting' WHERE id=$1 AND status='playing'`, [row.room_id]).catch(() => {});
      emitRoom(row.room_id, 'room:bot_job', { id: row.id, status: 'cancelled', error: 'timeout' });
    }
    if (r.rows.length && _io) _io.emit('rooms:updated');
    if (r.rows.length) console.log(`[bot watchdog] ${r.rows.length} гацсан ажил цуцлав`);
  } catch (e) { console.error('[bot watchdog]', e.message); }
}
setInterval(sweepStaleJobs, 60 * 1000).unref();   // минут тутам — bot poll-оос хамааралгүй (.unref → тест/shutdown-д саад болохгүй)

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
roomRouter.post('/:id/bot-host', authMW, perUser('bot-host', 10, 10 * 60 * 1000, 'Бот хостын хүсэлт хэт олон — 10 минутын дараа дахин оролдоно уу.'), async (req, res) => {
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
    // GHost++ autohost нэр дээр " #<тоологч>" нэмдэг тул суурь нэрийг 27-д багтаана
    // (31 хатуу WC3 хязгаар − " #NN"); эс бөгөөс autohost "name too long" гэж зогсоно.
    const gameName = sanitizeGameName(`GMN#${roomId} ${room.name}`, 27);
    // GHost++ зөвхөн autohost_owner-тэй ИЖИЛ WC3 нэртэй тоглогчийн !start-ыг хүлээн авдаг → хостын WC3 нэрийг
    // клиент (registry userlocal) илгээнэ; байхгүй бол өмнө нь сурсан users.wc3_name, тэр ч үгүй бол платформын нэр.
    let ownerName = sanitizeWc3Name(req.body?.owner_name);
    if (ownerName) {
      await db.query('UPDATE users SET wc3_name = $1 WHERE id = $2', [ownerName, req.user.id]).catch(() => {});
    } else {
      const w = await db.query('SELECT wc3_name FROM users WHERE id = $1', [req.user.id]).catch(() => ({ rows: [] }));
      ownerName = sanitizeWc3Name(w.rows[0]?.wc3_name) || req.user.username;
    }
    // Давхар job-оос сэргийлж атомаар оруулна: идэвхтэй job байвал WHERE NOT EXISTS-ээр огт оруулахгүй
    // (line 104-ийн шалгалт TOCTOU-той тул хоёр зэрэг хүсэлт хоёулаа орж 2 lobby үүсэхээс энэ хамгаална).
    const ins = await db.query(
      `INSERT INTO bot_jobs (room_id, requested_by, map_key, map_name, game_name, owner_name, expected_players, status)
       SELECT $1,$2,$3,$4,$5,$6,$7,'queued'
       WHERE NOT EXISTS (SELECT 1 FROM bot_jobs WHERE room_id = $1 AND status IN ('queued','hosting','lobby','started'))
       RETURNING *`,
      [roomId, req.user.id, map.key, map.name, gameName, ownerName, JSON.stringify(members.rows.map((m) => ({ user_id: m.id, name: m.username })))]
    );
    if (!ins.rows[0]) return res.status(409).json({ error: 'Энэ өрөөнд бот хост аль хэдийн хүсэгдсэн байна' });
    const pub = await jobToPublic(ins.rows[0]);
    emitRoom(roomId, 'room:bot_job', pub);
    return res.status(201).json(pub);
  } catch (e) { console.error('[bot-host]', e); return res.status(500).json({ error: 'Server error' }); }
});

// Гишүүн: "WC3 нээж нэгдэх" дарахад / WC3 ботын lobby-д орох REQJOIN явуулахад — { wc3_name? }
// WC3 нэр + нийтийн IP-г ажилд бүртгэнэ → дүн ирэхэд GHost++-ийн тоглогч (нэр|IP) ↔ платформын хэрэглэгч тааруулна.
roomRouter.post('/:id/bot-host/join', authMW, perUser('bot-join', 60, 10 * 60 * 1000), async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const roomId = req.params.id;
    const member = await db.query('SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2', [roomId, req.user.id]);
    if (!member.rows[0]) return res.status(403).json({ error: 'Та энэ өрөөний гишүүн биш' });
    const job = await activeJobForRoom(roomId);
    if (!job) return res.status(404).json({ error: 'Идэвхтэй бот хост алга' });
    const wc3Name = sanitizeWc3Name(req.body?.wc3_name);
    const ip = String(req.ip || '').replace(/^::ffff:/, '').slice(0, 64) || null;
    await db.query(
      `INSERT INTO bot_job_players (job_id, user_id, wc3_name, ip) VALUES ($1,$2,$3,$4)
       ON CONFLICT (job_id, user_id) DO UPDATE SET wc3_name = COALESCE(EXCLUDED.wc3_name, bot_job_players.wc3_name), ip = COALESCE(EXCLUDED.ip, bot_job_players.ip), updated_at = NOW()`,
      [job.id, req.user.id, wc3Name, ip]
    );
    if (wc3Name) await db.query('UPDATE users SET wc3_name = $1 WHERE id = $2', [wc3Name, req.user.id]).catch(() => {});
    emitRoom(job.room_id, 'room:bot_join', { job_id: job.id, user_id: req.user.id, username: req.user.username, wc3_name: wc3Name });
    return res.json({ ok: true, job_id: job.id, wc3_name: wc3Name });
  } catch (e) { console.error('[bot-host/join]', e); return res.status(500).json({ error: 'Server error' }); }
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
  if (!bots.has(name)) botops.record('info', 'bot_seen', `Бот "${name}" холбогдлоо (v${String(req.body?.version || '?')})`, { bot: name });
  bots.set(name, { last_seen: Date.now(), games: Number(req.body?.games || 0), max_games: Number(req.body?.max_games || 1), version: String(req.body?.version || '') });
  res.json({ ok: true, server_time: new Date().toISOString() });
});

botRouter.get('/maps', (_req, res) => res.json(MAPS));

// Ботын идэвхтэй жобуудын серверийн төлөв — bridge үүгээр цуцлалтыг мэдэж GHost-оо зогсооно
botRouter.get('/jobs/status', async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((s) => parseInt(s, 10)).filter(Number.isFinite).slice(0, 50);
  if (!ids.length) return res.json({ jobs: [] });
  try {
    const r = await db.query('SELECT id, status FROM bot_jobs WHERE id = ANY($1::int[])', [ids]);
    return res.json({ jobs: r.rows });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Дараагийн ажлыг атомаар авна (queued → hosting)
botRouter.get('/jobs/next', async (req, res) => {
  const name = String(req.query.bot || 'bot').slice(0, 64);
  bots.set(name, { ...(bots.get(name) || { games: 0, max_games: 1, version: '' }), last_seen: Date.now() });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  // Давуу эрхтэй бот амьд + багтаамжтай байвал ажлыг ТҮҮНД үлдээнэ (бусдад null).
  // Тэр бот offline/дүүрэн болмогц дараагийнх нь автоматаар авна (fallback хэвээр).
  const pref = preferredAliveBot();
  if (pref && pref !== name) return res.json(null);
  try {
    // Гацсан ажлуудыг цэвэрлэнэ (queued/lobby/started timeout) — standalone watchdog-той ижил логик
    await sweepStaleJobs();
    const r = await db.query(
      `UPDATE bot_jobs SET status = 'hosting', bot_name = $1, updated_at = NOW()
       WHERE id = (SELECT id FROM bot_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED)
       RETURNING *`,
      [name]
    );
    const job = r.rows[0];
    if (!job) return res.json(null);
    const map = MAPS.find((m) => m.key === job.map_key) || null;
    botops.record('info', 'job_taken', `Ажил #${job.id} (${job.game_name}) → бот "${name}"`, { bot: name, job_id: job.id });
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
    // Зөвхөн hosting/lobby төлөвт хүлээн авна — цуцлагдсан/дууссан жобын хоцорсон POST
    // host_ip-г дарж бичээд хэрэглэгчдэд худал "тоглоом нээлээ" событ цацдаг байсныг хаав
    const r = await db.query(
      `UPDATE bot_jobs SET status = 'lobby',
         host_ip = $1, host_port = $2, gameinfo_b64 = $3, game_name = COALESCE($4, game_name), updated_at = NOW()
       WHERE id = $5 AND status IN ('hosting','lobby') RETURNING *`,
      [String(host_ip).slice(0, 64), Number(host_port), String(gameinfo_b64), game_name ? sanitizeGameName(game_name) : null, job.id]
    );
    if (!r.rows[0]) return res.status(409).json({ error: `job is '${job.status}', not hosting/lobby` });
    const pub = await jobToPublic(r.rows[0]);
    emitRoom(job.room_id, 'room:bot_lobby', pub);
    return res.json({ ok: true, job: pub });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Тоглолт эхэллээ: { players: [{name, ip?, slot?, team?}] }
botRouter.post('/jobs/:id/started', async (req, res) => {
  const job = await loadJob(req, res); if (!job) return;
  if (job.status === 'started') return res.json({ ok: true, already: true });
  try {
    // Зөвхөн hosting/lobby төлөвөөс started болгоно — цуцлагдсан/дууссан жоб дээр
    // хуурамч "тоглолт эхэллээ" цацаж өрөөг playing болгохоос сэргийлнэ
    const upd = await db.query(`UPDATE bot_jobs SET status = 'started', started_at = NOW(), updated_at = NOW() WHERE id = $1 AND status IN ('hosting','lobby') RETURNING id`, [job.id]);
    if (!upd.rows[0]) return res.status(409).json({ error: `job is '${job.status}', not hosting/lobby` });
    botops.record('info', 'job_started', `Ажил #${job.id} (${job.game_name}) эхэллээ — ${(req.body?.players || []).length} тоглогч`, { job_id: job.id });
    if (job.room_id) {
      await db.query(`UPDATE rooms SET status = 'playing' WHERE id = $1`, [job.room_id]);
      if (_io) { _io.to(String(job.room_id)).emit('room:started'); _io.emit('rooms:updated'); }
    }
    emitRoom(job.room_id, 'room:bot_started', { job_id: job.id, players: req.body?.players || [] });
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// Дүн: { winner_team (1 Sentinel | 2 Scourge), duration_minutes, players: [{name, ip?, team, kills, deaths, assists, hero, left_at_sec, is_leaver}] }
botRouter.post('/jobs/:id/result', async (req, res) => {
  const job = await loadJob(req, res); if (!job) return;
  const { winner_team, duration_minutes, players } = req.body || {};
  if (![1, 2].includes(Number(winner_team)) || !Array.isArray(players)) return res.status(400).json({ error: 'winner_team (1|2) + players[] required' });
  if (job.status === 'finished') return res.json({ ok: true, already: true, game_result_id: job.game_result_id });
  // Зөвхөн бодит тоглолт эхэлсэн (lobby/started) жобын дүнг хүлээн авна —
  // queued/cancelled/failed жоб дээр хуурамч дүнгээр XP/💎/wins үүсгэхээс сэргийлнэ
  if (!['lobby', 'started'].includes(job.status)) return res.status(409).json({ error: `job is '${job.status}', cannot record result` });
  try {
    const out = await recordGameResult({
      roomId: job.room_id, winnerTeam: Number(winner_team), durationMinutes: Number(duration_minutes || 0),
      players, source: 'bot', botJobId: job.id, mapName: job.map_name, gameName: job.game_name,
    });
    await db.query(`UPDATE bot_jobs SET status = 'finished', finished_at = NOW(), updated_at = NOW(), game_result_id = $1 WHERE id = $2`, [out.result?.id || null, job.id]);
    botops.record('info', 'job_finished', `Ажил #${job.id} (${job.game_name}) дууслаа — team ${Number(winner_team)} ялав, ${Number(duration_minutes || 0)} мин, ${(out.players || []).filter((p) => p.user_id).length}/${players.length} тоглогч таарав`, { job_id: job.id });
    if (_io && job.room_id) {
      _io.to(String(job.room_id)).emit('room:bot_result', {
        job_id: job.id, winner_team: Number(winner_team), duration_minutes: Number(duration_minutes || 0),
        players: (out.players || []).map((p) => ({ user_id: p.user_id, name: p.wc3_name, team: p.team, is_winner: p.is_winner, kills: p.kills, deaths: p.deaths, assists: p.assists, hero: p.hero, is_leaver: p.is_leaver, xp_earned: p.xp_earned, diamonds_earned: p.diamonds_earned })),
        duplicate: !!out.duplicate,
      });
      // 'room:host_game_ended' илгээхгүй — тэр event тоглогчдын WC3-г хүчээр хаадаг (хост WC3 хаасан горим);
      // ботын тоглолт дуусахад тоглогчид өөрсдөө гарна, клиент room:bot_result-ээр төлөвөө шинэчилнэ.
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
  // Дууссан жобыг 'failed' болгож дүнгийн холбоосыг арилгахаас сэргийлнэ
  if (job.status === 'finished') return res.json({ ok: true, already: true });
  try {
    await db.query(`UPDATE bot_jobs SET status = 'failed', error = $1, finished_at = NOW(), updated_at = NOW() WHERE id = $2 AND status <> 'finished'`, [String(req.body?.error || 'unknown').slice(0, 500), job.id]);
    const err = String(req.body?.error || 'unknown');
    // lobby timeout (хэн ч нэгдээгүй) = энгийн; бусад алдаа = Discord мэдэгдэл
    botops.alert(/lobby (дууссан|timeout)/i.test(err) ? 'info' : 'warn', 'job_failed', `Ажил #${job.id} (${job.game_name}, өрөө ${job.room_id}) FAILED: ${err.slice(0, 300)}`, { job_id: job.id, bot: job.bot_name });
    if (job.room_id) {
      await db.query(`UPDATE rooms SET status = 'waiting' WHERE id = $1 AND status = 'playing'`, [job.room_id]);
    }
    emitRoom(job.room_id, 'room:bot_job', await jobToPublic({ ...job, status: 'failed', error: req.body?.error }));
    return res.json({ ok: true });
  } catch (e) { console.error(e); return res.status(500).json({ error: 'Server error' }); }
});

// ════════════════ Админ тал (C2): /admin/api/bot/* ════════════════
const adminRouter = express.Router();
adminRouter.use(adminMW);

// Тойм: ботууд (онлайн/офлайн), сүүлийн ажлууд, үйл явдлын лог
adminRouter.get('/overview', async (req, res) => {
  const now = Date.now();
  const botList = [...bots.entries()].map(([name, b]) => ({
    name, online: now - b.last_seen < BOT_STALE_SEC * 1000, last_seen: new Date(b.last_seen).toISOString(),
    seconds_ago: Math.round((now - b.last_seen) / 1000), games: b.games, max_games: b.max_games, version: b.version,
  }));
  let jobs = [];
  if (await dbOk()) {
    try {
      const r = await db.query(
        `SELECT j.*, r.name AS room_name, u.username AS requested_by_name
           FROM bot_jobs j LEFT JOIN rooms r ON r.id = j.room_id LEFT JOIN users u ON u.id = j.requested_by
          ORDER BY j.id DESC LIMIT $1`, [Math.min(200, Number(req.query.limit) || 50)]);
      jobs = r.rows.map((j) => ({ ...j, gameinfo_b64: undefined, expected_players: undefined }));
    } catch (e) { console.error('[admin/bot/overview]', e); }
  }
  res.json({ enabled: botsEnabled(), alerts_configured: botops.configured(), bots: botList, jobs, events: botops.recentEvents(100), stale_sec: BOT_STALE_SEC });
});

// Ажил цуцлах (queued/hosting/lobby) — бот дараагийн poll-оор GHost++-ээ зогсооно
adminRouter.post('/jobs/:id/cancel', async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const r = await db.query('SELECT * FROM bot_jobs WHERE id = $1', [req.params.id]);
  const job = r.rows[0];
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (!['queued', 'hosting', 'lobby'].includes(job.status)) return res.status(409).json({ error: `Төлөв ${job.status} — цуцлах боломжгүй` });
  await db.query(`UPDATE bot_jobs SET status = 'cancelled', error = $2, updated_at = NOW() WHERE id = $1`, [job.id, `админ ${req.user?.username || ''} цуцалсан`]);
  botops.record('warn', 'job_cancelled', `Ажил #${job.id} (${job.game_name}) админ цуцаллаа (${req.user?.username || ''})`, { job_id: job.id });
  emitRoom(job.room_id, 'room:bot_job', await jobToPublic({ ...job, status: 'cancelled' }));
  return res.json({ ok: true });
});

// Дахин хост: хуучин ажлын өрөө/map/owner-оор шинэ queued ажил (өрөө хаагдаагүй, тоглоогүй бол)
adminRouter.post('/jobs/:id/retry', async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const r = await db.query('SELECT * FROM bot_jobs WHERE id = $1', [req.params.id]);
  const job = r.rows[0];
  if (!job) return res.status(404).json({ error: 'job not found' });
  if (!job.room_id) return res.status(409).json({ error: 'Өрөө устсан' });
  const rr = await db.query('SELECT id, status FROM rooms WHERE id = $1', [job.room_id]);
  if (!rr.rows[0] || rr.rows[0].status === 'done') return res.status(409).json({ error: 'Өрөө хаагдсан' });
  if (rr.rows[0].status === 'playing') return res.status(409).json({ error: 'Өрөө тоглож байна' });
  if (await activeJobForRoom(job.room_id)) return res.status(409).json({ error: 'Энэ өрөөнд идэвхтэй ажил байна' });
  if (!onlineBots().length) return res.status(503).json({ error: 'Онлайн бот алга' });
  const ins = await db.query(
    `INSERT INTO bot_jobs (room_id, requested_by, map_key, map_name, game_name, owner_name, expected_players, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'queued') RETURNING *`,
    [job.room_id, job.requested_by, job.map_key, job.map_name, job.game_name, job.owner_name, job.expected_players ? JSON.stringify(job.expected_players) : null]);
  const pub = await jobToPublic(ins.rows[0]);
  botops.record('info', 'job_retry', `Ажил #${job.id} → шинэ ажил #${ins.rows[0].id} (админ ${req.user?.username || ''})`, { job_id: ins.rows[0].id });
  emitRoom(job.room_id, 'room:bot_job', pub);
  return res.status(201).json(pub);
});

// Discord мэдэгдлийн тест
adminRouter.post('/alerts/test', async (req, res) => {
  if (!botops.configured()) return res.status(400).json({ error: 'OPS_DISCORD_WEBHOOK тохируулаагүй' });
  const ok = await botops.notify(`🔔 Garena.mn ops тест — ${req.user?.username || 'админ'} илгээв`);
  return res.json({ ok });
});

botops.start(() => bots);

module.exports = { roomRouter, botRouter, adminRouter, setIO, botsEnabled, MAPS };
