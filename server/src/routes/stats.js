const express = require('express');
const axios = require('axios');
const auth = require('../middleware/auth');
const { perUser } = require('../middleware/ratelimit');
const admin = require('../middleware/admin');
const { recordGameResult } = require('../services/results');

let db;
try { db = require('../config/db'); } catch { db = null; }

async function dbAvailable() {
  if (!db) return false;
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

const router = express.Router();
let tierBotColumnsReady = false;

// RZR Bot-руу үр дүн илгээх
async function notifyRZRBot(payload) {
  const rzrUrl = process.env.RZR_BOT_URL;
  const secret = process.env.WEBHOOK_SECRET;
  if (!rzrUrl) return;

  try {
    await axios.post(`${rzrUrl}/api/game_result`, payload, {
      headers: { 'X-Secret': secret || '' },
      timeout: 10000,
    });
    console.log('RZR Bot-д мэдэгдэл илгээгдлээ');
  } catch (err) {
    console.error('RZR Bot мэдэгдэл алдаа:', err.message);
  }
}

async function ensureTierBotColumns() {
  if (tierBotColumnsReady) return;
  if (!db) return;
  await db.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS tierbot_id VARCHAR(255),
      ADD COLUMN IF NOT EXISTS tierbot_rating INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS tierbot_tier VARCHAR(100),
      ADD COLUMN IF NOT EXISTS tierbot_rank INTEGER,
      ADD COLUMN IF NOT EXISTS tierbot_synced_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS platform_wins INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS platform_losses INTEGER DEFAULT 0;

    CREATE INDEX IF NOT EXISTS idx_users_tierbot_id ON users(tierbot_id);
    CREATE INDEX IF NOT EXISTS idx_users_tierbot_rating ON users(tierbot_rating DESC);
  `);
  tierBotColumnsReady = true;
}

function firstValue(source, keys) {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null && source?.[key] !== '') {
      return source[key];
    }
  }
  return null;
}

function toNonNegativeInt(value, fallback = 0) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cleanText(value, max = 255) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function extractTierBotRows(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.players,
    payload?.ranking,
    payload?.leaderboard,
    payload?.ranks,
    payload?.data,
    payload?.data?.players,
    payload?.data?.ranking,
    payload?.data?.leaderboard,
    payload?.result,
    payload?.result?.players,
  ];
  return candidates.find(Array.isArray) || [];
}

function normalizeTierBotPlayer(row, index) {
  const username = cleanText(firstValue(row, [
    'username', 'name', 'player', 'player_name', 'playerName', 'display_name', 'displayName',
    'nickname', 'nick',
  ]));
  if (!username) return null;

  return {
    username,
    discord_id: cleanText(firstValue(row, ['discord_id', 'discordId', 'discord', 'discord_user_id', 'discordUserId'])),
    tierbot_id: cleanText(firstValue(row, ['tierbot_id', 'tierbotId', 'player_id', 'playerId', 'id'])),
    wins: toNonNegativeInt(firstValue(row, ['wins', 'win', 'w']), 0),
    losses: toNonNegativeInt(firstValue(row, ['losses', 'loss', 'loses', 'l']), 0),
    rating: toNonNegativeInt(firstValue(row, ['rating', 'points', 'score', 'mmr', 'elo']), 0),
    tier: cleanText(firstValue(row, ['tier', 'division', 'rank_name', 'rankName', 'league']), 100),
    rank: toNonNegativeInt(firstValue(row, ['rank', 'position', 'place']), index + 1),
  };
}

function tierBotSourceUrl(requestUrl) {
  const raw = cleanText(requestUrl || process.env.TIERBOT_STATS_URL, 2048);
  if (!raw) return null;
  const parsed = new URL(raw);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('TierBot URL must be http(s)');
  }
  return parsed.toString();
}

function tierBotHeaders() {
  const headers = {};
  if (process.env.TIERBOT_API_TOKEN) headers.Authorization = `Bearer ${process.env.TIERBOT_API_TOKEN}`;
  if (process.env.TIERBOT_API_KEY) headers['X-API-Key'] = process.env.TIERBOT_API_KEY;
  return headers;
}

// opts.updateOnly (автомат sync): шинэ хэрэглэгч үүсгэхгүй, платформын username-ийг ДАРЖ бичихгүй —
// зөвхөн Discord ID/tierbot_id-аар таарсан хэрэглэгчийн tier/rating/wins/losses шинэчилнэ.
async function upsertTierBotPlayer(player, opts = {}) {
  let existing = null;
  if (player.discord_id) {
    const byDiscord = await db.query('SELECT id FROM users WHERE discord_id = $1', [player.discord_id]);
    existing = byDiscord.rows[0] || null;
  }
  if (!existing && player.tierbot_id) {
    const byTierBot = await db.query('SELECT id FROM users WHERE tierbot_id = $1', [player.tierbot_id]);
    existing = byTierBot.rows[0] || null;
  }
  if (!existing && !opts.updateOnly) {
    const byName = await db.query(
      'SELECT id FROM users WHERE LOWER(username) = LOWER($1) ORDER BY id ASC LIMIT 1',
      [player.username]
    );
    existing = byName.rows[0] || null;
  }
  if (opts.updateOnly) {
    if (!existing) return 'skipped';
    await db.query(
      `UPDATE users
       SET wins = $1, losses = $2, tierbot_id = COALESCE($3, tierbot_id), tierbot_rating = $4, tierbot_tier = $5, tierbot_rank = $6, tierbot_synced_at = NOW()
       WHERE id = $7`,
      [player.wins, player.losses, player.tierbot_id, player.rating, player.tier, player.rank, existing.id]
    );
    return 'updated';
  }

  const params = [
    player.username,
    player.discord_id,
    player.wins,
    player.losses,
    player.tierbot_id,
    player.rating,
    player.tier,
    player.rank,
  ];

  if (existing) {
    await db.query(
      `UPDATE users
       SET username = $1,
           discord_id = COALESCE($2, discord_id),
           wins = $3,
           losses = $4,
           tierbot_id = COALESCE($5, tierbot_id),
           tierbot_rating = $6,
           tierbot_tier = $7,
           tierbot_rank = $8,
           tierbot_synced_at = NOW()
       WHERE id = $9`,
      [...params, existing.id]
    );
    return 'updated';
  }

  await db.query(
    `INSERT INTO users
      (username, discord_id, wins, losses, tierbot_id, tierbot_rating, tierbot_tier, tierbot_rank, tierbot_synced_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
    params
  );
  return 'created';
}

// Тоглогчийн статистик — discord_id-гаар
router.get('/player/:discord_id', async (req, res) => {
  const { discord_id } = req.params;
  if (await dbAvailable()) {
    try {
      const result = await db.query(
        'SELECT id, username, avatar_url, (COALESCE(wins,0)+COALESCE(platform_wins,0)) AS wins, (COALESCE(losses,0)+COALESCE(platform_losses,0)) AS losses, created_at FROM users WHERE discord_id = $1',
        [discord_id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'Тоглогч олдсонгүй' });
      const user = result.rows[0];
      const total = user.wins + user.losses;
      const winrate = total > 0 ? ((user.wins / total) * 100).toFixed(1) : 0;
      return res.json({ ...user, total_games: total, winrate: `${winrate}%` });
    } catch (err) { console.error(err); }
  }
  res.status(404).json({ error: 'Тоглогч олдсонгүй (DB холбогдоогүй)' });
});

// Тоглогчийн статистик — user_id-гаар
router.get('/player/id/:userId', async (req, res) => {
  const { userId } = req.params;
  if (await dbAvailable()) {
    try {
      const result = await db.query(
        'SELECT id, username, avatar_url, tierbot_tier, (COALESCE(wins,0)+COALESCE(platform_wins,0)) AS wins, (COALESCE(losses,0)+COALESCE(platform_losses,0)) AS losses, created_at FROM users WHERE id = $1',
        [userId]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'Тоглогч олдсонгүй' });
      const user = result.rows[0];
      const total = user.wins + user.losses;
      const winrate = total > 0 ? ((user.wins / total) * 100).toFixed(1) : 0;
      // Платформ дээр тоглосон тоглолтуудын дундаж DotA статистик (game_players)
      let stats = null;
      try {
        const agg = await db.query(
          `SELECT COUNT(*)::int AS games,
             ROUND(AVG(kills)::numeric,1) AS avg_kills, ROUND(AVG(deaths)::numeric,1) AS avg_deaths,
             ROUND(AVG(assists)::numeric,1) AS avg_assists, ROUND(AVG(creep_kills)::numeric,1) AS avg_creeps,
             ROUND(AVG(creep_denies)::numeric,1) AS avg_denies, ROUND(AVG(neutral_kills)::numeric,1) AS avg_neutrals,
             ROUND(AVG(gold)::numeric,0) AS avg_gold
           FROM game_players WHERE user_id = $1`, [userId]);
        const a = agg.rows[0] || {};
        stats = { games: a.games || 0, avg_kills: a.avg_kills, avg_deaths: a.avg_deaths, avg_assists: a.avg_assists,
          avg_creeps: a.avg_creeps, avg_denies: a.avg_denies, avg_neutrals: a.avg_neutrals, avg_gold: a.avg_gold };
      } catch (e) { /* aggregate алдаа — эмзэг биш */ }
      return res.json({ ...user, total_games: total, winrate: `${winrate}%`, stats });
    } catch (err) { console.error(err); }
  }
  res.status(404).json({ error: 'Тоглогч олдсонгүй' });
});

