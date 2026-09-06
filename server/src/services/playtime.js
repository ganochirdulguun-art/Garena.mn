// ── ⏱ Идэвхтэй тоглосон цагийн урамшуулал — XP + 💎 (эзний шийдвэр 2026-09-06) ──
// Эх сурвалж: relay capture (hostbot/reportGame.js → POST /relay/game-stats) — тоглогч бүрийн бодит тоглосон
// хугацаа (left_at_sec хүртэл, эсвэл тоглоом дуустал). Ялагчгүй дууссан тоглолт ч тоологдоно (дүнгээс тусдаа).
// Дүрэм (задаргаа хэрэглэгчид харагдана):
//   • 2 XP / идэвхтэй минут (8 минутаас богино = remake, тоологдохгүй)
//   • 🏁 дуустал тоглосон (гараагүй) бол +10 XP; 🏆 Ranked өрөө бол ×1.25
//   • 💎 1 цаг тоглох тутамд 2 💎 — минутууд тоглолтоос тоглолтод ХУРИМТЛАГДАНА (үлдэгдэл алдагдахгүй)
//   • Өдөрт (сүүлийн 24 ц) дээд тал нь 8 цаг тоологдоно (AFK/фермлэлтээс хамгаална)
// Нэг тоглолт (token) нэг тоглогчид нэг л удаа (play_awards UNIQUE) — relay давхар илгээвэл давхардахгүй.
const { levelFromXp } = require('./progression');

const RULES = {
  XP_PER_MIN: 2,
  FULL_GAME_BONUS_XP: 10,
  RANKED_MULT: 1.25,
  MIN_COUNT_SEC: 8 * 60,
  DAILY_CAP_SEC: 8 * 3600,
  DIAMONDS_PER_HOUR: 2,
  HOUR_SEC: 3600,
};

const fmtMin = (sec) => { const m = Math.round(sec / 60); return m >= 60 ? `${Math.floor(m / 60)}ц ${m % 60}м` : `${m}м`; };

// Цэвэр функц (tests/playtime.test.js): нэг тоглолтын нэг тоглогчийн тоологдох секунд + XP задаргаа
function computePlaytime({ gameSeconds, leftAtSec = null, ranked = false, todaySeconds = 0 }) {
  const total = Math.max(0, Math.floor(Number(gameSeconds) || 0));
  const stayed = leftAtSec == null || Number(leftAtSec) >= total;
  let sec = stayed ? total : Math.max(0, Math.min(total, Math.floor(Number(leftAtSec))));
  const lines = [];
  if (sec < RULES.MIN_COUNT_SEC) return { counted_sec: 0, xp: 0, stayed, capped: false, lines: [`⏱ ${fmtMin(sec)} — 8 минутаас богино (remake), тоологдохгүй`] };
  const room = Math.max(0, RULES.DAILY_CAP_SEC - Math.max(0, Number(todaySeconds) || 0));
  const capped = sec > room;
  if (capped) sec = room;
  if (sec <= 0) return { counted_sec: 0, xp: 0, stayed, capped: true, lines: ['⏱ Өдрийн 8 цагийн дээд хязгаарт хүрсэн — энэ тоглолт тоологдсонгүй'] };
  const mins = Math.floor(sec / 60);
  let xp = mins * RULES.XP_PER_MIN;
  lines.push(`⏱ ${fmtMin(sec)} идэвхтэй × ${RULES.XP_PER_MIN} XP = ${xp} XP${capped ? ' (өдрийн 8ц хязгаараар)' : ''}`);
  if (stayed) { xp += RULES.FULL_GAME_BONUS_XP; lines.push(`🏁 Дуустал тоглосон +${RULES.FULL_GAME_BONUS_XP} XP`); }
  else lines.push('🚪 Тоглоом дуусахаас өмнө гарсан — дуустал тоглосны бонус алга');
  if (ranked) { const before = xp; xp = Math.round(xp * RULES.RANKED_MULT); lines.push(`🏆 Ranked ×${RULES.RANKED_MULT} → ${before} → ${xp} XP`); }
  return { counted_sec: sec, xp, stayed, capped, lines };
}

