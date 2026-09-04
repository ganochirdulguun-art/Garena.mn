#!/usr/bin/env node
/**
 * Тест/хуурамч бүртгэл устгах (зөвхөн тоглолтгүй, хамгаалалттай). Хэрэглээ:
 *   node scripts/delete-user.js "#245"          # юу устгахыг харуулна (dry run)
 *   node scripts/delete-user.js "#245" --yes    # устгана
 * Хамгаалалт: тоглолт (game_players/lan_games) бүртгэлтэй, admin/owner, эсвэл системийн (system@garena.mn) хэрэглэгчийг устгахгүй.
 */
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false } });
const arg = process.argv[2] || '';
const yes = process.argv.includes('--yes');
if (!/^#\d+$/.test(arg)) { console.log('Хэрэглээ: node scripts/delete-user.js "#<id>" [--yes]'); process.exit(1); }
const id = Number(arg.slice(1));

(async () => {
  const { rows } = await pool.query('SELECT id, username, email, discord_id, COALESCE(diamonds,0) AS diamonds, created_at FROM users WHERE id = $1', [id]);
  const u = rows[0];
  if (!u) { console.log('олдсонгүй'); return pool.end(); }
  const games = (await pool.query('SELECT COUNT(*)::int AS n FROM game_players WHERE user_id = $1', [id])).rows[0].n;
  const lan = (await pool.query('SELECT COUNT(*)::int AS n FROM lan_games WHERE host_user_id = $1', [id])).rows[0].n
    + (await pool.query('SELECT COUNT(*)::int AS n FROM lan_game_players WHERE user_id = $1', [id])).rows[0].n;
  const paid = (await pool.query("SELECT COUNT(*)::int AS n FROM diamond_transactions WHERE user_id = $1 AND type IN ('purchase','membership')", [id])).rows[0].n;
  const admins = String(process.env.ADMIN_DISCORD_IDS || '').split(',').map((s) => s.trim());
  const guard = [];
  if (games || lan) guard.push(`тоглолт ${games}, LAN ${lan}`);
  if (paid) guard.push(`төлбөр/гишүүнчлэл ${paid}`);
  if (u.email === 'system@garena.mn') guard.push('системийн хэрэглэгч');
  if (u.discord_id && admins.includes(String(u.discord_id))) guard.push('админ');
  console.log(`#${u.id} ${u.username} <${u.email || '—'}> discord=${u.discord_id || '—'} ${u.diamonds}💎 бүртгүүлсэн ${u.created_at}`);
  if (guard.length) { console.log('⛔ Устгахгүй:', guard.join('; ')); return pool.end(); }
  if (!yes) { console.log('Dry run — устгахын тулд --yes'); return pool.end(); }
  await pool.query('DELETE FROM users WHERE id = $1', [id]);   // FK ON DELETE CASCADE: messages, diamond_transactions г.м.
  console.log('🗑️ устгалаа');
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
