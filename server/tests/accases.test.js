'use strict';
// Хакны хэрэг (routes/acCases.js + anticheat.js /report): автомат бан БАЙХГҮЙ, ЭЗЭН/ADMIN-д мэдэгдэл,
// ADMIN санал (тайлбартай) → ЭЗЭН бан; Room ADMIN зөвхөн өөрийн Room-ын хэрэг; эзэн шууд бан/цуцлах.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'test-secret', SKIP_DB_MIGRATIONS: 'true', OWNER_USER_IDS: '1' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };

const users = { 1: { id: 1, username: 'Owner' }, 2: { id: 2, username: 'Cheater' }, 3: { id: 3, username: 'Normal' }, 4: { id: 4, username: 'GAdmin' }, 5: { id: 5, username: 'R901Admin' }, 6: { id: 6, username: 'Other' } };
for (const u of Object.values(users)) Object.assign(u, { banned: false, ban_reason: null, maphack_warnings: 0 });
const cases = []; let seq = 0; const ignores = new Set();
const norm = (s) => s.replace(/\s+/g, ' ').trim();
async function query(sql, p = []) {
  const s = norm(sql);
  if (s === 'SELECT 1') return { rows: [{}] };
  if (s.startsWith('SELECT 1 FROM anticheat_ignores')) return { rows: ignores.has(p[0] + '|' + p[1]) ? [{}] : [] };
  if (s.startsWith('SELECT sig FROM anticheat_ignores')) return { rows: p[1].filter((x) => ignores.has(p[0] + '|' + x)).map((x) => ({ sig: x })) };
  if (s.startsWith('INSERT INTO anticheat_ignores')) { ignores.add(p[0] + '|' + p[1]); return { rows: [] }; }
  if (s.startsWith('UPDATE users SET maphack_warnings = COALESCE(maphack_warnings, 0) + 1')) { const u = users[p[0]]; u.maphack_warnings++; return { rows: [{ maphack_warnings: u.maphack_warnings, discord_id: null, username: u.username, banned: u.banned }] }; }
  if (s.startsWith('INSERT INTO maphack_events')) return { rows: [] };
  if (s.startsWith('SELECT id FROM anticheat_cases WHERE user_id = $1 AND kind = $2')) return { rows: cases.filter((c) => c.user_id === Number(p[0]) && c.kind === p[1] && (c.tool || '') === p[2] && ['new', 'nominated'].includes(c.status)).slice(-1) };
  if (s.startsWith('UPDATE anticheat_cases SET hits = hits + 1')) { const c = cases.find((x) => x.id === p[0]); c.hits++; if (p[2] != null) c.room_id = p[2]; const nd = JSON.parse(p[1]); if (c.detail?.warned_at) { nd.warned_at = c.detail.warned_at; nd.warn_count = c.detail.warn_count; } c.detail = nd; return { rows: [] }; }
  if (s.startsWith('SELECT hits, detail, severity FROM anticheat_cases WHERE id = $1')) { const c = cases.find((x) => x.id === p[0]); return { rows: c ? [{ hits: c.hits, detail: c.detail, severity: c.severity }] : [] }; }
  if (s.startsWith('UPDATE anticheat_cases SET detail = $2::jsonb WHERE id = $1')) { const c = cases.find((x) => x.id === p[0]); c.detail = JSON.parse(p[1]); return { rows: [] }; }
  if (s.startsWith("UPDATE anticheat_cases SET severity = 'high'")) { const c = cases.find((x) => x.id === p[0]); c.severity = 'high'; return { rows: [] }; }
  if (s.startsWith("SELECT id, hits, detail FROM anticheat_cases WHERE user_id = $1 AND kind = 'unverified'")) return { rows: cases.filter((c) => c.user_id === Number(p[0]) && c.kind === 'unverified' && ['new', 'nominated'].includes(c.status)).slice(-1) };
  if (s.startsWith('INSERT INTO anticheat_cases')) { const c = { id: ++seq, user_id: Number(p[0]), kind: p[1], tool: p[2], severity: p[3], detail: JSON.parse(p[4]), room_id: p[5], hits: 1, status: 'new' }; cases.push(c); return { rows: [{ id: c.id }] }; }
  if (s.startsWith('SELECT username FROM users WHERE id = $1')) return { rows: users[p[0]] ? [{ username: users[p[0]].username }] : [] };
  if (s.startsWith('SELECT c.*, u.username')) { const c = cases.find((x) => String(x.id) === String(p[0])); return { rows: c ? [{ ...c, username: users[c.user_id].username, discord_id: null }] : [] }; }
  if (s.startsWith('SELECT c.id, c.user_id')) {
    let list = cases.slice();
    const where = s.slice(s.indexOf(' WHERE '), s.indexOf(' ORDER BY '));
    if (where.includes("c.status IN ('new','nominated')")) list = list.filter((c) => ['new', 'nominated'].includes(c.status));
    if (where.includes("c.status = 'nominated'")) list = list.filter((c) => c.status === 'nominated');
    if (s.includes('AND c.room_id = $1')) list = list.filter((c) => c.room_id === p[0]);
    return { rows: list.map((c) => ({ ...c, username: users[c.user_id].username })) };
  }
  if (s.startsWith('SELECT COUNT(*) FILTER')) { const list = s.includes('room_id = $1') ? cases.filter((c) => c.room_id === p[0]) : cases; return { rows: [{ new: list.filter((c) => c.status === 'new').length, nominated: list.filter((c) => c.status === 'nominated').length }] }; }
  if (s.startsWith("UPDATE anticheat_cases SET status = 'nominated'")) { const c = cases.find((x) => x.id === p[0]); Object.assign(c, { status: 'nominated', nominated_by: p[1], nominate_note: p[2] }); return { rows: [] }; }
  if (s.startsWith("UPDATE anticheat_cases SET status = 'dismissed'")) { const c = cases.find((x) => x.id === p[0]); Object.assign(c, { status: 'dismissed', decided_by: p[1] }); return { rows: [] }; }
  if (s.startsWith("UPDATE anticheat_cases SET status = 'banned'")) { cases.filter((c) => c.user_id === Number(p[0]) && ['new', 'nominated'].includes(c.status)).forEach((c) => { c.status = 'banned'; }); return { rows: [] }; }
  if (s.startsWith('UPDATE anticheat_cases SET decision_note')) return { rows: [] };
  if (s.startsWith('UPDATE users SET banned = TRUE')) { Object.assign(users[p[0]], { banned: true, ban_reason: p[1] }); return { rows: [] }; }
  if (s.startsWith('UPDATE users SET banned = FALSE')) { const u = users[p[0]]; if (!u) return { rows: [] }; Object.assign(u, { banned: false, ban_reason: null }); return { rows: [{ username: u.username }] }; }
  if (s.startsWith('SELECT id, username, discord_id, COALESCE(banned,FALSE) AS banned FROM users WHERE id = $1')) return { rows: users[p[0]] ? [users[p[0]]] : [] };
  if (s.includes('DELETE FROM platform_roles WHERE user_id = $1 RETURNING role')) return { rows: [] };
  return { rows: [], rowCount: 0 };
}
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query } };

