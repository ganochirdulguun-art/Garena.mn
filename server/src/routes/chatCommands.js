// ── Room чатын командууд (2026-10-03, эзэн): !rank, !ping ──
//   !rank [Нэр]  — миний LAN тоглоомын (хост + нэгдсэн) тоглогчдын хожил / хожигдол / leaver · Tier; нэр өгвөл тэр хүнийх
//   !ping        — ижил тоглогчдын relay ping (мс)
// Хариу өрөөний бүх хүнд системийн мессежээр очно. Нэг хүн 10 секундэд 1 команд. Тоглоомын замыг хөндөхгүй (зөвхөн чат).
const COOLDOWN_MS = 10000;
const lastAt = new Map();   // userId -> ms

function parse(text) {
  const m = /^!(rank|ping)(?:\s+(.{1,40}))?\s*$/i.exec(String(text || '').trim());
  return m ? { cmd: m[1].toLowerCase(), arg: (m[2] || '').trim() } : null;
}
function onCooldown(userId, now = Date.now()) {
  const t = lastAt.get(String(userId)) || 0;
  if (t && now - t < COOLDOWN_MS) return true;
  lastAt.set(String(userId), now);
  if (lastAt.size > 5000) lastAt.delete(lastAt.keys().next().value);
  return false;
}
const n = (v) => Number(v) || 0;
function rankText(rows) {
  if (!rows.length) return '📊 !rank — тоглогч олдсонгүй';
  return '📊 ' + rows.map((u) => `${u.username}: Win-${n(u.wins)} Loss-${n(u.losses)} Leaver-${n(u.leavers)}${u.tierbot_tier ? ` Tier-${u.tierbot_tier}` : ''}`).join('  |  ');
}
function pingText(rows, rttOf) {
  if (!rows.length) return '📡 !ping — тоглогч олдсонгүй';
  return '📡 ' + rows.map((u) => { const r = rttOf(u.id); return `${u.username}: ${r == null ? '—' : r + 'мс'}`; }).join('  |  ');
}

/** Хэрэглэгчийн LAN тоглоом (хост эсвэл нэгдсэн) дахь бүх тоглогчийн user_id. games = lanhost.gamesIn(roomId); db шаардлагатай. */
async function lanPlayerIds(db, games, userId) {
  const uid = String(userId);
  const toks = games.map((g) => g.token);
  let joiners = [];
  if (toks.length && db) {
    try { joiners = (await db.query('SELECT token, user_id FROM lan_game_players WHERE token = ANY($1::text[])', [toks])).rows; } catch {}
  }
  const mine = games.find((g) => String(g.host_user_id) === uid) || games.find((g) => joiners.some((j) => j.token === g.token && String(j.user_id) === uid));
  if (!mine) return [];
  const ids = new Set();
  if (mine.host_user_id != null) ids.add(String(mine.host_user_id));
  for (const j of joiners) if (j.token === mine.token && j.user_id != null) ids.add(String(j.user_id));
  return [...ids].map(Number).filter(Number.isInteger);
}
async function statsFor(db, ids) {
  if (!ids.length || !db) return [];
  const r = await db.query(
    `SELECT u.id, u.username, u.tierbot_tier, u.level,
            (COALESCE(u.wins,0) + COALESCE(u.platform_wins,0))::int AS wins,
            (COALESCE(u.losses,0) + COALESCE(u.platform_losses,0))::int AS losses,
            (SELECT COUNT(*)::int FROM game_players gp WHERE gp.user_id = u.id AND gp.is_leaver) AS leavers
       FROM users u WHERE u.id = ANY($1::int[])`, [ids]);
  const order = new Map(ids.map((id, i) => [String(id), i]));
  return r.rows.sort((a, b) => (order.get(String(a.id)) ?? 0) - (order.get(String(b.id)) ?? 0));
}
async function findUserByName(db, name) {
  if (!db || !name) return null;
  const r = await db.query('SELECT id FROM users WHERE LOWER(username) = LOWER($1) OR LOWER(COALESCE(wc3_name, \'\')) = LOWER($1) ORDER BY id LIMIT 1', [name]);
  return r.rows[0]?.id ?? null;
}

/**
 * Командыг боловсруулж хариу текст буцаана (null = команд биш / cooldown).
 * deps: { db, games (lanhost.gamesIn(roomId)), rttOf(userId) → мс|null }
 */
async function handle({ userId, text, db, games, rttOf }) {
  const p = parse(text);
  if (!p) return null;
  if (onCooldown(userId)) return null;
  let ids;
  if (p.arg) {
    const id = await findUserByName(db, p.arg);
    if (id == null) return `«${p.arg}» нэртэй тоглогч олдсонгүй`;
    ids = [id];
  } else {
    ids = await lanPlayerIds(db, games || [], userId);
    if (!ids.length) return 'Та одоо LAN тоглоомд ороогүй байна — «!rank Нэр» / «!ping Нэр» гэж бичнэ үү';
  }
  const rows = await statsFor(db, ids);
  return p.cmd === 'rank' ? rankText(rows) : pingText(rows, rttOf || (() => null));
}

module.exports = { handle, parse, rankText, pingText, lanPlayerIds, statsFor, onCooldown, COOLDOWN_MS, _lastAt: lastAt };
