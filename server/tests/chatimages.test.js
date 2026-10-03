'use strict';
// Чатын зураг (routes/chatImages.js): upload (sniff, 2MB, минутад 5, sha256 давхардал → ижил key), serve (ETag/304),
// isDuplicate (нэг scope-д 24 цагт ижил зураг), cleanup (14 хоног + 300MB).
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'test-secret', SKIP_DB_MIGRATIONS: 'true' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };

const images = new Map();   // sha -> row
const lobbyImgs = [];       // { image, created_at, deleted }
const roomImgs = [];        // { room_id, image, created_at, deleted }
let deletedOld = 0;
async function query(sql, p = []) {
  const s = sql.replace(/\s+/g, ' ');
  if (s === 'SELECT 1') return { rows: [{}] };
  if (s.startsWith('INSERT INTO chat_images')) {
    const [key, sha, user_id, mime, size, bytes] = p;
    if (images.has(sha)) return { rows: [{ key: images.get(sha).key, is_new: false }] };
    images.set(sha, { key, sha, user_id, mime, size, bytes, created_at: Date.now() }); return { rows: [{ key, is_new: true }] };
  }
  if (s.startsWith('SELECT mime, bytes FROM chat_images WHERE key')) { const r = [...images.values()].find((x) => x.key === p[0]); return { rows: r ? [{ mime: r.mime, bytes: r.bytes }] : [] }; }
  if (s.startsWith('SELECT 1 FROM chat_images WHERE key')) return { rows: [...images.values()].some((x) => x.key === p[0]) ? [{}] : [] };
  if (s.includes('FROM room_messages WHERE room_id = $1 AND image = $2')) return { rows: roomImgs.some((x) => x.room_id === p[0] && x.image === p[1] && !x.deleted) ? [{}] : [] };
  if (s.includes('FROM lobby_messages WHERE image = $1')) return { rows: lobbyImgs.some((x) => x.image === p[0] && !x.deleted) ? [{}] : [] };
  if (s.startsWith('DELETE FROM chat_images WHERE created_at <')) { let n = 0; for (const [k, v] of images) if (v.old) { images.delete(k); n++; } deletedOld = n; return { rowCount: n }; }
  if (s.includes('SUM(size)')) return { rows: [{ total: String([...images.values()].reduce((a, x) => a + x.size, 0)) }] };
  if (s.startsWith('SELECT key, size FROM chat_images ORDER BY created_at')) return { rows: [...images.values()].sort((a, b) => a.created_at - b.created_at).map((x) => ({ key: x.key, size: x.size })) };
  if (s.startsWith('DELETE FROM chat_images WHERE key = ANY')) { let n = 0; for (const [k, v] of images) if (p[0].includes(v.key)) { images.delete(k); n++; } return { rowCount: n }; }
  return { rows: [], rowCount: 0 };
}
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query } };

const JPEG = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);