// Тоглоомын түүх
router.get('/history/:userId', async (req, res) => {
  const { userId } = req.params;
  const page  = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 20;
  const offset = (page - 1) * limit;

  if (await dbAvailable()) {
    try {
      // game_players table байгаа эсэх шалгах
      const tableCheck = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_name='game_players'`
      );
      if (!tableCheck.rows[0]) return res.json({ games: [], total: 0, page: 1, totalPages: 0 });

      const result = await db.query(`
        SELECT gr.id, gr.winner_team, gr.duration_minutes, gr.played_at, gr.source, gr.map_name,
          gp.team, gp.is_winner, gp.kills, gp.deaths, gp.assists, gp.hero, gp.is_leaver,
          gp.xp_earned, gp.diamonds_earned,
          r.name AS room_name, r.game_type
        FROM game_players gp
        JOIN game_results gr ON gp.game_result_id = gr.id
        LEFT JOIN rooms r ON gr.room_id = r.id
        WHERE gp.user_id = $1
        ORDER BY gr.played_at DESC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);

      const countResult = await db.query(
        'SELECT COUNT(*) FROM game_players WHERE user_id = $1', [userId]
      );
      return res.json({
        games: result.rows,
        total: parseInt(countResult.rows[0].count),
        page,
        totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
      });
    } catch (err) { console.error(err); }
  }
  res.json({ games: [], total: 0, page: 1, totalPages: 0 });
});

