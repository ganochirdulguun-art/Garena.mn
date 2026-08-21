// ── Тоглолтын дүн бүртгэх (replay болон бот хоёулаа энд ирнэ) ──
// game_results + game_players бичиж, wins/losses, XP/Level, Diamond бонус олгоно. Нэг өрөөнд нэг л дүн (idempotent).
const { awardGameOutcome, RULES } = require('./progression');

let db;
try { db = require('../config/db'); } catch { db = null; }

function toInt(v, d = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }

/**
 * players: [{ user_id?, name?, discord_id?, team (1|2), kills?, deaths?, assists?, hero?, left_at_sec?, is_leaver? }]
 * Тоглогчийг өрөөний гишүүдтэй user_id → discord_id → нэр(WC3 нэр ≈ username)-ээр тааруулна.
 */
async function recordGameResult({
  roomId, winnerTeam, durationMinutes = 0, replayPath = null, players = [],
  source = 'replay', botJobId = null, mapName = null, gameName = null,
}) {
  if (!db) throw new Error('db unavailable');
  if (![1, 2].includes(Number(winnerTeam))) throw new Error('winner_team 1 эсвэл 2 байх ёстой');

  const existing = await db.query('SELECT id FROM game_results WHERE room_id = $1 AND played_at > NOW() - INTERVAL \'12 hours\' ORDER BY id DESC LIMIT 1', [roomId]);
  const roomStatus = await db.query('SELECT status FROM rooms WHERE id = $1', [roomId]);
  // Өрөө 'playing' биш байхад давхар бүртгэхгүй (replay watcher хожуу ирсэн гэх мэт)
  if (existing.rows[0] && roomStatus.rows[0]?.status !== 'playing') {
    return { duplicate: true, result: existing.rows[0] };
  }

  const membersResult = await db.query(
    `SELECT u.id, u.username, u.discord_id, rp.team AS room_team
     FROM room_players rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = $1`,
    [roomId]
  );
  const members = membersResult.rows;
  const norm = (s) => String(s || '').trim().toLowerCase();

  const resolved = players.map((p) => {
    let userId = null;
    if (p.user_id !== undefined && p.user_id !== null && p.user_id !== '') {
      const m = members.find((x) => String(x.id) === String(p.user_id));
      if (!m) throw new Error(`player-not-in-room:${p.user_id}`);
      userId = m.id;
    } else if (p.discord_id) {
      userId = members.find((x) => x.discord_id === p.discord_id)?.id || null;
    } else if (p.name) {
      const n = norm(p.name);
      userId = members.find((x) => norm(x.username) === n)?.id
        || members.find((x) => norm(x.username) && (n.includes(norm(x.username)) || norm(x.username).includes(n)))?.id
        || null;
    }
    const team = toInt(p.team, 0);
    const leftAt = p.left_at_sec != null ? toInt(p.left_at_sec, null) : null;
    const isLeaver = p.is_leaver === true
      || (leftAt != null && leftAt < RULES.LEAVER_BEFORE_SEC && leftAt < toInt(durationMinutes, 0) * 60 - 60);
    return {
      user_id: userId, wc3_name: p.name || null, team,
      kills: toInt(p.kills), deaths: toInt(p.deaths), assists: toInt(p.assists),
      hero: p.hero ? String(p.hero).slice(0, 64) : null, left_at_sec: leftAt, is_leaver: isLeaver,
    };
  });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const rr = await client.query(
      `INSERT INTO game_results (room_id, winner_team, duration_minutes, replay_path, source, bot_job_id, map_name, game_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [roomId, winnerTeam, toInt(durationMinutes), replayPath, source, botJobId, mapName, gameName]
    );
    const result = rr.rows[0];
    const awards = [];
    for (const p of resolved) {
      const isWinner = p.team === Number(winnerTeam) && !p.is_leaver;
      let award = { xp_earned: 0, diamonds_earned: 0 };
      if (p.user_id) {
        const col = isWinner ? 'wins' : 'losses';
        if (toInt(durationMinutes) >= RULES.MIN_GAME_MINUTES) {
          await client.query(`UPDATE users SET ${col} = ${col} + 1 WHERE id = $1`, [p.user_id]);
        }
        award = await awardGameOutcome(client, {
          userId: p.user_id, isWinner, isLeaver: p.is_leaver, kills: p.kills, assists: p.assists,
          durationMinutes, ref: `game:${result.id}`,
        });
        await client.query(
          `INSERT INTO game_players (game_result_id, user_id, team, is_winner, kills, deaths, assists, hero, left_at_sec, is_leaver, xp_earned, diamonds_earned, wc3_name)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT DO NOTHING`,
          [result.id, p.user_id, p.team, isWinner, p.kills, p.deaths, p.assists, p.hero, p.left_at_sec, p.is_leaver, award.xp_earned || 0, award.diamonds_earned || 0, p.wc3_name]
        );
      }
      awards.push({ ...p, is_winner: isWinner, ...award });
    }
    await client.query(`UPDATE rooms SET status = 'done' WHERE id = $1`, [roomId]);
    await client.query('COMMIT');
    return { duplicate: false, result, players: awards };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { recordGameResult };
