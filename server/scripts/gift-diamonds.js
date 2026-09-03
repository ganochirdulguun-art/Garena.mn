#!/usr/bin/env node
/**
 * Өнөөдөр платформ дээр тоглосон хэрэглэгчдэд нэг удаагийн 💎 бэлэг олгоно (эзний шийдвэрээр).
 *
 *   node scripts/gift-diamonds.js                 # DRY RUN — зөвхөн жагсаалт харуулна
 *   node scripts/gift-diamonds.js --apply         # бодитоор олгоно
 *   node scripts/gift-diamonds.js --amount 800 --date 2026-09-03 --apply
 *
 * "Тоглосон" гэдгийг ГУРВАН эх сурвалжаар тодорхойлно (аль нэгэнд нь байвал тоологдоно):
 *   1) game_players  — relay-ээр бүртгэгдсэн тоглолтын оролцогчид
 *   2) lan_games     — тухайн өдөр LAN тоглоом НЭЭСЭН хост
 *   3) lan_game_players — тэр LAN тоглоомд WC3 нэрээ бүртгэн НЭГДСЭН тоглогчид
 * (3-т бүртгэгдсэн боловч тоглолт нь дуусаагүй байгаа хүн ч ордог — эзний шийдвэр 2026-09-03.)
 *
 * ДАВХАР БЭЛГЭЭС хамгаална:
 *   • Эзэн (OWNER_USER_IDS) өөрийн акаунтаас transfer хийсэн хүмүүсийг алгасана (--since-days, default 3)
 *   • Batch ref (gift:<date>:<amount>) давтагдвал дахин олгохгүй — script-ийг олон удаа ажиллуулж болно
 *   • Эзэн өөрөө болон баннтай хэрэглэгч жагсаалтад орохгүй
 */
const { Pool } = require('pg');

const args = process.argv.slice(2);
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const APPLY = args.includes('--apply');
const AMOUNT = parseInt(flag('amount', '800'), 10);
const SINCE_DAYS = parseInt(flag('since-days', '3'), 10);
const MN_OFFSET_H = 8;

// Монголын өдрийн эхлэл (UTC+8) → UTC. DB-ийн TIMESTAMP багана UTC-ээр хадгалагддаг.
const dateArg = flag('date');
const nowMn = new Date(Date.now() + MN_OFFSET_H * 3600e3);
const dayMn = dateArg || nowMn.toISOString().slice(0, 10);
const dayStartUtc = new Date(`${dayMn}T00:00:00.000Z`).getTime() - MN_OFFSET_H * 3600e3;
const START = new Date(dayStartUtc).toISOString();
const END = new Date(dayStartUtc + 24 * 3600e3).toISOString();
const REF = `gift:${dayMn}:${AMOUNT}`;
const NOTE = `Garena.mn бэлэг — ${dayMn}-нд платформ дээр тоглосонд`;

const envOwnerIds = String(process.env.OWNER_USER_IDS || '')
  .split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isInteger);
const adminDiscordIds = String(process.env.ADMIN_DISCORD_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
});

