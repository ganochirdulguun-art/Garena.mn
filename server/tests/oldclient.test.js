'use strict';
// Хуучин / portable клиентэд «Setup суулга» хувийн мэдэгдэл (index.js oldClientNotice)
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const serverDir = path.resolve(__dirname, '..');
const { io: ioc } = require(path.join(serverDir, '..', 'client', 'node_modules', 'socket.io-client'));

let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
function listen(port, uid, ua, auth = {}) {
  return new Promise((resolve) => {
    const token = jwt.sign({ id: uid, username: `u${uid}` }, 'test-secret', { expiresIn: '1h' });
    const s = ioc(`http://127.0.0.1:${port}`, { transports: ['websocket'], auth: { token, ...auth }, extraHeaders: { 'user-agent': ua } });
    const got = [];
    s.on('lobby:chat', (m) => { if (m.system) got.push(m.text); });
    s.on('connect', () => s.emit('lobby:register'));
    setTimeout(() => { s.close(); resolve(got); }, 6000);
  });
}

(async () => {
  const port = 6250 + Math.floor(Math.random() * 40);
  Object.assign(process.env, { PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb' });
  const srv = require(path.join(serverDir, 'src', 'index.js'));
  await srv.start(port);
  const UA = (v) => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Garena.mn/${v} Chrome/148.0 Electron/42.9.1 Safari/537.36`;
  const [oldC, newC, portC] = await Promise.all([listen(port, 101, UA('2.8.11')), listen(port, 102, UA('2.9.27')), listen(port, 103, UA('2.9.28'), { portable: true })]);
  assert.equal(oldC.length, 1); assert.match(oldC[0], /v2\.8\.11/); assert.match(oldC[0], /Setup/); ok('Хуучин (2.8.11) клиентэд Setup мэдэгдэл');
  assert.equal(newC.length, 0); ok('Шинэ Setup (2.9.27) клиентэд мэдэгдэхгүй');
  assert.equal(portC.length, 1); assert.match(portC[0], /PORTABLE/); ok('Шинэ portable клиентэд мэдэгдэнэ');
  const again = await listen(port, 101, UA('2.8.11'));
  assert.equal(again.length, 0); ok('Нэг хэрэглэгчид 6 цагт нэг удаа');
  console.log(`=== oldclient: ${pass} PASS ===`);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
