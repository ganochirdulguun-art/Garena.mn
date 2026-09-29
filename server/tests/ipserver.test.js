'use strict';
// CS 1.6 / Quake III сервер зарлах: зөвхөн өрөөний гишүүн, зөвхөн mesh IP, нэг өрөөнд нэг хост, хост л хаана.
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
const tok = (u) => jwt.sign(u, 'test-secret', { expiresIn: '1h' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
const members = new Set(['5:1', '6:1']);   // userId:roomId

async function main() {
  const port = 5800 + Math.floor(Math.random() * 150);
  Object.assign(process.env, { PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb' });
  clearSrc();
  require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query: async (sql, p) => {
    if (sql.includes('FROM room_players rp') && sql.includes('JOIN rooms r')) return { rows: members.has(`${p?.[0]}:${p?.[1]}`) ? [{}] : [] };
    if (sql.includes('SELECT 1')) return { rows: [{}] };
    return { rows: [], rowCount: 0 };
  } } };
  const srv = require(path.join(serverDir, 'src', 'index.js'));
  await srv.start(port);
  const call = async (uid, method, body) => {
    const r = await fetch(`http://127.0.0.1:${port}/rooms/1/ipserver`, { method, headers: { Authorization: `Bearer ${tok({ id: uid, username: 'u' + uid })}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  let r = await call(9, 'POST', { kind: 'cs16', ip: '100.64.0.5', port: 27015 });
  assert.equal(r.status, 403); ok('Өрөөний гишүүн биш хүн сервер зарлахгүй');
  r = await call(5, 'POST', { kind: 'cs16', ip: '8.8.8.8', port: 27015 });
  assert.equal(r.status, 400); assert.equal(r.body.code, 'MESH_REQUIRED'); ok('Mesh-ээс гадуурх IP татгалзана');
  r = await call(5, 'POST', { kind: 'doom', ip: '100.64.0.5' });
  assert.equal(r.status, 400); ok('Дэмжигдээгүй тоглоом татгалзана');
  r = await call(5, 'POST', { kind: 'cs16', ip: '100.64.0.5', port: 27015, map: 'de_dust2;quit' });
  assert.equal(r.status, 200); assert.equal(r.body.server.map, 'de_dust2quit', 'map нэрээс тусгай тэмдэгт хасагдана');
  r = await call(6, 'GET');
  assert.equal(r.body.server.ip, '100.64.0.5'); assert.equal(r.body.server.label, 'Counter-Strike 1.6');
  r = await call(9, 'GET'); assert.equal(r.status, 403, 'гадны хүн хаягийг харахгүй');
  ok('Гишүүд серверийн хаягийг харна, гадны хүн харахгүй');
  r = await call(6, 'POST', { kind: 'cs16', ip: '100.64.0.6' });
  assert.equal(r.status, 409); ok('Нэг өрөөнд хоёр дахь хост зарлахгүй');
  r = await call(6, 'DELETE'); assert.equal(r.status, 403);
  r = await call(5, 'DELETE'); assert.equal(r.status, 200);
  r = await call(6, 'GET'); assert.equal(r.body.server, null);
  ok('Зөвхөн хост сервераа хаана');
  members.delete('5:1');
  await call(6, 'POST', { kind: 'q3', ip: '100.64.0.6', port: 27960 });
  members.delete('6:1'); members.add('7:1');
  r = await fetch(`http://127.0.0.1:${port}/rooms/1/ipserver`, { headers: { Authorization: `Bearer ${tok({ id: 7, username: 'u7' })}` } }).then((x) => x.json());
  assert.equal(r.server, null, 'хост гарсан бол хуучирсан сервер цэвэрлэгдэнэ');
  ok('Хост өрөөнөөс гарвал сервер автоматаар алга болно');

  console.log(`=== ipserver: ${pass} PASS ===`);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