// Шилдэг тоглогчид (pagination + sort)
router.get('/ranking', async (req, res) => {
  const page   = Math.max(1, parseInt(req.query.page)  || 1);
  const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
  const offset = (page - 1) * limit;
  const sortBy = req.query.sort || 'wins';

  // tw/tl = нийт хож/хожигдол (TierBot + платформ). Эрэмбэ/винрэйтэд нийлбэрийг ашиглана.
  const TW = '(COALESCE(wins,0)+COALESCE(platform_wins,0))';
  const TL = '(COALESCE(losses,0)+COALESCE(platform_losses,0))';
  const allowedSorts = {
    wins:        `${TW} DESC`,
    winrate:     `CASE WHEN (${TW}+${TL})>0 THEN ${TW}::DECIMAL/(${TW}+${TL}) ELSE 0 END DESC`,
    total_games: `(${TW}+${TL}) DESC`,
    rating:      `tierbot_rating DESC NULLS LAST, tierbot_rank ASC NULLS LAST, ${TW} DESC`,
  };
  const orderClause = allowedSorts[sortBy] || allowedSorts.wins;

  if (await dbAvailable()) {
    try {
      await ensureTierBotColumns();
      const result = await db.query(`
        SELECT id, username, avatar_url,
          ${TW} AS wins, ${TL} AS losses,
          COALESCE(tierbot_rating, 0) AS tierbot_rating,
          tierbot_tier,
          tierbot_rank,
          tierbot_synced_at,
          CASE WHEN (${TW}+${TL})>0
            THEN ROUND((${TW}::DECIMAL/(${TW}+${TL}))*100, 1)
            ELSE 0
          END AS winrate
        FROM users
        WHERE (${TW} + ${TL}) > 0 OR COALESCE(tierbot_rating, 0) > 0 OR tierbot_rank IS NOT NULL
        ORDER BY ${orderClause}
        LIMIT $1 OFFSET $2
      `, [limit, offset]);

      const countResult = await db.query(
        `SELECT COUNT(*) FROM users WHERE (${TW} + ${TL}) > 0 OR COALESCE(tierbot_rating, 0) > 0 OR tierbot_rank IS NOT NULL`
      );

      return res.json({
        players:    result.rows,
        total:      parseInt(countResult.rows[0].count),
        page,
        totalPages: Math.ceil(parseInt(countResult.rows[0].count) / limit),
      });
    } catch (err) { console.error(err); }
  }
  res.json({ players: [], total: 0, page: 1, totalPages: 0 });
});

