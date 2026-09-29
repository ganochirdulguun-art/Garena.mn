'use strict';
// Map-ын сан: эзэн/админ л оруулна, зөвхөн WC3 map (HM3W/MPQ), файлын нэр цэвэрлэгдэнэ, татахад SHA-256 толгой.
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
const tok = (u) => jwt.sign(u, 'test-secret', { expiresIn: '1h' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };

const rows = [];
const q = async (sql, p = []) => {
  if (sql.includes('SELECT 1') && !sql.includes('FROM')) return { rows: [{}] };
  if (sql.includes('FROM admin_whitelist')) return { rows: [] };
  if (sql.includes('INSERT INTO maps')) {
    const r = { id: rows.length + 1, name: p[0], version: p[1], category: p[2], description: p[3], filename: p[4], size: p[5], sha256: p[6], data: p[7], downloads: 0, featured: false, active: true };
    rows.push(r); const { data, ...pub } = r; return { rows: [pub] };
  }
  if (sql.includes('FROM maps WHERE active = TRUE ORDER BY')) return { rows: rows.map(({ data, ...r }) => r) };
  if (sql.includes('SELECT filename, size, sha256, data FROM maps')) return { rows: rows.filter((r) => r.id == p[0]) };
  if (sql.includes('UPDATE maps SET downloads')) { const r = rows.find((x) => x.id == p[0]); if (r) r.downloads++; return { rows: [] }; }
  return { rows: [], rowCount: 0 };
};

async function main() {
  const port = 5600 + Math.floor(Math.random() * 200);
  Object.assign(process.env, { PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true', OWNER_USER_IDS: '2', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb' });
  clearSrc();
  require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query: q } };
  const srv = require(path.join(serverDir, 'src', 'index.js'));
  await srv.start(port);
  const base = `http://127.0.0.1:${port}`;
  const up = (uid, body, qs) => fetch(`${base}/maps/upload?${new URLSearchParams(qs)}`, { method: 'POST', headers: { Authorization: `Bearer ${tok({ id: uid, username: 'u' + uid })}`, 'Content-Type': 'application/octet-stream' }, body });
  const map = Buffer.concat([Buffer.from('HM3W'), crypto.randomBytes(5000)]);

  let r = await up(1, map, { filename: 'DotA v6.74c LoD v5e.w3x', name: 'DotA LoD' });
  assert.equal(r.status, 403); ok('Энгийн хэрэглэгч map оруулахгүй');

  r = await up(2, Buffer.from('MZ\x90\x00notamapfile....'), { filename: 'evil.w3x', name: 'x' });
  assert.equal(r.status, 400); ok('WC3 map биш файл (exe гэх мэт) татгалзана');
  r = await up(2, map, { filename: 'virus.exe', name: 'x' });
  assert.equal(r.status, 400); ok('.w3x/.w3m-ээс өөр өргөтгөл татгалзана');

  r = await up(2, map, { filename: '..\\..\\DotA v6.74c LoD v5e.w3x', name: 'DotA LoD', version: 'v6.74c', category: 'LoD' });
  assert.equal(r.status, 201); const m = await r.json();
  assert.equal(m.filename, 'DotA v6.74c LoD v5e.w3x', 'замын хэсэг хасагдана');
  assert.equal(m.sha256, crypto.createHash('sha256').update(map).digest('hex'));
  assert.equal(m.data, undefined, 'хариунд файлын өгөгдөл орохгүй');
  ok('Эзэн оруулна: нэр цэвэрлэгдэж, SHA-256 тооцогдоно');

  r = await fetch(`${base}/maps`);
  const list = await r.json();
  assert.equal(list.maps.length, 1); assert.equal(list.can_upload, false); assert.equal(list.maps[0].data, undefined);
  ok('Жагсаалт өгөгдөлгүй, нэвтрээгүй хүнд can_upload=false');

  r = await fetch(`${base}/maps/1/file`);
  assert.equal(r.status, 401, 'нэвтрээгүй хүн татахгүй');
  r = await fetch(`${base}/maps/1/file`, { headers: { Authorization: `Bearer ${tok({ id: 5, username: 'u5' })}` } });
  assert.equal(r.status, 200); assert.equal(r.headers.get('x-map-sha256'), m.sha256);
  assert.ok(Buffer.from(await r.arrayBuffer()).equals(map)); assert.equal(rows[0].downloads, 1);
  ok('Нэвтэрсэн хэрэглэгч татна: байт яг таарна, SHA толгой, тоолуур +1');

  console.log(`=== maps: ${pass} PASS ===`);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
