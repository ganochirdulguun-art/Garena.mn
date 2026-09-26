'use strict';
// /mesh — preauth түлхүүр (Headscale mock), cooldown, report/status, mesh IP шалгалт.
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const http = require('node:http');

const serverDir = path.resolve(__dirname, '..');
const serverIndexPath = path.join(serverDir, 'src', 'index.js');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
function installMockDb(m) { require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: m }; }
function token(u) { return jwt.sign(u, 'test-secret', { expiresIn: '1h' }); }

async function main() {
  // Headscale mock
  let hsCalls = 0;
  const hs = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      hsCalls++;
      assert.equal(req.headers.authorization, 'Bearer hskey-test');
      assert.equal(req.url, '/api/v1/preauthkey');
      const b = JSON.parse(body);
      assert.equal(b.user, '1'); assert.equal(b.reusable, false);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ preAuthKey: { key: 'pak-abc', expiration: b.expiration } }));
    });
  });
  await new Promise((r) => hs.listen(0, '127.0.0.1', r));
  const hsPort = hs.address().port;
  const port = 4950 + Math.floor(Math.random() * 50);
  Object.assign(process.env, {
    PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true',
    DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb',
    HEADSCALE_URL: `http://127.0.0.1:${hsPort}/`, HEADSCALE_API_KEY: 'hskey-test', HEADSCALE_USER_ID: '1',
  });
  clearSrc(); installMockDb({ query: async (sql) => (sql.includes('SELECT 1') ? { rows: [{}] } : { rows: [], rowCount: 0 }) });
  const srv = require(serverIndexPath);
  await srv.start(port);
  for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) break; } catch {} await wait(200); }
  const base = `http://127.0.0.1:${port}`;
  const t5 = token({ id: 5, username: 'u5' });
  const hdr = { Authorization: `Bearer ${t5}`, 'Content-Type': 'application/json' };

  // 1) authkey
  let r = await fetch(`${base}/mesh/authkey`, { method: 'POST', headers: hdr });
  assert.equal(r.status, 200);
  let j = await r.json();
  assert.equal(j.auth_key, 'pak-abc'); assert.equal(j.hostname, 'garena-5'); assert.equal(j.login_server, `http://127.0.0.1:${hsPort}`);
  assert.equal(hsCalls, 1);
  console.log('PASS /mesh/authkey → Headscale preauth (нэг удаагийн, 1ц)');
  // 2) cooldown
  r = await fetch(`${base}/mesh/authkey`, { method: 'POST', headers: hdr });
  assert.equal(r.status, 429); assert.equal(hsCalls, 1);
  console.log('PASS /mesh/authkey cooldown 429');
  // 3) JWT-гүй
  r = await fetch(`${base}/mesh/authkey`, { method: 'POST' });
  assert.equal(r.status, 401);
  // 4) report + status
  r = await fetch(`${base}/mesh/report`, { method: 'POST', headers: hdr, body: JSON.stringify({ mesh_ip: '100.64.0.7', state: 'Running', version: '1.102.4', hostname: 'garena-5' }) });
  j = await r.json(); assert.equal(j.mesh_ip, '100.64.0.7');
  r = await fetch(`${base}/mesh/report`, { method: 'POST', headers: hdr, body: JSON.stringify({ mesh_ip: '192.168.1.5' }) });
  j = await r.json(); assert.equal(j.mesh_ip, null, 'mesh биш IP хүлээн авахгүй');
  r = await fetch(`${base}/mesh/status`, { headers: hdr }); j = await r.json();
  assert.equal(j.configured, true); assert.equal(j.me.ip, null); assert.equal(j.me.state, '');
  console.log('PASS /mesh/report + /mesh/status (100.64/10 шалгалт)');
  const mesh = require(path.join(serverDir, 'src', 'routes', 'mesh.js'));
  assert.equal(mesh.isMeshIp('100.127.255.254'), true); assert.equal(mesh.isMeshIp('100.128.0.1'), false); assert.equal(mesh.isMeshIp('10.147.1.1'), false);
  console.log('PASS isMeshIp');
  hs.close(); await srv.stop?.(); process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