(async () => {
  const express = require('express');
  const roles = require(path.join(serverDir, 'src', 'routes', 'roles.js'));
  roles.cacheRole(4, 'admin', null);    // глобал ADMIN
  roles.cacheRole(5, 'admin', 901);     // Room 901-ийн ADMIN
  const ac = require(path.join(serverDir, 'src', 'routes', 'anticheat.js'));
  const acc = require(path.join(serverDir, 'src', 'routes', 'acCases.js'));
  const emitted = [];
  const fakeSockets = [1, 4, 5, 6].map((id) => ({ user: users[id], data: {}, emit: (ev, d) => emitted.push({ to: id, ev, d }), disconnect() { this.gone = true; } }));
  fakeSockets.push({ user: users[2], data: { roomId: '901' }, emit: (ev, d) => emitted.push({ to: 2, ev, d }), disconnect() { this.gone = true; } });
  acc.setIO({ sockets: { sockets: new Map(fakeSockets.map((s, i) => [i, s])) } });
  const app = express(); app.use(express.json()); app.use('/anticheat', ac); app.use('/anticheat', acc.router);
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
  const call = (uid, method, p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { Authorization: `Bearer ${jwt.sign({ id: uid, username: users[uid].username }, 'test-secret')}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  // 1) Процессын илрэлт 3 удаа → автомат бан БАЙХГҮЙ, нэг хэрэг (hits 3), мэдэгдэл эзэн+глобал+Room901 ADMIN-д
  for (let i = 0; i < 3; i++) { const r = await call(2, 'POST', '/anticheat/report', { tool: 'xenon' }); assert.equal(r.status, 200); }
  assert.equal(users[2].banned, false); ok('3 илрэлтийн дараа ч АВТОМАТ БАН БАЙХГҮЙ');
  assert.equal(cases.length, 1); assert.equal(cases[0].hits, 3); assert.equal(cases[0].kind, 'process'); assert.equal(cases[0].severity, 'high'); assert.equal(cases[0].room_id, 901); ok('Нэг хэрэг (hits 3), Room-ыг socket-оос тогтооно');
  const notified = emitted.filter((e) => e.ev === 'staff:notify' && e.d.type === 'anticheat' && e.d.case_id === 1).map((e) => e.to).sort();
  assert.deepEqual(notified, [1, 4, 5]); ok('Мэдэгдэл: ЭЗЭН, глобал ADMIN, тухайн Room-ын ADMIN-д (энгийн хэрэглэгчид биш)');

  // 2) DLL / санах ой — сануулга тоолохгүй, хэрэг нээнэ
  let r = await call(2, 'POST', '/anticheat/report', { kind: 'memory', tool: 'Game.dll .text', detail: { diff_bytes: 12 } }); let j = await r.json();
  assert.ok(j.case_id); assert.equal(users[2].maphack_warnings, 3); ok('memory тайлан → хэрэг нээгдэнэ, сануулга нэмэгдэхгүй');

  // 3) Эрх: энгийн хэрэглэгч 403; Room ADMIN зөвхөн өөрийн Room
  r = await call(3, 'GET', '/anticheat/cases'); assert.equal(r.status, 403); ok('Энгийн хэрэглэгч жагсаалт харахгүй');
  r = await call(5, 'GET', '/anticheat/cases'); j = await r.json(); assert.equal(j.cases.length, 2); assert.equal(j.is_owner, false); ok('Room ADMIN өөрийн Room-ын хэргийг харна');
  cases.push({ id: ++seq, user_id: 6, kind: 'module', tool: 'x.dll', severity: 'review', detail: {}, room_id: 905, hits: 1, status: 'new' });
  r = await call(5, 'GET', '/anticheat/cases'); j = await r.json(); assert.equal(j.cases.length, 2); ok('Өөр Room-ын хэрэг Room ADMIN-д харагдахгүй');
  r = await call(5, 'POST', `/anticheat/cases/${seq}/nominate`, { note: 'тест' }); assert.equal(r.status, 404); ok('Өөр Room-ын хэрэгт санал өгөхгүй');
  r = await call(4, 'GET', '/anticheat/cases'); j = await r.json(); assert.equal(j.cases.length, 3); ok('Глобал ADMIN бүх хэргийг харна');

  // 4) ADMIN санал → эзэнд мэдэгдэл; ADMIN бан хийж чадахгүй, санал болгосныг хэрэгсэхгүй болгож чадахгүй
  r = await call(5, 'POST', '/anticheat/cases/1/nominate', { note: '' }); assert.equal(r.status, 400); ok('Тайлбаргүй санал хүлээж авахгүй');
  emitted.length = 0;
  r = await call(5, 'POST', '/anticheat/cases/1/nominate', { note: 'xenon 3 удаа илэрсэн, replay-д ч сэжигтэй' }); assert.equal(r.status, 200);
  assert.equal(cases[0].status, 'nominated'); assert.ok(emitted.some((e) => e.to === 1 && e.d.nominated && e.d.note.includes('xenon'))); ok('ADMIN бан жагсаалтад оруулна (тайлбартай) → эзэнд мэдэгдэнэ');
  r = await call(5, 'POST', '/anticheat/cases/1/ban', { note: 'x' }); assert.equal(r.status, 403); ok('ADMIN бан хийж чадахгүй');
  r = await call(4, 'POST', '/anticheat/cases/1/dismiss', {}); assert.equal(r.status, 403); ok('Санал болгосон хэргийг ADMIN хэрэгсэхгүй болгож чадахгүй');
  r = await call(4, 'POST', `/anticheat/cases/${seq}/dismiss`, { note: 'Discord overlay' }); assert.equal(r.status, 200); assert.equal(cases[2].status, 'dismissed'); ok('ADMIN шинэ хэргийг хэрэгсэхгүй болгоно');

  // 5) ЭЗЭН бан → бантай, бүх нээлттэй хэрэг 'banned', socket салсан
  r = await call(1, 'GET', '/anticheat/cases?status=nominated'); j = await r.json(); assert.equal(j.cases.length, 1); assert.equal(j.cases[0].nominate_note.includes('xenon'), true); assert.equal(j.is_owner, true); ok('Эзэн санал болгосон жагсаалт + ADMIN-ы тайлбарыг харна');
  r = await call(1, 'POST', '/anticheat/cases/1/ban', { note: 'MapHack нотлогдсон' }); assert.equal(r.status, 200);
  assert.equal(users[2].banned, true); assert.match(users[2].ban_reason, /^MapHack/); assert.ok(cases.filter((c) => c.user_id === 2).every((c) => c.status === 'banned'));
  assert.ok(fakeSockets.find((s) => s.user.id === 2).gone); ok('ЭЗЭН бан → хэрэглэгч бантай, хэргүүд хаагдсан, холболт тасарсан');

  // 6) Эзэн шууд бан / цуцлах; эзнийг бандахгүй; ADMIN шууд бан хийхгүй
  r = await call(4, 'POST', '/anticheat/users/3/ban', { reason: 'x' }); assert.equal(r.status, 403); ok('ADMIN шууд бан хийж чадахгүй');
  r = await call(1, 'POST', '/anticheat/users/3/ban', { reason: 'Зүй бус үйлдэл' }); assert.equal(r.status, 200); assert.equal(users[3].banned, true); ok('Эзэн хэрэггүйгээр шууд бандана');
  r = await call(1, 'POST', '/anticheat/users/3/unban'); assert.equal(r.status, 200); assert.equal(users[3].banned, false); ok('Эзэн банг цуцална');
  r = await call(1, 'POST', '/anticheat/users/1/ban', {}); assert.equal(r.status, 400); ok('Эзэн өөрийгөө бандахгүй');
  // 7) «Цаашид үл тоох»: memory sig / DLL нэр — дахин хэрэг үүсгэхгүй; Room ADMIN үл тоох жагсаалт нэмж чадахгүй
  r = await call(6, 'POST', '/anticheat/report', { kind: 'memory', tool: 'Game.dll', detail: { sig: 'aa:0011|bb:22' } }); j = await r.json(); const mid = j.case_id; assert.ok(mid);
  r = await call(4, 'POST', `/anticheat/cases/${mid}/dismiss`, { note: 'цэвэр Game.dll', ignore: true }); j = await r.json(); assert.equal(j.ignored, 1);
  r = await call(6, 'POST', '/anticheat/report', { kind: 'memory', tool: 'Game.dll', detail: { sig: 'aa:0011|bb:22' } }); j = await r.json(); assert.equal(j.case_id, null); ok('Үл тоох Game.dll өөрчлөлт дахин хэрэг үүсгэхгүй');
  r = await call(6, 'POST', '/anticheat/report', { kind: 'module', tool: '2 DLL', detail: { modules: ['C:\\x\\Over.dll', 'C:\\x\\b.dll'] } }); j = await r.json(); const modId = j.case_id;
  r = await call(1, 'POST', `/anticheat/cases/${modId}/dismiss`, { ignore: true }); j = await r.json(); assert.equal(j.ignored, 2);
  const before = cases.length;
  r = await call(6, 'POST', '/anticheat/report', { kind: 'module', tool: '2 DLL', detail: { modules: ['D:\\y\\over.dll', 'D:\\y\\evil.dll'] } }); j = await r.json();
  assert.equal(cases.length, before + 1); assert.deepEqual(cases[cases.length - 1].detail.modules, ['D:\\y\\evil.dll']); assert.equal(cases[cases.length - 1].tool, '1 танигдаагүй DLL'); ok('Үл тоосон DLL хасагдаж зөвхөн шинэ DLL хэрэгт орно');
  r = await call(6, 'POST', '/anticheat/report', { kind: 'memory', tool: 'Game.dll', detail: { sig: 'room-test' } }); j = await r.json();
  cases.find((c) => c.id === j.case_id).room_id = 901;
  r = await call(5, 'POST', `/anticheat/cases/${j.case_id}/dismiss`, { ignore: true }); j = await r.json(); assert.equal(j.ignored, 0); assert.equal(ignores.has('memory|room-test'), false); ok('Room ADMIN үл тоох жагсаалтад нэмж чадахгүй');
  // ── Шалгагдаагүй WC3 (unverified): DM анхааруулга + 3 дахь удаад эскалаци (эзэн 2026-10-09) ──
  const dms = [];
  acc.setSystemDM(async (uid, text) => { dms.push({ uid: String(uid), text }); return true; });
  const unvNotified = () => emitted.filter((e) => e.ev === 'staff:notify' && e.d.kind === 'unverified');
  const n0 = unvNotified().length;
  r = await call(3, 'POST', '/anticheat/report', { kind: 'unverified', tool: 'WC3 админ', detail: { reason: 'Access is denied', cause: 'RUNASADMIN: war3.exe', sig: 'unverified' } }); j = await r.json();
  const uc = cases.find((c) => c.id === j.case_id);
  assert.equal(dms.length, 1); assert.equal(dms[0].uid, '3'); assert.match(dms[0].text, /Run this program as an administrator/); assert.match(dms[0].text, /RUNASADMIN: war3\.exe/); assert.match(dms[0].text, /бан авч болно/);
  assert.ok(uc.detail.warned_at); assert.equal(uc.detail.warn_count, 1); ok('unverified хэрэг → тоглогчид DM анхааруулга (шалтгаан + засах заавар + бан сануулга)');
  await call(3, 'POST', '/anticheat/report', { kind: 'unverified', tool: 'WC3 админ', detail: { reason: 'Access is denied', sig: 'unverified' } });
  assert.equal(dms.length, 1); assert.equal(uc.hits, 2); assert.ok(uc.detail.warned_at); ok('12 цагийн дотор давтвал DM дахин илгээхгүй, warned_at хадгалагдана (detail солигдсон ч)');
  await call(3, 'POST', '/anticheat/report', { kind: 'unverified', tool: 'WC3 админ', detail: { reason: 'Access is denied', sig: 'unverified' } });
  assert.equal(uc.hits, 3); assert.equal(uc.severity, 'high'); assert.equal(unvNotified().filter((e) => e.to === 1 && /3 удаа/.test(e.d.tool)).length, 1); assert.equal(unvNotified().filter((e) => e.to === 1 && /3 удаа/.test(e.d.tool))[0].d.severity, 'high'); ok('3 дахь удаад хэрэг «high» болж ADMIN-д дахин мэдэгдэнэ (автомат бан үгүй)');
  uc.detail.warned_at = Date.now() - 25 * 3600e3; acc._warnedAt.clear();
  await acc.warnPendingOnConnect(3);
  assert.equal(dms.length, 2); ok('24 цагийн дараа дахин холбогдоход сануулга дахин очно');
  await acc.warnPendingOnConnect(3); assert.equal(dms.length, 2); ok('саяхан сануулсан бол холбогдоход давхар илгээхгүй');
  srv.close();
  console.log(`\n=== accases: ${pass} PASS ===`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
