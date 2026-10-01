'use strict';
// Relay shard: үндсэн relay олон портод (CPU core бүрт процесс) хуваагдана; тоглоом бүрийн порт токены hash-аар
// детерминист → /begin ба /announce (сервер restart-ын дараа ч) ижил порт. Нөөц relay shard-гүй.
const assert = require('node:assert/strict');
const path = require('node:path');
const serverDir = path.resolve(__dirname, '..');
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };

Object.assign(process.env, { NODE_ENV: 'test', LAN_RELAY_IP: '10.0.0.1', LAN_RELAY_PORT: '7000', LAN_RELAY_FALLBACKS: '10.0.0.2:7000', LAN_RELAY_SHARD_PORTS: '7000, 7001,7002,7003,bad' });
const dbPath = path.join(serverDir, 'src', 'config', 'db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) } };
const lan = require(path.join(serverDir, 'src', 'routes', 'lanhost.js'));
const [primary, backup] = lan._relays;

const counts = {};
for (let i = 0; i < 4000; i++) { const r = lan._shardFor(primary, 'tok' + i); assert.equal(r.ip, '10.0.0.1'); counts[r.port] = (counts[r.port] || 0) + 1; }
assert.deepEqual(Object.keys(counts).map(Number).sort(), [7000, 7001, 7002, 7003]);
for (const c of Object.values(counts)) assert.ok(c > 800 && c < 1200, 'жигд тархалт ' + c);
ok('4 порт руу жигд тархана, буруу утгыг хаяна');
assert.deepEqual(lan._shardFor(primary, 'abc'), lan._shardFor(primary, 'abc'));
ok('Ижил токен → ижил порт (детерминист)');
assert.equal(lan._shardFor(backup, 'abc'), backup);
ok('Нөөц relay shard-гүй, өөрийн портоороо');
console.log(`=== relayshard: ${pass} PASS ===`);
process.exit(0);
