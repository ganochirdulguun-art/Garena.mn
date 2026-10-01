'use strict';
// Хүсэж буй тоглоомын санал: зөвхөн 3 түлхүүр, toggle (дахин дарвал буцна), тоо + mine.
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
const tok = (u) => jwt.sign(u, 'test-secret', { expiresIn: '1h' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
const rows = new Set();   // `${uid}:${key}`

async function main() {
  const port = 6050 + Math.floor(Math.random() * 40);
  Object.assign(process.env, { PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb' });
  clearSrc();
  require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query: async (sql, p = []) => {
    if (sql.includes('SELECT 1') && !sql.includes('FROM')) return { rows: [{}] };
    if (sql.startsWith('DELETE FROM game_wishes')) { const k = `${p[0]}:${p[1]}`; const had = rows.delete(k); return { rowCount: had ? 1 : 0, rows: [] }; }
    if (sql.startsWith('INSERT INTO game_wishes')) { rows.add(`${p[0]}:${p[1]}`); return { rowCount: 1, rows: [] }; }
    if (sql.includes('GROUP BY game_key')) { const c = {}; for (const r of rows) { const k = r.split(':')[1]; c[k] = (c[k] || 0) + 1; } return { rows: Object.entries(c).map(([game_key, n]) => ({ game_key, n })) }; }
    if (sql.includes('SELECT game_key FROM game_wishes WHERE user_id')) return { rows: [...rows].filter((r) => r.startsWith(`${p[0]}:`)).map((r) => ({ game_key: r.split(':')[1] })) };
    return { rows: [], rowCount: 0 };
  } } };
  const srv = require(path.join(serverDir, 'src', 'index.js'));
  await srv.start(port);
  const call = (uid, method, p) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { Authorization: `Bearer ${tok({ id: uid, username: 'u' + uid })}` } });

  let r = await call(1, 'POST', '/wishes/hacked'); assert.equal(r.status, 404); ok('Жагсаалтад байхгүй тоглоом 404');
  r = await call(1, 'POST', '/wishes/ctr'); let j = await r.json(); assert.equal(j.wished, true); assert.equal(j.counts.ctr, 1); assert.deepEqual(j.mine, ['ctr']); ok('Санал өгнө');
  r = await call(2, 'POST', '/wishes/ctr'); j = await r.json(); assert.equal(j.counts.ctr, 2); ok('Өөр хэрэглэгч → тоо нэмэгдэнэ');
  r = await call(1, 'POST', '/wishes/ctr'); j = await r.json(); assert.equal(j.wished, false); assert.equal(j.counts.ctr, 1); assert.deepEqual(j.mine, []); ok('Дахин дарвал буцаана (давхар тоолохгүй)');
  r = await call(2, 'GET', '/wishes'); j = await r.json(); assert.deepEqual(j.counts, { umk3: 0, ctr: 1, goldeneye: 0 }); assert.deepEqual(j.mine, ['ctr']); ok('GET тоо + mine');
  r = await fetch(`http://127.0.0.1:${port}/wishes`); assert.equal(r.status, 401); ok('Нэвтрээгүй бол 401');
  console.log(`=== wishes: ${pass} PASS ===`);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