async function main() {
  // Эзэн/админ хэрэглэгчид: OWNER_USER_IDS ∪ ADMIN_DISCORD_IDS ∪ admin_whitelist
  const { rows: adminRows } = await pool.query(
    `SELECT DISTINCT u.id, u.username FROM users u
      WHERE u.id = ANY($1::int[])
         OR (u.discord_id IS NOT NULL AND u.discord_id = ANY($2::text[]))
         OR (u.discord_id IS NOT NULL AND u.discord_id IN (SELECT discord_id FROM admin_whitelist))`,
    [envOwnerIds, adminDiscordIds]
  );
  const ownerIds = adminRows.map((r) => r.id);

  const { rows: played } = await pool.query(
    `WITH src AS (
       SELECT gp.user_id, 'тоглолт'::text AS how, COALESCE(gr.duration_minutes, 0) AS mins
         FROM game_players gp JOIN game_results gr ON gr.id = gp.game_result_id
        WHERE gr.played_at >= $1 AND gr.played_at < $2 AND gp.user_id IS NOT NULL
       UNION ALL
       SELECT lg.host_user_id, 'LAN хост', 0
         FROM lan_games lg
        WHERE lg.created_at >= $1 AND lg.created_at < $2 AND lg.host_user_id IS NOT NULL
       UNION ALL
       SELECT lp.user_id, 'LAN нэгдсэн', 0
         FROM lan_game_players lp JOIN lan_games lg ON lg.token = lp.token
        WHERE lp.joined_at >= $1 AND lp.joined_at < $2 AND lp.user_id IS NOT NULL
     )
     SELECT u.id, u.username, u.wc3_name, COALESCE(u.diamonds, 0) AS diamonds, COALESCE(u.banned, FALSE) AS banned,
            SUM(src.mins)::int AS recorded_minutes,
            COUNT(*) FILTER (WHERE src.how = 'тоглолт')::int AS games,
            STRING_AGG(DISTINCT src.how, ', ') AS sources
       FROM src JOIN users u ON u.id = src.user_id
      GROUP BY u.id
      ORDER BY u.id`,
    [START, END]
  );

  // Эзэн өөрийн акаунтаас гараар бэлэглэсэн хүмүүс (сүүлийн SINCE_DAYS хоног).
  // ref формат: tx:<ts36>-<илгээгч>-<хүлээн авагч> → хүлээн авагчийн transfer_in мөрөөр олно.
  // ЗӨВХӨН энэ өдрийн (МН) ЭЕРЭГ бэлгүүд — хасалт (сөрөг admin_grant) бэлэг биш;
  // өмнөх өдрүүдийн бэлэг ч энэ багцад хамаарахгүй.
  const gifted = new Map();
  {
    const { rows } = await pool.query(
      `SELECT user_id, amount, created_at, ref, note, type
         FROM diamond_transactions
        WHERE created_at >= $1 AND created_at < $2 AND amount > 0
          AND ( (type = 'transfer_in' AND split_part(ref, '-', 2) = ANY($3::text[]))
             OR type = 'admin_grant' )
        ORDER BY created_at`,
      [START, END, ownerIds.map(String)]
    );
    rows.forEach((r) => gifted.set(r.user_id, r));
  }
  const skipIds = new Set(String(flag('skip', '')).split(',').map((s) => parseInt(s, 10)).filter(Number.isInteger));

  const { rows: already } = await pool.query(
    'SELECT user_id FROM diamond_transactions WHERE ref = $1', [REF]
  );
  const done = new Set(already.map((r) => r.user_id));

  const skipOwner = [], skipGifted = [], skipDone = [], skipBanned = [], skipManual = [], targets = [];
  for (const p of played) {
    if (ownerIds.includes(p.id)) skipOwner.push(p);
    else if (p.banned) skipBanned.push(p);
    else if (skipIds.has(p.id)) skipManual.push(p);
    else if (done.has(p.id)) skipDone.push(p);
    else if (gifted.has(p.id)) skipGifted.push(p);
    else targets.push(p);
  }
  // Нэг хүн хоёр акаунтаар (ижил нэр) орсон эсэх — давхар бэлгийн эрсдэл
  const byName = new Map();
  played.forEach((p) => {
    const k = (p.username || '').trim().toLowerCase();
    byName.set(k, [...(byName.get(k) || []), p]);
  });
  const dupNames = [...byName.values()].filter((v) => v.length > 1);

  const line = (p, extra = '') => `  #${String(p.id).padStart(4)} ${(p.username || '?').padEnd(22)} ` +
    `${(p.wc3_name || '—').padEnd(16)} ${String(p.diamonds).padStart(6)}💎  ${p.sources}${extra}`;

  console.log(`\n=== ${dayMn} (МН цагаар) · ${AMOUNT}💎 бэлэг · ${APPLY ? 'ОЛГОНО' : 'ЗӨВХӨН ЖАГСААЛТ (dry run)'} ===`);
  console.log(`Цонх: ${START} → ${END} (UTC) · ref=${REF}`);
  console.log(`Эзэн/админ: ${adminRows.map((r) => `${r.username}#${r.id}`).join(', ') || '—'}`);

  // Сүүлийн SINCE_DAYS хоногийн БҮХ гар бэлэг (ил тод байлгах үүднээс)
  const { rows: recentGifts } = await pool.query(
    `SELECT t.user_id, u.username, t.amount, t.type, t.note, t.created_at
       FROM diamond_transactions t LEFT JOIN users u ON u.id = t.user_id
      WHERE t.created_at >= NOW() - ($1 || ' days')::interval
        AND t.type IN ('transfer_in', 'admin_grant')
      ORDER BY t.created_at`, [String(SINCE_DAYS)]
  );
  console.log(`\nСүүлийн ${SINCE_DAYS} хоногийн гар бэлгүүд (${recentGifts.length}):`);
  recentGifts.forEach((g) => console.log(
    `  ${String(g.created_at).slice(0, 16)}  ${(g.username || '?').padEnd(20)} +${g.amount}💎 ${g.type}  ${(g.note || '').slice(0, 60)}`));
  console.log('');
  console.log(`Өнөөдөр тоглосон: ${played.length} хүн\n`);
  console.log(`✅ БЭЛЭГ АВАХ (${targets.length}):`);
  targets.forEach((p) => console.log(line(p)));
  if (skipGifted.length) {
    console.log(`\n⏭️  Эзнээс аль хэдийн бэлэг авсан — алгаслаа (${skipGifted.length}):`);
    skipGifted.forEach((p) => console.log(line(p, `  ← ${gifted.get(p.id).amount}💎 ${String(gifted.get(p.id).created_at).slice(0, 16)}`)));
  }
  if (skipDone.length) {
    console.log(`\n⏭️  Энэ багцын бэлгийг аль хэдийн авсан (${skipDone.length}):`);
    skipDone.forEach((p) => console.log(line(p)));
  }
  if (skipBanned.length) {
    console.log(`\n🚫 Баннтай (${skipBanned.length}):`);
    skipBanned.forEach((p) => console.log(line(p)));
  }
  if (skipManual.length) {
    console.log(`\n⏭️  Гараар хассан --skip (${skipManual.length}):`);
    skipManual.forEach((p) => console.log(line(p)));
  }
  if (skipOwner.length) console.log(`\nℹ️  Эзэн өөрөө (${skipOwner.map((p) => p.username).join(', ')}) — алгаслаа`);
  if (dupNames.length) {
    console.log(`\n⚠️  ИЖИЛ НЭРТЭЙ ОЛОН АКАУНТ (нэг хүн байж магадгүй — шалгана уу):`);
    dupNames.forEach((v) => console.log(`  ${v[0].username}: ` +
      v.map((p) => `#${p.id} (${p.diamonds}💎${gifted.has(p.id) ? ', өнөөдөр бэлэг авсан' : ''})`).join('  ·  ')));
  }

  if (!APPLY) {
    console.log(`\nDRY RUN. Олгохын тулд: node scripts/gift-diamonds.js --amount ${AMOUNT} --date ${dayMn} --apply`);
    console.log(`Нийт олгох дүн: ${targets.length} × ${AMOUNT} = ${targets.length * AMOUNT}💎\n`);
    return;
  }

  let ok = 0;
  for (const p of targets) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const dup = await client.query('SELECT 1 FROM diamond_transactions WHERE ref = $1 AND user_id = $2', [REF, p.id]);
      if (dup.rows[0]) { await client.query('ROLLBACK'); continue; }
      const upd = await client.query(
        'UPDATE users SET diamonds = GREATEST(0, COALESCE(diamonds, 0) + $1) WHERE id = $2 RETURNING diamonds', [AMOUNT, p.id]
      );
      await client.query(
        `INSERT INTO diamond_transactions (user_id, amount, type, ref, note) VALUES ($1, $2, 'admin_grant', $3, $4)`,
        [p.id, AMOUNT, REF, NOTE]
      );
      await client.query('COMMIT');
      ok += 1;
      console.log(`  +${AMOUNT}💎 #${p.id} ${p.username} → ${upd.rows[0].diamonds}💎`);
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      console.error(`  ‼️ #${p.id} ${p.username}: ${e.message}`);
    } finally {
      client.release();
    }
  }
  console.log(`\nДууслаа: ${ok}/${targets.length} хүнд ${AMOUNT}💎 (нийт ${ok * AMOUNT}💎)\n`);
}

main().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
