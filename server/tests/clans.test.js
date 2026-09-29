'use strict';
// Кланууд: GOLD-оор байгуулах, хүсэлт → батлах, Lord/Admin эрхийн хязгаар, кланы өрөөнд зөвхөн гишүүд.
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
const tok = (u) => jwt.sign(u, 'test-secret', { expiresIn: '1h' });
let pass = 0;
const ok = (n) => { pass++; console.log('PASS ' + n); };

// ── Жижиг төлөвтэй хуурамч DB (clans.js / rooms.js-ийн ашигладаг query-нууд) ──
const future = new Date(Date.now() + 864e5).toISOString();
const S = {
  users: [
    { id: 1, username: 'bronzeguy', membership: 'bronze' },
    { id: 2, username: 'goldlord', membership: 'gold', membership_until: future },
    { id: 3, username: 'joiner', membership: 'bronze' },
    { id: 4, username: 'extra', membership: 'bronze' },
    { id: 5, username: 'goldtwo', membership: 'gold', membership_until: future },
  ],
  clans: [], members: [], requests: [], seq: { clan: 0, req: 0 },
  discord: [{ id: 7, name: 'LoD', invite_url: 'https://discord.gg/x', added_by_id: 2, guild_id: '99', guild_icon: 'abc' }],
  rooms: [{ id: 50, name: 'clan room', status: 'waiting', clan_id: null, host_id: 2, max_players: 10 }],
  sqlLog: [],
};
const role = (c, u) => S.members.find((m) => m.clan_id == c && m.user_id == u)?.role || null;
const user = (id) => S.users.find((u) => u.id == id);
const q = async (sql, p = []) => {
  S.sqlLog.push(sql);
  const has = (s) => sql.includes(s);
  if (has('SELECT 1') && !has('FROM')) return { rows: [{}] };
  if (has('FROM admin_whitelist')) return { rows: [] };
  if (has('SELECT id, username, membership, membership_until')) return { rows: [user(p[0])].filter(Boolean) };
  if (has('SELECT role FROM clan_members WHERE clan_id = $1 AND user_id = $2')) { const r = role(p[0], p[1]); return { rows: r ? [{ role: r }] : [] }; }
  if (has("SELECT 1 FROM clan_members WHERE user_id = $1 AND role = 'lord'")) return { rows: S.members.filter((m) => m.user_id == p[0] && m.role === 'lord') };
  if (has('SELECT * FROM discord_servers WHERE id = $1')) return { rows: S.discord.filter((d) => d.id == p[0]) };
  if (has('SELECT 1 FROM clans WHERE LOWER(name)')) return { rows: S.clans.filter((c) => c.name.toLowerCase() === p[0].toLowerCase() || c.tag.toLowerCase() === p[1].toLowerCase()) };
  if (has('INSERT INTO clans')) { const c = { id: ++S.seq.clan, name: p[0], tag: p[1], description: p[2], kind: p[3], discord_server_id: p[4], guild_id: p[5], invite_url: p[6], icon_url: p[7], join_mode: p[8], owner_id: p[9] }; S.clans.push(c); return { rows: [c] }; }
  if (has('INSERT INTO clan_members')) { if (!role(p[0], p[1])) S.members.push({ clan_id: Number(p[0]), user_id: Number(p[1]), role: has("'lord'") ? 'lord' : 'member' }); return { rows: [] }; }
  if (has('FROM clans c LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = $1')) { const c = S.clans.find((x) => x.id == p[0]); return { rows: c ? [{ ...c, member_count: S.members.filter((m) => m.clan_id == c.id).length }] : [] }; }
  if (has('INSERT INTO clan_requests')) { if (!S.requests.some((r) => r.clan_id == p[0] && r.user_id == p[1] && r.status === 'pending')) S.requests.push({ id: ++S.seq.req, clan_id: Number(p[0]), user_id: Number(p[1]), status: 'pending' }); return { rows: [] }; }
  if (has("SELECT user_id FROM clan_members WHERE clan_id = $1 AND role IN")) return { rows: S.members.filter((m) => m.clan_id == p[0] && m.role !== 'member') };
  if (has('FROM clan_members m JOIN users u')) return { rows: S.members.filter((m) => m.clan_id == p[0]).map((m) => ({ id: String(m.user_id), username: user(m.user_id).username, role: m.role })) };
  if (has('FROM clan_requests q JOIN users u')) return { rows: S.requests.filter((r) => r.clan_id == p[0] && r.status === 'pending').map((r) => ({ id: r.id, user_id: String(r.user_id), username: user(r.user_id).username })) };
  if (has("SELECT 1 FROM clan_requests WHERE clan_id = $1 AND user_id = $2 AND status = 'pending'")) return { rows: S.requests.filter((r) => r.clan_id == p[0] && r.user_id == p[1] && r.status === 'pending') };
  if (has("SELECT * FROM clan_requests WHERE id = $1")) return { rows: S.requests.filter((r) => r.id == p[0] && r.clan_id == p[1] && r.status === 'pending') };
  if (has('UPDATE clan_requests SET status = $1')) { const r = S.requests.find((x) => x.id == p[2]); if (r) r.status = p[0]; return { rows: [] }; }
  if (has('UPDATE clan_requests SET status')) return { rows: [] };
  if (has('SELECT id, username FROM users WHERE LOWER(username)')) return { rows: S.users.filter((u) => u.username.toLowerCase() === String(p[0]).toLowerCase()) };
  if (has('SELECT id, username FROM users WHERE id')) return { rows: [user(p[0])].filter(Boolean) };
  if (has('DELETE FROM clan_members WHERE clan_id = $1 AND user_id = $2')) { S.members = S.members.filter((m) => !(m.clan_id == p[0] && m.user_id == p[1])); return { rows: [] }; }
  if (has('UPDATE clan_members SET role = $1')) { const m = S.members.find((x) => x.clan_id == p[1] && x.user_id == p[2]); if (m) m.role = p[0]; return { rows: [] }; }
  if (has('SELECT clan_id FROM clan_members WHERE user_id = $1')) return { rows: S.members.filter((m) => m.user_id == p[0]) };
  if (has('FROM clan_members m JOIN clans c')) return { rows: S.members.filter((m) => m.user_id == p[0]).map((m) => ({ ...S.clans.find((c) => c.id === m.clan_id), role: m.role })) };
  // rooms.js
  if (has('SELECT COALESCE(banned')) return { rows: [{ banned: false }] };
  if (has('SELECT * FROM rooms WHERE id = $1')) return { rows: S.rooms.filter((r) => r.id == p[0]) };
  if (has('FROM rooms r') && has('LEFT JOIN clans c')) return { rows: [] };
  return { rows: [], rowCount: 0 };
};

