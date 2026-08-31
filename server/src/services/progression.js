// ── XP / Level / Diamond 💎 — тоглолтын дүнгээс олгох дүрэм ──
// Хэрэглэгчийн шийдвэр (2026-08-22): 10 тоглолт тутамд ≥5 хожвол +30 💎.
// XP: хожил +40, хожигдол +10, leaver −30 (0-оос доош орохгүй), kill +1 / assist +0.5 (нийт +30 хүртэл).
// Level n-д хүрэх XP = 100 · n^1.5 (L5 ≈ 1,118; L10 ≈ 3,162; L20 ≈ 8,944).

const RULES = {
  XP_WIN: 40,
  XP_LOSS: 10,
  XP_LEAVER: -30,
  XP_PER_KILL: 1,
  XP_PER_ASSIST: 0.5,
  XP_KDA_CAP: 30,
  MIN_GAME_MINUTES: 8,          // үүнээс богино тоглолт = remake, XP/блок тоологдохгүй
  BLOCK_SIZE: 10,
  BLOCK_MIN_WINS: 5,
  BLOCK_BONUS_DIAMONDS: 30,
  LEAVER_BEFORE_SEC: 10 * 60,   // 10 минутаас өмнө гарсан = leaver (W3MMD/ботын leaver туг байхгүй үед)
};

function xpForLevel(n) {
  return Math.round(100 * Math.pow(Math.max(1, n), 1.5));
}
function levelFromXp(xp) {
  let lvl = 1;
  while (xp >= xpForLevel(lvl + 1) && lvl < 999) lvl += 1;
  return lvl;
}
function levelProgress(xp) {
  const level = levelFromXp(xp);
  const cur = xpForLevel(level);
  const next = xpForLevel(level + 1);
  return { level, xp, next_level_xp: next, progress: Math.max(0, Math.min(1, (xp - cur) / Math.max(1, next - cur))) };
}

function xpFor({ isWinner, isLeaver, kills = 0, assists = 0 }) {
  if (isLeaver) return RULES.XP_LEAVER;
  const base = isWinner ? RULES.XP_WIN : RULES.XP_LOSS;
  // kills/assists сөрөг байж болзошгүй (хост/replay-с ирсэн итгэлгүй өгөгдөл) —
  // KDA бонусыг 0..CAP мужид барина. Ингэснээр сөрөг тоо XP-г хасахгүй.
  const k = Math.max(0, Number(kills) || 0);
  const a = Math.max(0, Number(assists) || 0);
  const kda = Math.max(0, Math.min(RULES.XP_KDA_CAP, Math.round(k * RULES.XP_PER_KILL + a * RULES.XP_PER_ASSIST)));
  return base + kda;
}

/**
 * Нэг тоглогчид тоглолтын дүнг олгоно (XP, Level, 10 тоглолтын Diamond бонус).
 * client = pg client/pool. counted=false бол (remake) зөвхөн бичлэг үлдээнэ.
 * Буцаана: { xp_earned, diamonds_earned, level, xp, block_games, block_wins }
 */
async function awardGameOutcome(client, { userId, isWinner, isLeaver = false, kills = 0, assists = 0, durationMinutes = 0, ref = null }) {
  const counted = Number(durationMinutes || 0) >= RULES.MIN_GAME_MINUTES;
  if (!counted) {
    const r = await client.query('SELECT xp, level, block_games, block_wins FROM users WHERE id = $1', [userId]);
    return { xp_earned: 0, diamonds_earned: 0, counted: false, ...(r.rows[0] || {}) };
  }
  const xpEarned = xpFor({ isWinner, isLeaver, kills, assists });
  // XP + блокын тоолуур (leaver хожил биш)
  const upd = await client.query(
    `UPDATE users
       SET xp = GREATEST(0, COALESCE(xp, 0) + $1),
           block_games = COALESCE(block_games, 0) + 1,
           block_wins  = COALESCE(block_wins, 0) + $2
     WHERE id = $3
     RETURNING xp, block_games, block_wins, diamonds`,
    [xpEarned, isWinner && !isLeaver ? 1 : 0, userId]
  );
  const row = upd.rows[0];
  if (!row) return { xp_earned: 0, diamonds_earned: 0, counted: false };

  let diamondsEarned = 0;
  let blockGames = row.block_games;
  let blockWins = row.block_wins;
  if (blockGames >= RULES.BLOCK_SIZE) {
    if (blockWins >= RULES.BLOCK_MIN_WINS) {
      diamondsEarned = RULES.BLOCK_BONUS_DIAMONDS;
      await client.query('UPDATE users SET diamonds = COALESCE(diamonds, 0) + $1 WHERE id = $2', [diamondsEarned, userId]);
      await client.query(
        `INSERT INTO diamond_transactions (user_id, amount, type, ref, note) VALUES ($1, $2, 'block_bonus', $3, $4)`,
        [userId, diamondsEarned, ref, `${RULES.BLOCK_SIZE} тоглолтоос ${blockWins} хожил — бонус`]
      );
    }
    await client.query('UPDATE users SET block_games = 0, block_wins = 0 WHERE id = $1', [userId]);
    blockGames = 0; blockWins = 0;
  }
  const level = levelFromXp(row.xp);
  await client.query('UPDATE users SET level = $1 WHERE id = $2', [level, userId]);
  return { xp_earned: xpEarned, diamonds_earned: diamondsEarned, counted: true, xp: row.xp, level, block_games: blockGames, block_wins: blockWins };
}

module.exports = { RULES, xpForLevel, levelFromXp, levelProgress, xpFor, awardGameOutcome };