(async () => {
  const express = require('express');
  const ci = require(path.join(serverDir, 'src', 'routes', 'chatImages.js'));
  const app = express(); app.use('/chat', ci.router);
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const tok = (id) => jwt.sign({ id, username: 'u' + id }, 'test-secret', { expiresIn: '1h' });
  const up = (uid, buf, ct = 'application/octet-stream') => fetch(`http://127.0.0.1:${port}/chat/image`, { method: 'POST', headers: { Authorization: `Bearer ${tok(uid)}`, 'content-type': ct }, body: buf });

  let r = await up(1, JPEG(100)); let j = await r.json();
  assert.equal(r.status, 200); assert.match(j.key, /^[a-f0-9]{32}$/); assert.equal(j.dup, false); ok('JPEG ачаална → 32 hex key');
  const key1 = j.key;
  r = await up(2, JPEG(100)); j = await r.json(); assert.equal(j.key, key1); assert.equal(j.dup, true); ok('Ижил байт (sha256) → ижил key, давхар хадгалахгүй');
  r = await up(1, Buffer.from('hello world, not an image!')); assert.equal(r.status, 415); ok('Зураг биш → 415 (content-type-д итгэхгүй)');
  r = await fetch(`http://127.0.0.1:${port}/chat/image`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: JPEG(10) }); assert.equal(r.status, 401); ok('Нэвтрээгүй → 401');
  r = await up(1, Buffer.alloc(0)); assert.ok(r.status === 400 || r.status === 415); ok('Хоосон → алдаа');

  r = await fetch(`http://127.0.0.1:${port}/chat/image/${key1}`); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.match(r.headers.get('cache-control'), /immutable/); assert.equal(r.headers.get('etag'), `"${key1}"`); assert.equal((await r.arrayBuffer()).byteLength, 104); ok('GET → зураг, immutable кэш, ETag');
  r = await fetch(`http://127.0.0.1:${port}/chat/image/${key1}`, { headers: { 'if-none-match': `"${key1}"` } }); assert.equal(r.status, 304); ok('If-None-Match → 304 (сервер ачаалалгүй)');
  r = await fetch(`http://127.0.0.1:${port}/chat/image/zzz`); assert.equal(r.status, 404); ok('Буруу key → 404');
  r = await fetch(`http://127.0.0.1:${port}/chat/image/${'0'.repeat(32)}`); assert.equal(r.status, 404); ok('Байхгүй key → 404');

  assert.equal(await ci.exists(key1), true); assert.equal(await ci.exists('0'.repeat(32)), false); assert.equal(await ci.exists('../x'), false); ok('exists()');
  assert.equal(await ci.isDuplicate('lobby', key1), false);
  lobbyImgs.push({ image: key1 });
  assert.equal(await ci.isDuplicate('lobby', key1), true); ok('Лоббид ижил зураг 2 дахь удаа → давхардал (татгалзана)');
  assert.equal(await ci.isDuplicate('room', key1, 901), false);
  roomImgs.push({ room_id: 901, image: key1 });
  assert.equal(await ci.isDuplicate('room', key1, 901), true); assert.equal(await ci.isDuplicate('room', key1, 902), false); ok('Room-д давхардал зөвхөн тухайн Room-ын хүрээнд');
  lobbyImgs[0].deleted = true; assert.equal(await ci.isDuplicate('lobby', key1), false); ok('Устгасан мессежийн зураг давхардалд тооцохгүй');

  // Минутад 5
  for (let i = 0; i < 4; i++) { r = await up(5, JPEG(200 + i)); assert.equal(r.status, 200); }
  r = await up(5, JPEG(300)); assert.equal(r.status, 200);
  r = await up(5, JPEG(301)); assert.equal(r.status, 429); ok('Нэг хэрэглэгч минутад 5-аас илүү → 429');
  r = await up(6, PNG); assert.equal(r.status, 200); ok('Өөр хэрэглэгч хязгаарт орохгүй; PNG зөвшөөрнө');

  // cleanup: хуучин + хэмжээний дээд хязгаар
  for (const v of images.values()) { if (v.size === 104) v.old = true; }
  let n = await ci.cleanup(); assert.equal(deletedOld, 1); assert.ok(n >= 1); ok('14 хоногоос хуучин зураг устна');
  const big = JPEG(1_500_000); r = await up(7, big); assert.equal(r.status, 200);
  for (let i = 0; i < 4; i++) { r = await up(8 + i, JPEG(1_400_000 + i)); assert.equal(r.status, 200); }
  r = await up(20, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024, 1)])); assert.ok(r.status === 413 || r.status === 400); ok('2MB-с их → татгалзана');
  // нийт ~7.4MB; cap-ыг туршихын тулд images-д хуурамч том оруулна
  images.set('fake-big', { key: 'b'.repeat(32), sha: 'fake-big', mime: 'image/jpeg', size: 299 * 1024 * 1024, bytes: Buffer.alloc(1), created_at: 1 });
  const before = images.size; n = await ci.cleanup(); assert.ok(images.size < before); assert.equal(images.has('fake-big'), false); ok('Нийт 300MB-аас давбал хамгийн хуучнаас устгана');

  srv.close();
  console.log(`\n=== chatimages: ${pass} PASS ===`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
