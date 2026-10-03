'use strict';
// Кланы урилга (routes/clans.js): POST /:id/invite (Lord/админ), GET /invites, POST /invites/:iid/accept|decline, clan:updated мэдэгдэл.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'test-secret', SKIP_DB_MIGRATIONS: 'true' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };

const users = { 1: 'Lord', 2: 'Member', 3: 'Target', 4: 'Other' };
const members = [{ clan_id: 10, user_id: 1, role: 'lord' }, { clan_id: 10, user_id: 2, role: 'member' }];
const invites = []; let seq = 0;
async function query(sql, p = []) {
  const s = sql.replace(/\s+/g, ' ').trim();
  if (s === 'SELECT 1') return { rows: [{}] };
  if (s.startsWith('SELECT role FROM clan_members WHERE clan_id = $1 AND user_id = $2')) { const m = members.find((x) => String(x.clan_id) === String(p[0]) && String(x.user_id) === String(p[1])); return { rows: m ? [{ role: m.role }] : [] }; }
  if (s.startsWith('SELECT id, username FROM users WHERE id = $1')) return { rows: users[p[0]] ? [{ id: Number(p[0]), username: users[p[0]] }] : [] };
  if (s.startsWith('SELECT name FROM clans WHERE id = $1')) return { rows: String(p[0]) === '10' ? [{ name: 'Mongol Legends' }] : [] };
  if (s.startsWith('INSERT INTO clan_invites')) {
    let i = invites.find((x) => String(x.clan_id) === String(p[0]) && String(x.user_id) === String(p[1]) && x.status === 'pending');
    if (i) i.invited_by = p[2]; else { i = { id: ++seq, clan_id: Number(p[0]), user_id: Number(p[1]), invited_by: p[2], status: 'pending', created_at: new Date() }; invites.push(i); }
    return { rows: [{ id: i.id }] };
  }
  if (s.includes('FROM clan_invites i JOIN clans c')) return { rows: invites.filter((x) => x.user_id === Number(p[0]) && x.status === 'pending').map((x) => ({ id: x.id, clan_id: x.clan_id, clan_name: 'Mongol Legends', clan_tag: 'MNL', by_username: users[x.invited_by], created_at: x.created_at })) };
  if (s.startsWith("SELECT * FROM clan_invites WHERE id = $1 AND user_id = $2 AND status = 'pending'")) return { rows: invites.filter((x) => String(x.id) === String(p[0]) && x.user_id === Number(p[1]) && x.status === 'pending') };
  if (s.startsWith('UPDATE clan_invites SET status')) { const i = invites.find((x) => x.id === Number(p[1])); if (i) i.status = p[0]; return { rows: [] }; }
  if (s.startsWith('INSERT INTO clan_members')) { if (!members.some((m) => m.clan_id === Number(p[0]) && m.user_id === Number(p[1]))) members.push({ clan_id: Number(p[0]), user_id: Number(p[1]), role: 'member' }); return { rows: [] }; }
  if (s.startsWith("SELECT user_id FROM clan_members WHERE clan_id = $1 AND role IN ('lord','admin')")) return { rows: members.filter((m) => String(m.clan_id) === String(p[0]) && (m.role === 'lord' || m.role === 'admin')).map((m) => ({ user_id: m.user_id })) };
  return { rows: [], rowCount: 0 };
}
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query } };

(async () => {
  const express = require('express');
  const clans = require(path.join(serverDir, 'src', 'routes', 'clans.js'));
  const sent = [];
  clans.setIO({ to: (room) => ({ emit: (ev, d) => sent.push({ room, ev, d }) }) });
  const app = express(); app.use(express.json()); app.use('/clans', clans.router);
  const srv = http.createServer(app); await new Promise((r) => srv.listen(0, r));
  const port = srv.address().port;
  const call = (uid, method, p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { Authorization: `Bearer ${jwt.sign({ id: uid, username: users[uid] }, 'test-secret')}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  let r = await call(2, 'POST', '/clans/10/invite', { user_id: 3 }); assert.equal(r.status, 403); ok('Энгийн гишүүн урьж чадахгүй');
  r = await call(1, 'POST', '/clans/10/invite', { user_id: 2 }); assert.equal(r.status, 409); ok('Аль хэдийн гишүүн бол 409');
  r = await call(1, 'POST', '/clans/10/invite', { user_id: 1 }); assert.equal(r.status, 400); ok('Өөрийгөө урихгүй');
  r = await call(1, 'POST', '/clans/10/invite', { user_id: 99 }); assert.equal(r.status, 404); ok('Байхгүй хэрэглэгч 404');
  r = await call(1, 'POST', '/clans/10/invite', { user_id: 3 }); let j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.username, 'Target'); assert.equal(j.clan_name, 'Mongol Legends');
  assert.ok(sent.some((x) => x.room === 'user:3' && x.ev === 'clan:updated' && x.d.invite && x.d.by_username === 'Lord')); ok('Lord урина → хүлээн авагчид clan:updated {invite}');
  r = await call(1, 'POST', '/clans/10/invite', { user_id: 3 }); assert.equal(r.status, 200); assert.equal(invites.filter((x) => x.status === 'pending').length, 1); ok('Дахин урихад давхардахгүй');
  r = await call(3, 'GET', '/clans/invites'); j = await r.json(); assert.equal(j.invites.length, 1); assert.equal(j.invites[0].clan_tag, 'MNL'); ok('GET /invites — хүлээгдэж буй урилга');
  const iid = j.invites[0].id;
  r = await call(4, 'POST', `/clans/invites/${iid}/accept`); assert.equal(r.status, 404); ok('Бусдын урилгыг хүлээн авахгүй');
  sent.length = 0;
  r = await call(3, 'POST', `/clans/invites/${iid}/accept`); j = await r.json(); assert.equal(j.accepted, true);
  assert.ok(members.some((m) => m.clan_id === 10 && m.user_id === 3)); assert.ok(sent.some((x) => x.room === 'user:1' && x.d.invite_answer === 'accepted' && x.d.from_username === 'Target')); ok('Хүлээн авбал гишүүн болж, Lord-д мэдэгдэнэ');
  r = await call(3, 'POST', `/clans/invites/${iid}/accept`); assert.equal(r.status, 404); ok('Нэг урилгыг дахин ашиглахгүй');
  r = await call(1, 'POST', '/clans/10/invite', { user_id: 4 }); const iid2 = (await (await call(4, 'GET', '/clans/invites')).json()).invites[0].id;
  r = await call(4, 'POST', `/clans/invites/${iid2}/decline`); j = await r.json(); assert.equal(j.accepted, false); assert.ok(!members.some((m) => m.user_id === 4)); ok('Татгалзвал гишүүн болохгүй');
  srv.close();
  console.log(`\n=== claninvite: ${pass} PASS ===`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