// TierBot rank export/API-аас тоглогчдын rank өгөгдөл татаж users хүснэгтэд оруулна.
// Admin эрхтэй хэрэглэгч л ажиллуулна.
// Автомат sync-ийн төлөв + гараар шууд ажиллуулах (админ самбар)
router.get('/tierbot/auto', admin, (req, res) => {
  const { state } = require('../services/tierSync');
  res.json({ configured: !!process.env.TIERBOT_STATS_URL, url: process.env.TIERBOT_STATS_URL || null, minutes: Number(process.env.TIERBOT_SYNC_MINUTES ?? 10), ...state });
});
router.post('/tierbot/auto/run', admin, async (req, res) => {
  const { runOnce } = require('../services/tierSync');
  res.json(await runOnce('manual'));
});

router.post('/tierbot/sync', admin, async (req, res) => {
  if (!await dbAvailable()) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }

  try {
    await ensureTierBotColumns();

    let payload = null;
    let source = 'request-body';
    if (Array.isArray(req.body?.players)) {
      payload = req.body.players;
    } else {
      let url = null;
      try {
        url = tierBotSourceUrl(req.body?.source_url);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      if (!url) {
        return res.status(400).json({
          error: 'TierBot source URL эсвэл players export JSON шаардлагатай',
        });
      }
      const { data } = await axios.get(url, {
        headers: tierBotHeaders(),
        timeout: 15000,
        maxContentLength: 5 * 1024 * 1024,
      });
      payload = data;
      source = req.body?.source_url ? 'request-url' : 'server-env';
    }

    const rows = extractTierBotRows(payload);
    if (!rows.length) {
      return res.status(400).json({ error: 'TierBot дата дотор тоглогчийн жагсаалт олдсонгүй' });
    }

    const stats = { imported: 0, created: 0, updated: 0, skipped: 0 };
    for (const [index, row] of rows.entries()) {
      const player = normalizeTierBotPlayer(row, index);
      if (!player) {
        stats.skipped++;
        continue;
      }
      const outcome = await upsertTierBotPlayer(player);
      stats.imported++;
      stats[outcome]++;
    }

    res.json({
      ok: true,
      source,
      totalRows: rows.length,
      ...stats,
    });
  } catch (err) {
    console.error('[TierBot Sync]', err.message);
    res.status(500).json({ error: `TierBot sync алдаа: ${err.message}` });
  }
});