async function main() {
  const port = 5400 + Math.floor(Math.random() * 200);
  Object.assign(process.env, { PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb' });
  clearSrc();
  require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query: q } };
  const srv = require(path.join(serverDir, 'src', 'index.js'));
  await srv.start(port);
  const base = `http://127.0.0.1:${port}`;
  const call = async (uid, method, p, body) => {
    const r = await fetch(base + p, { method, headers: { Authorization: `Bearer ${tok({ id: uid, username: user(uid).username })}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  let r = await call(1, 'POST', '/clans', { name: 'Bronze Clan', tag: 'BRZ' });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'TIER_REQUIRED');
  ok('Bronze клан байгуулж чадахгүй (GOLD шаардлагатай)');

  r = await call(2, 'POST', '/clans', { name: 'Mongol Lords', tag: 'MNL', description: 'test' });
  assert.equal(r.status, 201); const cid = r.body.id; assert.equal(role(cid, 2), 'lord');
  r = await call(2, 'POST', '/clans', { name: 'Second', tag: 'SEC' });
  assert.equal(r.status, 409);
  ok('GOLD клан байгуулна, үүсгэгч = Lord, нэг Lord нэг клан');

  r = await call(3, 'POST', `/clans/${cid}/join`, { message: 'hi' });
  assert.equal(r.body.status, 'pending'); assert.equal(role(cid, 3), null);
  r = await call(3, 'GET', `/clans/${cid}`);
  assert.equal(r.body.requests.length, 0, 'гишүүн биш хүн хүсэлтүүдийг харахгүй');
  r = await call(2, 'GET', `/clans/${cid}`);
  assert.equal(r.body.requests.length, 1);
  const rid = r.body.requests[0].id;
  r = await call(3, 'POST', `/clans/${cid}/requests/${rid}/accept`);
  assert.equal(r.status, 403, 'өөрийгөө батлахгүй');
  r = await call(2, 'POST', `/clans/${cid}/requests/${rid}/accept`);
  assert.equal(r.status, 200); assert.equal(role(cid, 3), 'member');
  ok('Хүсэлт → Lord батлав → гишүүн');

  r = await call(3, 'POST', `/clans/${cid}/members`, { username: 'extra' });
  assert.equal(r.status, 403, 'энгийн гишүүн нэмэхгүй');
  r = await call(2, 'PATCH', `/clans/${cid}/members/3`, { role: 'admin' });
  assert.equal(r.status, 200); assert.equal(role(cid, 3), 'admin');
  r = await call(3, 'POST', `/clans/${cid}/members`, { username: 'extra' });
  assert.equal(r.status, 200); assert.equal(role(cid, 4), 'member');
  r = await call(3, 'DELETE', `/clans/${cid}/members/2`);
  assert.equal(r.status, 403, 'админ Lord-ыг хасахгүй');
  r = await call(3, 'PATCH', `/clans/${cid}/members/4`, { role: 'admin' });
  assert.equal(r.status, 403, 'админ эрх олгохгүй');
  r = await call(3, 'DELETE', `/clans/${cid}/members/4`);
  assert.equal(r.status, 200); assert.equal(role(cid, 4), null);
  r = await call(2, 'POST', `/clans/${cid}/leave`);
  assert.equal(r.status, 409, 'Lord шууд гарахгүй');
  ok('Admin нэмэх/хасах; Lord-ыг хасах, эрх олгох эрхгүй; Lord гарахгүй');

  S.rooms[0].clan_id = cid;
  r = await call(1, 'POST', '/rooms/50/join', {});
  assert.equal(r.status, 403); assert.equal(r.body.code, 'CLAN_ONLY');
  r = await call(1, 'POST', '/rooms', { name: 'x', game_type: 'W3', clan_id: cid });
  assert.equal(r.status, 403); assert.equal(r.body.code, 'CLAN_ONLY');
  S.sqlLog.length = 0;
  await call(3, 'GET', '/rooms');
  assert.ok(S.sqlLog.some((s) => s.includes('r.clan_id IS NULL OR r.clan_id = ANY($1::int[])')), 'жагсаалт кланы өрөөг шүүнэ');
  const qm = require('node:fs').readFileSync(path.join(serverDir, 'src', 'routes', 'rooms.js'), 'utf8');
  assert.ok(/has_password=FALSE AND r\.clan_id IS NULL/.test(qm), 'quickmatch кланы өрөөнд оруулахгүй');
  ok('Кланы өрөө: гадны хүн нэгдэх/үүсгэхгүй, жагсаалт шүүгдэнэ, quickmatch алгасна');

  r = await call(5, 'POST', '/clans', { name: 'LoD Discord', tag: 'LOD', kind: 'discord', discord_server_id: 7 });
  assert.equal(r.status, 403, 'бусдын Discord серверийг клан болгохгүй');
  S.members = S.members.filter((m) => m.clan_id !== cid);   // goldlord-ын Lord-ыг чөлөөлөх (нэг Lord нэг клан)
  r = await call(2, 'POST', '/clans', { name: 'LoD Discord', tag: 'LOD', kind: 'discord', discord_server_id: 7 });
  assert.equal(r.status, 201); assert.equal(r.body.kind, 'discord'); assert.ok(String(r.body.icon_url).includes('/icons/99/abc'));
  ok('Discord серверийн клан: зөвхөн серверийг бүртгүүлсэн хүн');

  console.log(`=== clans: ${pass} PASS ===`);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
