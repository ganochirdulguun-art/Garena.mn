#!/usr/bin/env node
/**
 * Хэрэглэгч хайх + түүний сүүлийн үйл ажиллагаа (дэмжлэг/гомдол шалгахад). Зөвхөн УНШИНА.
 *   node scripts/find-user.js panda            # username / wc3_name / discord_username-д агуулагдах
 *   node scripts/find-user.js "#226"           # платформын id
 *   node scripts/find-user.js --recent 36      # сүүлийн 36 цагийн LAN тоглоом + relay сүлжээний тайлан (хэн ч байсан)
 */
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } });
const args = process.argv.slice(2);
const q = args.find((a) => !a.startsWith('--')) || '';
const recentIdx = args.indexOf('--recent');
const recentH = recentIdx >= 0 ? Number(args[recentIdx + 1] || 24) : null;
const fmt = (d) => (d ? new Date(d).toLocaleString('sv-SE', { timeZone: 'Asia/Ulaanbaatar' }).slice(0, 16) : '—');

async function recent(hours) {
  const { rows: games } = await pool.query(
    `SELECT lg.token, lg.room_id, lg.host_user_id, lg.host_wc3_name, lg.created_at, hu.username AS host_username,
            (SELECT STRING_AGG(COALESCE(u.username, '?') || '/' || COALESCE(lp.wc3_name, '?'), ', ' ORDER BY lp.joined_at)
               FROM lan_game_players lp LEFT JOIN users u ON u.id = lp.user_id WHERE lp.token = lg.token) AS joiners
       FROM lan_games lg LEFT JOIN users hu ON hu.id = lg.host_user_id
      WHERE lg.created_at >= NOW() - ($1 || ' hours')::interval ORDER BY lg.created_at DESC`, [String(hours)]);
  console.log(`\n=== Сүүлийн ${hours} цагийн LAN тоглоомууд (${games.length}) — МН цагаар ===`);
  games.forEach((g) => console.log(`  ${fmt(g.created_at)}  room ${g.room_id}  хост ${g.host_username || '?'}/${g.host_wc3_name || '?'}  нэгдсэн: ${g.joiners || '—'}`));
  const { rows: res } = await pool.query(
    `SELECT gr.id, gr.room_id, gr.played_at, gr.duration_minutes, gr.winner_team, gr.source, gr.net_report,
            (SELECT STRING_AGG(COALESCE(u.username, gp.wc3_name, '?') || '(' || gp.team || ')', ', ')
               FROM game_players gp LEFT JOIN users u ON u.id = gp.user_id WHERE gp.game_result_id = gr.id) AS players
       FROM game_results gr WHERE gr.played_at >= NOW() - ($1 || ' hours')::interval ORDER BY gr.played_at DESC`, [String(hours)]);
  console.log(`\n=== Бүртгэгдсэн дүн (${res.length}) ===`);
  res.forEach((r) => {
    const n = r.net_report || {};
    const lag = (n.lag || []).map((l) => `${l.name}:${l.lag_screens}×/${l.total_lag_sec}с`).join(', ') || 'lag байхгүй';
    const leaves = (n.leaves || []).map((l) => `${l.name}@${Math.round(l.at_sec / 60)}мин`).join(', ') || '—';
    console.log(`  ${fmt(r.played_at)}  room ${r.room_id}  ${r.duration_minutes}мин  ялагч ${r.winner_team}  [${r.source}]  lag: ${lag}  гарсан: ${leaves}\n      ${r.players || ''}`);
  });
}

async function find(query) {
  let where, params;
  if (/^#\d+$/.test(query)) { where = 'u.id = $1'; params = [Number(query.slice(1))]; }
  else { where = "u.username ILIKE $1 OR u.wc3_name ILIKE $1 OR u.discord_username ILIKE $1 OR u.email ILIKE $1"; params = [`%${query}%`]; }
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.discord_username, u.discord_id, u.wc3_name, u.email, u.created_at, u.membership,
            COALESCE(u.diamonds, 0) AS diamonds, u.level, u.platform_wins, u.platform_losses,
            COALESCE(u.maphack_warnings, 0) AS maphack_warnings, COALESCE(u.banned, FALSE) AS banned, u.ban_reason, u.tierbot_tier
       FROM users u WHERE ${where} ORDER BY u.id LIMIT 20`, params);
  console.log(`\n=== "${query}" — ${rows.length} хэрэглэгч ===`);
  for (const u of rows) {
    console.log(`\n#${u.id} ${u.username}  discord=${u.discord_username || '—'} (${u.discord_id || '—'})  wc3=${u.wc3_name || '—'}  email=${u.email ? u.email.replace(/(.{2}).*(@.*)/, '$1***$2') : '—'}`);
    console.log(`   бүртгүүлсэн ${fmt(u.created_at)} · tier ${u.tierbot_tier || '—'} · ${u.membership} · ${u.diamonds}💎 · L${u.level} · платформ W/L ${u.platform_wins}/${u.platform_losses} · maphack ${u.maphack_warnings}${u.banned ? ' · 🚫 БАН ' + u.ban_reason : ''}`);
    const { rows: lan } = await pool.query(
      `SELECT lg.created_at, lg.room_id, (lg.host_user_id = $1) AS is_host, lp.wc3_name
         FROM lan_games lg LEFT JOIN lan_game_players lp ON lp.token = lg.token AND lp.user_id = $1
        WHERE lg.host_user_id = $1 OR lp.user_id = $1 ORDER BY lg.created_at DESC LIMIT 8`, [u.id]);
    lan.forEach((g) => console.log(`   LAN ${fmt(g.created_at)} room ${g.room_id} ${g.is_host ? 'ХОСТ' : 'нэгдсэн'} ${g.wc3_name || ''}`));
    const { rows: gr } = await pool.query(
      `SELECT gr.played_at, gr.duration_minutes, gp.is_winner, gp.team, gr.net_report FROM game_players gp JOIN game_results gr ON gr.id = gp.game_result_id
        WHERE gp.user_id = $1 ORDER BY gr.played_at DESC LIMIT 8`, [u.id]);
    gr.forEach((g) => {
      const mine = ((g.net_report || {}).lag || []).filter((l) => true).map((l) => `${l.name}:${l.lag_screens}×`).join(',') || 'lag байхгүй';
      console.log(`   ДҮН ${fmt(g.played_at)} ${g.duration_minutes}мин баг ${g.team} ${g.is_winner ? 'ХОЖИЛ' : 'хожигдол'} · ${mine}`);
    });
  }
}

(async () => {
  if (recentH) await recent(recentH);
  if (q) await find(q);
  if (!recentH && !q) console.log('Хэрэглээ: node scripts/find-user.js <нэр|#id> | --recent <цаг>');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
