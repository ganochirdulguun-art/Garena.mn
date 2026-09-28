'use strict';
// LAN relay failover: үндсэн relay 3 удаа хариу өгөхгүй бол шинэ тоглолт нөөц relay-г авна;
// /begin-д өгсөн relay-г /announce joiner-уудад ЯГ ТЭР хэвээр өгнө; үндсэн сэргэвэл буцна.
const assert = require('node:assert/strict');
const path = require('node:path');
const net = require('node:net');
const jwt = require('jsonwebtoken');

const serverDir = path.resolve(__dirname, '..');
const serverIndexPath = path.join(serverDir, 'src', 'index.js');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
function installMockDb(m) { require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: m }; }
function token(u) { return jwt.sign(u, 'test-secret', { expiresIn: '1h' }); }

async function main() {
  const primary = net.createServer((s) => s.destroy()); await new Promise((r) => primary.listen(0, '127.0.0.1', r));
  const backup = net.createServer((s) => s.destroy()); await new Promise((r) => backup.listen(0, '127.0.0.1', r));
  const pPort = primary.address().port, bPort = backup.address().port;
  const port = 5000 + Math.floor(Math.random() * 200);
  Object.assign(process.env, {
    PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true',
    DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb',
    LAN_RELAY_IP: '127.0.0.1', LAN_RELAY_PORT: String(pPort), LAN_RELAY_FALLBACKS: `localhost:${bPort}`,
  });
  clearSrc();
  installMockDb({ query: async (sql, params) => {
    if (sql.includes('FROM room_players rp') && sql.includes('JOIN rooms r')) return { rows: String(params?.[0]) === '5' && String(params?.[1]) === '1' ? [{}] : [] };
    if (sql.includes('SELECT 1')) return { rows: [{}] };
    return { rows: [], rowCount: 0 };
  } });
  const srv = require(serverIndexPath);
  await srv.start(port);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {} await wait(200); }
  const lan = require(path.join(serverDir, 'src', 'routes', 'lanhost.js'));
  const base = `http://127.0.0.1:${port}`;
  const hdr = { Authorization: `Bearer ${token({ id: 5, username: 'u5' })}`, 'Content-Type': 'application/json' };
  const begin = async () => (await fetch(`${base}/rooms/1/lan-host/begin`, { method: 'POST', headers: hdr })).json();

  assert.equal(lan._relays.length, 2);
  let b = await begin();
  assert.equal(b.relay_port, pPort, 'эхэндээ үндсэн relay');
  const tokA = b.game_token;
  console.log('PASS эхэндээ үндсэн relay');

  // үндсэн унтарлаа → 2 шалгалтаар хараахан шилжихгүй, 3 дахь дээр шилжинэ
  await new Promise((r) => primary.close(r));
  await lan._checkRelays(); await lan._checkRelays();
  assert.equal((await begin()).relay_port, pPort, '2 алдаанд шилжихгүй');
  await lan._checkRelays();
  b = await begin();
  assert.equal(b.relay_ip, 'localhost'); assert.equal(b.relay_port, bPort, '3 алдааны дараа нөөц');
  console.log('PASS 3 дараалсан алдааны дараа нөөц relay');

  // failover-ийн ӨМНӨ begin хийсэн хост announce хийвэл joiner-т үндсэн relay-г (хостын холбогдсон) өгнө
  const r = await fetch(`${base}/rooms/1/lan-host/announce`, { method: 'POST', headers: hdr, body: JSON.stringify({ game_token: tokA, gameinfo_b64: 'AAAA', host_wc3_name: 'h' }) });
  assert.equal(r.status, 200);
  const list = await (await fetch(`${base}/rooms/1/lan-host`, { headers: hdr })).json();
  const g = list.games.find((x) => x.game_token === tokA);
  assert.equal(g.relay_port, pPort, 'announce begin-ий relay-г хадгална');
  console.log('PASS announce нь begin-д өгсөн relay-г хадгална');

  // үндсэн сэргэлээ → нэг амжилттай шалгалтаар буцна
  const primary2 = net.createServer((s) => s.destroy()); await new Promise((res) => primary2.listen(pPort, '127.0.0.1', res));
  await lan._checkRelays();
  assert.equal((await begin()).relay_port, pPort);
  console.log('PASS үндсэн сэргэвэл буцна');
  primary2.close(); backup.close(); process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