// Replay parse хийсний дараа үр дүн хадгалах (өрөөний гишүүн)
router.post('/result', auth, perUser('result', 30, 60 * 60 * 1000), async (req, res) => {
  const { room_id, winner_team, duration_minutes, replay_path, players, fogclick } = req.body;

  if (!await dbAvailable()) {
    return res.status(503).json({ error: 'Service temporarily unavailable' });
  }
  if (!room_id) {
    return res.status(400).json({ error: 'room_id is required' });
  }
  if (!winner_team || !Array.isArray(players) || players.length === 0) {
    return res.status(400).json({ error: 'Мэдээлэл дутуу байна' });
  }
  if (![1, 2].includes(Number(winner_team))) {
    return res.status(400).json({ error: 'winner_team 1 эсвэл 2 байх ёстой' });
  }

  try {
    const membership = await db.query(
      'SELECT 1 FROM room_players WHERE room_id=$1 AND user_id=$2',
      [room_id, req.user.id]
    );
    if (!membership.rows[0]) {
      return res.status(403).json({ error: 'Энэ өрөөний гишүүн биш байна' });
    }

    const room = await db.query('SELECT host_id, status FROM rooms WHERE id=$1', [room_id]);
    if (!room.rows[0]) {
      return res.status(404).json({ error: 'Өрөө олдсонгүй' });
    }
    if (String(room.rows[0].host_id) !== String(req.user.id)) {
      return res.status(403).json({ error: 'Зөвхөн host үр дүн бүртгэнэ' });
    }
    if (room.rows[0].status !== 'playing') {
      // Бот хостын дүн (эсвэл өөр replay) аль хэдийн бүртгэгдэж өрөө 'waiting' болсон байж болно —
      // тэр тохиолдолд 400 биш duplicate (200) буцаана, клиент алдаа харуулахгүй.
      const recent = await db.query(
        `SELECT id FROM game_results WHERE room_id = $1 AND played_at > NOW() - INTERVAL '10 minutes' ORDER BY id DESC LIMIT 1`, [room_id]
      );
      if (recent.rows[0]) return res.json({ message: 'Үр дүн аль хэдийн бүртгэгдсэн', result: recent.rows[0], duplicate: true });
      return res.status(400).json({ error: 'Тоглолт эхлээгүй эсвэл аль хэдийн дууссан байна' });
    }

    // Давхар дүнгийн шалгалт services/results.js дотор (12 цаг / 10 минутын цонх) — өрөөг дахин
    // ашиглахад (нэг өрөөнд олон тоглолт) хуучин "өрөөнд нэг л дүн" хориг саад болохгүй.
    const membersResult = await db.query(
      `SELECT u.id, u.username, u.discord_id
       FROM room_players rp
       JOIN users u ON u.id = rp.user_id
       WHERE rp.room_id = $1`,
      [room_id]
    );
    const roomMembers = membersResult.rows;
    const roomMemberIds = new Set(roomMembers.map((member) => String(member.id)));

    const resolvedPlayers = players.map((player) => {
      let matchedUserId = null;

      if (player.user_id !== undefined && player.user_id !== null && player.user_id !== '') {
        const providedId = String(player.user_id);
        if (!roomMemberIds.has(providedId)) {
          throw new Error(`player-not-in-room:${providedId}`);
        }
        matchedUserId = Number(providedId);
      } else if (player.discord_id && typeof player.discord_id === 'string') {
        const matchedMember = roomMembers.find((member) => member.discord_id === player.discord_id);
        matchedUserId = matchedMember ? memberIdToNumber(matchedMember.id) : null;
      } else if (player.name && typeof player.name === 'string') {
        const targetName = player.name.trim().toLowerCase();
        const matchedMember = roomMembers.find((member) => String(member.username || '').trim().toLowerCase() === targetName);
        matchedUserId = matchedMember ? memberIdToNumber(matchedMember.id) : null;
      }

      return {
        ...player,
        user_id: matchedUserId,
      };
    });

    // Үр дүн хадгалах — services/results.js (game_results, game_players K/D/A, wins/losses, XP/Level, Diamond бонус)
    const saved = await recordGameResult({
      roomId: room_id, winnerTeam: Number(winner_team), durationMinutes: duration_minutes, replayPath: replay_path,
      players: resolvedPlayers, source: 'replay',
      fogclick: Array.isArray(fogclick) ? fogclick.slice(0, 24) : [],
    });
    if (saved.duplicate) {
      return res.json({ message: 'Үр дүн аль хэдийн бүртгэгдсэн', result: saved.result, duplicate: true });
    }
    const resultRow = { rows: [saved.result] };

    // RZR Bot-д мэдэгдэх (оноо шинэчлэх + Discord нийтлэх)
    await notifyRZRBot({ winner_team, duration_minutes, players });

    res.status(201).json({
      message: 'Үр дүн хадгалагдлаа',
      result: resultRow.rows[0],
    });
  } catch (err) {
    if (String(err.message || '').startsWith('player-not-in-room:')) {
      return res.status(400).json({ error: 'Submitted player does not belong to the room' });
    }
    console.error(err);
    res.status(500).json({ error: 'Серверийн алдаа' });
  }
});

function memberIdToNumber(id) {
  const parsed = Number(id);
  return Number.isFinite(parsed) ? parsed : null;
}

module.exports = router;
module.exports.tierBotHelpers = { ensureTierBotColumns, extractTierBotRows, normalizeTierBotPlayer, upsertTierBotPlayer, tierBotSourceUrl, tierBotHeaders };
