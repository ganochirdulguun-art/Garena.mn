// ── Тоглолтын дүн бүртгэх (replay болон бот хоёулаа энд ирнэ) ──
// game_results + game_players бичиж, wins/losses, XP/Level, Diamond бонус олгоно. Нэг тоглолтод нэг л дүн (10 минутын цонх, idempotent).
const { awardGameOutcome, RULES } = require('./progression');

let db;
try { db = require('../config/db'); } catch { db = null; }

function toInt(v, d = 0) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
// Итгэлгүй тоглогчийн статистикийг 0..cap мужид барих (сөрөг/утгагүй өгөгдлөөс хамгаална)
function clampStat(v) { return Math.max(0, Math.min(10000, toInt(v, 0))); }

/**
 * players: [{ user_id?, name?, ip?, discord_id?, team (1|2), kills?, deaths?, assists?, hero?, left_at_sec?, is_leaver? }]
 * Тоглогчийг өрөөний гишүүдтэй user_id → discord_id → ботын ажилд бүртгүүлсэн WC3 нэр → (давхцахгүй) нийтийн IP
 * → users.wc3_name → username(яг/хэсэгчилсэн)-ээр тааруулна. WC3 нэр нь платформын нэрээс ихэвчлэн өөр байдаг.
 */
async function recordGameResult({
  roomId, winnerTeam, durationMinutes = 0, replayPath = null, players = [],
  source = 'replay', botJobId = null, mapName = null, gameName = null,
  fogclick = [],
}) {
  if (!db) throw new Error('db unavailable');
  if (![1, 2].includes(Number(winnerTeam))) throw new Error('winner_team 1 эсвэл 2 байх ёстой');

  const membersResult = await db.query(
    `SELECT u.id, u.username, u.discord_id, u.wc3_name, rp.team AS room_team
     FROM room_players rp JOIN users u ON u.id = rp.user_id WHERE rp.room_id = $1`,
    [roomId]
  );
  const members = membersResult.rows;
  const norm = (s) => String(s || '').trim().toLowerCase();
  const normIp = (s) => String(s || '').replace(/^::ffff:/, '').trim();

  // Ботын ажилд "WC3 нээж нэгдэх" дарсан гишүүд (WC3 нэр + нийтийн IP)
  let joins = [];
  if (botJobId) {
    const jr = await db.query('SELECT user_id, wc3_name, ip FROM bot_job_players WHERE job_id = $1', [botJobId]).catch(() => ({ rows: [] }));
    joins = (jr.rows || []).filter((j) => members.some((m) => String(m.id) === String(j.user_id)));
  }
  const used = new Set();
  const take = (id) => { if (id == null || used.has(String(id))) return null; used.add(String(id)); return id; };

  const resolved = players.map((p) => {
    let userId = null;
    if (p.user_id !== undefined && p.user_id !== null && p.user_id !== '') {
      const m = members.find((x) => String(x.id) === String(p.user_id));
      if (!m) throw new Error(`player-not-in-room:${p.user_id}`);
      userId = m.id;
    } else if (p.discord_id) {
      userId = members.find((x) => x.discord_id === p.discord_id)?.id || null;
    } else if (p.name || p.ip) {
      const n = norm(p.name);
      const ip = normIp(p.ip);
      // 1) ажилд бүртгүүлсэн WC3 нэр
      if (n) userId = take(joins.find((j) => norm(j.wc3_name) === n && !used.has(String(j.user_id)))?.user_id);
      // 2) нийтийн IP — зөвхөн тэр IP-тэй ганц гишүүн байвал (интернэт кафе: олон хүн нэг IP → нэрээр л)
      if (!userId && ip) {
        const sameIp = joins.filter((j) => normIp(j.ip) === ip && !used.has(String(j.user_id)));
        if (sameIp.length === 1) userId = take(sameIp[0].user_id);
      }
      // 3) өмнөх тоглолтуудаас сурсан users.wc3_name
      if (!userId && n) userId = take(members.find((x) => norm(x.wc3_name) === n && !used.has(String(x.id)))?.id);
      // 4) платформын нэр (яг / хэсэгчилсэн)
      if (!userId && n) {
        userId = take(members.find((x) => norm(x.username) === n && !used.has(String(x.id)))?.id)
          || take(members.find((x) => norm(x.username) && !used.has(String(x.id)) && (n.includes(norm(x.username)) || norm(x.username).includes(n)))?.id)
          || null;
      }
    }
    const team = toInt(p.team, 0);
    const leftAt = p.left_at_sec != null ? toInt(p.left_at_sec, null) : null;
    const isLeaver = p.is_leaver === true
      || (leftAt != null && leftAt < RULES.LEAVER_BEFORE_SEC && leftAt < toInt(durationMinutes, 0) * 60 - 60);
    return {
      user_id: userId, wc3_name: p.name || null, team,
      kills: clampStat(p.kills), deaths: clampStat(p.deaths), assists: clampStat(p.assists),
      hero: p.hero ? String(p.hero).slice(0, 64) : null, left_at_sec: leftAt, is_leaver: isLeaver,
      // DotA нэмэлт статистик (creep/denie/neutral/gold) — байхгүй бол 0
      creep_kills: clampStat(p.creep_kills ?? p.creepKills), creep_denies: clampStat(p.creep_denies ?? p.creepDenies),
      neutral_kills: clampStat(p.neutral_kills ?? p.neutralKills), gold: clampStat(p.gold),
    };
  });

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    // Өрөө бүрт транзакцын хугацаанд advisory lock — бот хостын дүн ба хостын replay
    // нэг тоглолтод бараг зэрэг ирдэг тул давхар бүртгэлийг (XP/💎/wins давхардал) атомоор хаана.
    const lockKey = Number.parseInt(roomId, 10);
    if (Number.isFinite(lockKey)) await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    // Lock авсны дараа транзакц дотор давхар шалгалт: (а) өрөө 'playing' биш (replay хожуу),
    // (б) сүүлийн 10 мин дотор энэ өрөөнд дүн бүртгэгдсэн бол → давхардал гэж үзнэ.
    const existing = await client.query('SELECT id, played_at, source FROM game_results WHERE room_id = $1 AND played_at > NOW() - INTERVAL \'12 hours\' ORDER BY id DESC LIMIT 1', [roomId]);
    const roomStatus = await client.query('SELECT status FROM rooms WHERE id = $1', [roomId]);
    if (existing.rows[0]) {
      const ageMs = Date.now() - new Date(existing.rows[0].played_at).getTime();
      if (roomStatus.rows[0]?.status !== 'playing' || ageMs < 10 * 60 * 1000) {
        await client.query('COMMIT');
        return { duplicate: true, result: existing.rows[0] };
      }
    }
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
        // Платформын бот-тоглолтын хож/хожигдлыг ТУСДАА баганад — wins/losses нь TierBot-ын
        // эрх мэдэгч утга бөгөөд sync-ээр дардаг (үгүй бол платформын тоглолт 10 мин тутам устана).
        const col = isWinner ? 'platform_wins' : 'platform_losses';
        if (toInt(durationMinutes) >= RULES.MIN_GAME_MINUTES) {
          await client.query(`UPDATE users SET ${col} = COALESCE(${col}, 0) + 1 WHERE id = $1`, [p.user_id]);
        }
        award = await awardGameOutcome(client, {
          userId: p.user_id, isWinner, isLeaver: p.is_leaver, kills: p.kills, assists: p.assists,
          durationMinutes, ref: `game:${result.id}`,
        });
        await client.query(
          `INSERT INTO game_players (game_result_id, user_id, team, is_winner, kills, deaths, assists, hero, left_at_sec, is_leaver, xp_earned, diamonds_earned, wc3_name, creep_kills, creep_denies, neutral_kills, gold)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING`,
          [result.id, p.user_id, p.team, isWinner, p.kills, p.deaths, p.assists, p.hero, p.left_at_sec, p.is_leaver, award.xp_earned || 0, award.diamonds_earned || 0, p.wc3_name, p.creep_kills, p.creep_denies, p.neutral_kills, p.gold]
        );
        // Дараагийн тоглолтод нэрээр шууд тааруулахын тулд WC3 нэрийг сурна
        if (p.wc3_name) {
          await client.query('UPDATE users SET wc3_name = $1 WHERE id = $2 AND (wc3_name IS NULL OR wc3_name <> $1)', [String(p.wc3_name).slice(0, 64), p.user_id]).catch(() => {});
        }
      }
      awards.push({ ...p, is_winner: isWinner, ...award });
    }
    // Өрөөг ХААХГҮЙ — 'waiting' болгоно: тоглогчид өрөөндөө үлдэж дараагийн тоглолтоо эхлүүлнэ (RGC маяг).
    // ('done' болговол /rooms жагсаалтаас алга болж, isUserInRoom false → өрөөний чат хаагддаг байсан.)
    await client.query(`UPDATE rooms SET status = 'waiting' WHERE id = $1 AND status <> 'done'`, [roomId]);
    await client.query('COMMIT');

    // FOGCLICK (maphack) илэрсэн тоглогчид — w3mhdet DLL replay чатад бичсэнийг клиент задалж
    // WC3 нэрээр дамжуулна. Нэрийг тоглолтын resolved тоглогчтой таарч, сануулга/бан + эзэнд DM.
    // Давхардсан replay энд ирэхгүй (дээр duplicate=true болж эргэсэн) тул нэг тоглолтод нэг удаа.
    if (Array.isArray(fogclick) && fogclick.length) {
      try {
        const { recordMaphackWarning } = require('../routes/anticheat');
        const seen = new Set();
        for (const fc of fogclick) {
          const nm = norm(fc && typeof fc === 'object' ? fc.name : fc);
          if (!nm) continue;
          const hit = resolved.find((p) => p.user_id && norm(p.wc3_name) === nm);
          if (hit && !seen.has(String(hit.user_id))) {
            seen.add(String(hit.user_id));
            recordMaphackWarning(hit.user_id, 'MapHack (FOGCLICK)').catch(() => {});
          }
        }
      } catch (e) { console.error('[Results] fogclick:', e.message); }
    }

    return { duplicate: false, result, players: awards };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { recordGameResult };
