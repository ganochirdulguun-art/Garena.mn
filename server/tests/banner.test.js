'use strict';
// Профайлын дэвсгэр: зөвхөн GOLD/эзэн, зөвхөн зураг (magic байт), ≤5MB, нээлттэй GET.
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
const tok = (u) => jwt.sign(u, 'test-secret', { expiresIn: '1h' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
const future = new Date(Date.now() + 864e5).toISOString();
const users = { 1: { id: 1, username: 'bronze', membership: 'bronze' }, 2: { id: 2, username: 'gold', membership: 'gold', membership_until: future } };

async function main() {
  const port = 5950 + Math.floor(Math.random() * 40);
  Object.assign(process.env, { PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb' });
  clearSrc();
  require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query: async (sql, p = []) => {
    if (sql.includes('SELECT 1') && !sql.includes('FROM')) return { rows: [{}] };
    if (sql.includes('FROM admin_whitelist')) return { rows: [] };
    if (sql.includes('SELECT id, username, membership, membership_until')) return { rows: [users[p[0]]].filter(Boolean) };
    if (sql.includes('UPDATE users SET profile_banner = $1')) { Object.assign(users[p[3]], { profile_banner: p[0], profile_banner_mime: p[1] }); return { rows: [] }; }
    if (sql.includes('SELECT profile_banner, profile_banner_mime')) return { rows: [users[p[0]]].filter(Boolean) };
    return { rows: [], rowCount: 0 };
  } } };
  const srv = require(path.join(serverDir, 'src', 'index.js'));
  await srv.start(port);
  const up = (uid, body) => fetch(`http://127.0.0.1:${port}/profile/banner`, { method: 'POST', headers: { Authorization: `Bearer ${tok({ id: uid, username: 'u' })}`, 'Content-Type': 'application/octet-stream' }, body });
  const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(200, 1)]);

  let r = await up(1, gif); assert.equal(r.status, 403); ok('Bronze дэвсгэр оруулахгүй');
  r = await up(2, Buffer.from('MZ\x90\x00 not an image at all')); assert.equal(r.status, 400); ok('Зураг биш файл татгалзана');
  r = await up(2, Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(5 * 1024 * 1024 + 10)])); assert.ok(r.status === 413 || r.status === 400); ok('5MB-аас их татгалзана');
  r = await up(2, gif); assert.equal(r.status, 200); assert.equal((await r.json()).mime, 'image/gif'); ok('GOLD хөдөлгөөнт GIF оруулна');
  r = await fetch(`http://127.0.0.1:${port}/profile/banner/2`);
  assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/gif'); assert.ok(Buffer.from(await r.arrayBuffer()).equals(gif));
  r = await fetch(`http://127.0.0.1:${port}/profile/banner/1`); assert.equal(r.status, 404);
  ok('Нээлттэй GET: байт таарна, баннергүй бол 404');
  console.log(`=== banner: ${pass} PASS ===`);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