// 💎: хуримтлагдсан нийт секундээс хэдэн 💎 өгөх ёстой вэ (өмнө өгснийг хасаад)
function diamondsDue(totalSec, paidDiamonds) {
  const earned = Math.floor(Math.max(0, totalSec) / RULES.HOUR_SEC) * RULES.DIAMONDS_PER_HOUR;
  return Math.max(0, earned - Math.max(0, paidDiamonds || 0));
}
function secToNextDiamond(totalSec) { return RULES.HOUR_SEC - (Math.max(0, totalSec) % RULES.HOUR_SEC); }

/**
 * Нэг тоглогчид нэг тоглолтын цагийн урамшуулал (транзакцтай). Давхардвал { skipped: true }.
 * Буцаана: { counted_sec, xp, diamonds, level, level_up, total_sec, next_diamond_sec, lines[] }
 */
async function awardPlaytime(db, { userId, token, gameSeconds, leftAtSec = null, ranked = false, roomId = null }) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [1_000_000 + Number(userId)]);
    const dup = await client.query('SELECT 1 FROM play_awards WHERE token = $1 AND user_id = $2', [token, userId]);
    if (dup.rows[0]) { await client.query('COMMIT'); return { skipped: true }; }
    const today = await client.query(`SELECT COALESCE(SUM(counted_sec), 0)::int AS s FROM play_awards WHERE user_id = $1 AND created_at > NOW() - INTERVAL '24 hours'`, [userId]);
    const c = computePlaytime({ gameSeconds, leftAtSec, ranked, todaySeconds: today.rows[0].s });
    const u = await client.query(
      `UPDATE users SET xp = GREATEST(0, COALESCE(xp, 0) + $1), play_seconds_total = COALESCE(play_seconds_total, 0) + $2
       WHERE id = $3 RETURNING xp, level, play_seconds_total, play_diamonds_paid`,
      [c.xp, c.counted_sec, userId]);
    const row = u.rows[0];
    if (!row) { await client.query('ROLLBACK'); return { skipped: true, reason: 'user' }; }
    const level = levelFromXp(row.xp);
    const levelUp = level > (row.level || 1);
    if (level !== row.level) await client.query('UPDATE users SET level = $1 WHERE id = $2', [level, userId]);
    const diamonds = diamondsDue(row.play_seconds_total, row.play_diamonds_paid);
    if (diamonds > 0) {
      await client.query('UPDATE users SET diamonds = COALESCE(diamonds, 0) + $1, play_diamonds_paid = COALESCE(play_diamonds_paid, 0) + $1 WHERE id = $2', [diamonds, userId]);
      await client.query(`INSERT INTO diamond_transactions (user_id, amount, type, ref, note) VALUES ($1, $2, 'playtime', $3, $4)`,
        [userId, diamonds, `game:${token.slice(0, 32)}`, `Тоглосон цаг: нийт ${fmtMin(row.play_seconds_total)} → ${RULES.DIAMONDS_PER_HOUR} 💎/цаг`]);
    }
    await client.query(`INSERT INTO play_awards (token, user_id, room_id, game_sec, counted_sec, xp, diamonds, ranked) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [token, userId, roomId, Math.floor(Number(gameSeconds) || 0), c.counted_sec, c.xp, diamonds, !!ranked]);
    await client.query('COMMIT');
    const nextSec = secToNextDiamond(row.play_seconds_total);
    const lines = [...c.lines];
    if (diamonds > 0) lines.push(`💎 +${diamonds} — нийт ${fmtMin(row.play_seconds_total)} тоглосон (${RULES.DIAMONDS_PER_HOUR} 💎/цаг)`);
    if (c.counted_sec > 0) lines.push(`⏳ Дараагийн ${RULES.DIAMONDS_PER_HOUR} 💎 хүртэл ${fmtMin(nextSec)}`);
    if (levelUp) lines.push(`🆙 Level ${level} боллоо!`);
    return { counted_sec: c.counted_sec, xp: c.xp, diamonds, level, level_up: levelUp, total_sec: row.play_seconds_total, next_diamond_sec: nextSec, lines };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally { client.release(); }
}

module.exports = { RULES, computePlaytime, diamondsDue, secToNextDiamond, awardPlaytime, fmtMin };
