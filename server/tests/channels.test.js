'use strict';
// Нийтийн Room 1–20 + Moderator: багтаамж (200 харагдах / Premium нөөц slot), Moderator хүсэлт→батлах,
// нийтийн Room-д LAN нээх эрх, бэхэлсэн зарлал (ажилтан), гишүүдийн идэвх (ажилтан).
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');
const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
function clearSrc() { const p = path.join(serverDir, 'src'); for (const k of Object.keys(require.cache)) if (k.startsWith(p)) delete require.cache[k]; }
const tok = (u) => jwt.sign(u, 'test-secret', { expiresIn: '1h' });
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
const future = new Date(Date.now() + 864e5).toISOString();

// Хуурамч DB төлөв
const users = { 1: { id: 1, username: 'owner' }, 2: { id: 2, username: 'bronze', membership: 'bronze' }, 3: { id: 3, username: 'silver', membership: 'silver', membership_until: future } };
const channel = { id: 901, name: 'WC3 Room 1', kind: 'channel', status: 'waiting', has_password: false, max_players: 300, visible_cap: 200, host_id: null, clan_id: null };
let channelCount = 200;               // одоо өрөөнд байгаа хүн
const roles = new Map();              // user_id -> role
const requests = [];                  // { id, user_id, role, note, status }
let notice = '';
let autoUntilVal = null;              // platform_settings.mod_auto_approve_until

async function query(sql, p = []) {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('SELECT 1') && !s.includes('FROM')) return { rows: [{}] };
  if (s.includes('FROM admin_whitelist')) return { rows: [] };
  if (s.includes('SELECT id, username, membership, membership_until')) return { rows: [users[p[0]]].filter(Boolean) };
  if (s.includes('SELECT COALESCE(banned,FALSE) AS banned, ban_reason FROM users')) return { rows: [{ banned: false }] };
  if (s.includes('SELECT COALESCE(banned,FALSE) AS banned FROM users')) return { rows: [{ banned: false }] };
  if (s.startsWith('SELECT * FROM rooms WHERE id = $1')) return { rows: String(p[0]) === '901' ? [channel] : [] };
  if (s.includes('JOIN room_players rp ON r.id = rp.room_id WHERE rp.user_id = $1')) return { rows: [] };
  if (s.startsWith('SELECT COUNT(*) FROM room_players WHERE room_id = $1')) return { rows: [{ count: String(channelCount) }] };
  if (s.startsWith('INSERT INTO room_players')) { channelCount++; return { rows: [], rowCount: 1 }; }
  if (s.includes('SELECT role FROM platform_roles WHERE user_id')) return { rows: roles.has(Number(p[0])) ? [{ role: roles.get(Number(p[0])) }] : [] };
  if (s.includes("FROM role_requests WHERE user_id = $1 AND status = 'pending'")) return { rows: requests.filter((r) => r.user_id === Number(p[0]) && r.status === 'pending') };
  if (s.includes("SELECT COUNT(*)::int AS n FROM role_requests WHERE status = 'pending'")) return { rows: [{ n: requests.filter((r) => r.status === 'pending').length }] };
  if (s.startsWith('INSERT INTO role_requests')) {
    if (requests.some((r) => r.user_id === Number(p[0]) && r.status === 'pending')) return { rows: [] };
    const r = { id: requests.length + 1, user_id: Number(p[0]), role: 'moderator', note: p[1], status: 'pending' }; requests.push(r); return { rows: [{ id: r.id, created_at: new Date() }] };
  }
  if (s.includes("SELECT id, user_id, role FROM role_requests WHERE id = $1 AND status = 'pending'")) return { rows: requests.filter((r) => r.id === Number(p[0]) && r.status === 'pending') };
  if (s.includes('FROM platform_settings')) return { rows: autoUntilVal ? [{ value: autoUntilVal }] : [] };
  if (s.startsWith('INSERT INTO platform_settings')) { if (!s.includes('DO NOTHING')) autoUntilVal = p[0]; return { rows: [] }; }
  if (s.startsWith("UPDATE role_requests SET status = 'approved'")) { const r = requests.find((x) => x.id === Number(p[0]) && x.status === 'pending'); if (r) r.status = 'approved'; return { rows: [] }; }
  if (s.includes("FROM role_requests rq JOIN users u ON u.id = rq.user_id WHERE rq.status = 'pending' AND rq.role = 'moderator'")) return { rows: requests.filter((x) => x.status === 'pending') };
  if (s.startsWith('UPDATE role_requests SET status = $2')) { const r = requests.find((x) => x.id === Number(p[0])); if (r) r.status = p[1]; return { rows: [] }; }
  if (s.startsWith('INSERT INTO platform_roles')) { roles.set(Number(p[0]), p[1]); return { rows: [] }; }
  if (s.startsWith('DELETE FROM platform_roles WHERE user_id')) { const had = roles.delete(Number(p[0])); return { rows: had ? [{ role: 'x' }] : [], rowCount: had ? 1 : 0 }; }
  if (s.includes('SELECT id, username, discord_id, COALESCE(banned,FALSE) AS banned FROM users WHERE id')) return { rows: [users[p[0]]].filter(Boolean).map((u) => ({ ...u, banned: false })) };
  if (s.includes('SELECT id, username, discord_id FROM users WHERE id')) return { rows: [users[p[0]]].filter(Boolean) };
  if (s.includes("SELECT COALESCE(kind,'room') AS kind, game_type FROM rooms WHERE id=$1")) return { rows: String(p[0]) === '901' ? [{ kind: 'channel', game_type: 'Warcraft III: The Frozen Throne' }] : String(p[0]) === '941' ? [{ kind: 'channel', game_type: 'Counter-Strike 1.6' }] : [{ kind: 'room' }] };
  if (s.includes("SELECT COALESCE(kind,'room') AS kind, game_type FROM rooms WHERE id = $1")) return { rows: String(p[0]) === '901' ? [{ kind: 'channel', game_type: 'Warcraft III: The Frozen Throne' }] : [{ kind: 'room' }] };
  if (s.includes("SELECT COALESCE(kind,'room') AS kind FROM rooms WHERE id=$1")) return { rows: String(p[0]) === '901' ? [{ kind: 'channel' }] : [{ kind: 'room' }] };
  if (s.includes('FROM room_players rp JOIN rooms r') || s.includes('isUserInRoom')) return { rows: [{}] };
  if (s.startsWith('UPDATE rooms SET pinned_notice')) { notice = p[1]; return { rows: [{ id: 901 }] }; }
  return { rows: [], rowCount: 0 };
}

async function main() {
  const port = 6150 + Math.floor(Math.random() * 40);
  Object.assign(process.env, { PORT: String(port), JWT_SECRET: 'test-secret', NODE_ENV: 'test', SKIP_DB_MIGRATIONS: 'true', OWNER_USER_IDS: '1', LAN_RELAY_IP: '127.0.0.1', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb' });
  clearSrc();
  require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query } };
  const srv = require(path.join(serverDir, 'src', 'index.js'));
  await srv.start(port);
  const call = (uid, method, p, body) => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { Authorization: `Bearer ${tok({ id: uid, username: users[uid].username })}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

  // Багтаамж
  let r = await call(2, 'POST', '/rooms/901/join', {}); let j = await r.json();
  assert.equal(r.status, 403); assert.equal(j.code, 'PREMIUM_SLOT'); ok('200/200 дүүрсэн Room-д Bronze орохгүй (PREMIUM_SLOT)');
  r = await call(3, 'POST', '/rooms/901/join', {}); assert.equal(r.status, 200); ok('Silver Premium нөөц slot-оор орно');
  channelCount = 300; r = await call(3, 'POST', '/rooms/901/join', {}); assert.equal(r.status, 400); ok('300 бодит дээд хязгаарт Premium ч орохгүй');
  channelCount = 150; r = await call(2, 'POST', '/rooms/901/join', {}); assert.equal(r.status, 200); ok('Сул Room-д Bronze орно');

  // Moderator: LAN нээх эрх, хүсэлт → батлах
  r = await call(2, 'POST', '/rooms/901/lan-host/begin'); j = await r.json();
  assert.equal(r.status, 403); assert.equal(j.code, 'MODERATOR_REQUIRED'); ok('Moderator-гүй хүн нийтийн Room-д LAN нээж чадахгүй');
  r = await call(2, 'POST', '/rooms/901/lan-host/announce', { game_token: 'selfmadetoken1234', gameinfo_b64: 'AAAA' }); j = await r.json();
  assert.equal(r.status, 403); assert.equal(j.code, 'MODERATOR_REQUIRED'); ok('/announce-аар Moderator эрхийг тойрч чадахгүй');
  r = await call(2, 'POST', '/roles/request', { note: 'идэвхтэй тоглогч' }); assert.equal(r.status, 200); ok('Moderator хүсэлт илгээнэ');
  r = await call(2, 'POST', '/roles/request', { note: 'дахин' }); assert.equal(r.status, 409); ok('Давхар хүсэлт хориглоно');
  r = await call(2, 'GET', '/roles/requests'); assert.equal(r.status, 403); ok('Энгийн хэрэглэгч хүсэлтүүдийг харахгүй');
  r = await call(2, 'POST', '/roles/requests/1/approve'); assert.equal(r.status, 403); ok('Энгийн хэрэглэгч батлахгүй');
  r = await call(1, 'POST', '/roles/requests/1/approve'); assert.equal(r.status, 200); assert.equal(roles.get(2), 'moderator'); ok('Эзэн батална → Moderator');
  r = await call(2, 'GET', '/roles/me'); j = await r.json(); assert.equal(j.can_host_channel, true); ok('/roles/me: can_host_channel');
  r = await call(2, 'POST', '/rooms/901/lan-host/begin'); assert.notEqual(r.status, 403); ok('Moderator нийтийн Room-д LAN нээнэ');
  if (r.status === 200) {
    const bj = await r.json();
    r = await call(1, 'POST', '/rooms/901/lan-host/announce', { game_token: bj.game_token, gameinfo_b64: 'AAAA' }); j = await r.json();
    assert.equal(r.status, 403); assert.equal(j.code, 'TOKEN_NOT_ISSUED'); ok('Бусдын /begin токеныг өөр хүн зарлаж чадахгүй');
    r = await call(2, 'POST', '/rooms/901/lan-host/announce', { game_token: bj.game_token, gameinfo_b64: 'AAAA', host_wc3_name: 'HostName' }); assert.equal(r.status, 200); ok('Эзэн нь токеноо зарлана');
    r = await call(3, 'POST', `/rooms/901/lan-host/${bj.game_token}/join`, { wc3_name: 'hostname' }); assert.equal(r.status, 409); ok('Joiner хостын WC3 нэрийг авч чадахгүй');
    r = await call(3, 'POST', '/rooms/901/lan-host/unknowntoken/join', { wc3_name: 'x' }); assert.equal(r.status, 404); ok('Үл мэдэгдэх токенд join бүртгэхгүй');
  }
  r = await call(1, 'POST', '/rooms/941/lan-host/begin'); j = await r.json(); assert.equal(j.code, 'GAME_NOT_READY'); ok('CS 1.6 Room-д WC3 LAN relay нээгдэхгүй');

  // Зарлал
  r = await call(2, 'PATCH', '/rooms/901/notice', { notice: 'hack' }); assert.equal(r.status, 403); ok('Энгийн хэрэглэгч зарлал засахгүй');
  r = await call(1, 'PATCH', '/rooms/901/notice', { notice: 'Сайн байна уу' }); assert.equal(r.status, 200); assert.equal(notice, 'Сайн байна уу'); ok('Эзэн зарлал засна');

  // Гишүүдийн идэвх
  r = await call(3, 'GET', '/roles/activity'); assert.equal(r.status, 403); ok('Гишүүдийн идэвх зөвхөн ажилтанд');
  // Баруун товчны цол: эзэн ADMIN өгнө, админ зөвхөн Moderator, эзэнд/админд хүрэхгүй
  r = await call(2, 'POST', '/roles/set/3', { role: 'moderator' }); assert.equal(r.status, 403); ok('Moderator өөр хүнд цол өгч чадахгүй');
  r = await call(1, 'POST', '/roles/set/3', { role: 'admin' }); assert.equal(r.status, 200); ok('Эзэн ADMIN цол өгнө');
  r = await call(3, 'GET', '/roles/activity'); assert.notEqual(r.status, 403); ok('Шинэ ADMIN ажилтны эрхтэй болно (кэш)');
  r = await call(3, 'POST', '/roles/set/2', { role: 'admin' }); assert.equal(r.status, 403); ok('Админ ADMIN цол өгч чадахгүй');
  r = await call(3, 'POST', '/roles/set/2', { role: null }); assert.equal(r.status, 200); assert.equal(roles.has(2), false); ok('Админ Moderator хураана');
  r = await call(3, 'POST', '/roles/set/1', { role: null }); assert.equal(r.status, 403); ok('Эзний цолд хүрэхгүй');
  r = await call(1, 'POST', '/roles/set/3', { role: null }); assert.equal(r.status, 200); ok('Эзэн ADMIN хураана');
  r = await call(3, 'GET', '/roles/activity'); assert.equal(r.status, 403); ok('Хураасны дараа ажилтны эрхгүй');
  // ADMIN апп-аас Moderator хүсэлт батална
  r = await call(1, 'POST', '/roles/set/3', { role: 'admin' }); assert.equal(r.status, 200);
  r = await call(2, 'POST', '/roles/request', { note: 'дахин хүсье' }); j = await r.json(); assert.equal(r.status, 200); assert.ok(!j.auto); ok('Автомат унтраалттай үед хүсэлт хүлээгдэнэ');
  r = await call(3, 'POST', `/roles/requests/${j.id}/approve`); assert.equal(r.status, 200); assert.equal(roles.get(2), 'moderator'); ok('ADMIN Moderator хүсэлтийг батална');
  // Автомат батлалт (7 хоног) — зөвхөн эзэн асаана
  r = await call(3, 'POST', '/roles/auto', { days: 7 }); assert.equal(r.status, 403); ok('ADMIN автомат батлалтыг асааж чадахгүй');
  r = await call(1, 'POST', '/roles/auto', { days: 7 }); j = await r.json(); assert.equal(r.status, 200); assert.equal(j.active, true); ok('Эзэн автомат батлалтыг 7 хоног асаана');
  r = await call(3, 'GET', '/roles/auto'); j = await r.json(); assert.equal(j.active, true); assert.equal(j.can_edit, false); ok('ADMIN төлөвийг харна (засахгүй)');
  r = await call(1, 'POST', '/roles/set/2', { role: null }); assert.equal(r.status, 200);
  r = await call(2, 'POST', '/roles/request', { note: 'авто' }); j = await r.json(); assert.equal(j.auto, true); assert.equal(roles.get(2), 'moderator'); ok('Автомат үед хүсэлт шууд батлагдана');
  r = await call(1, 'POST', '/roles/auto', { days: 0 }); j = await r.json(); assert.equal(j.active, false); ok('Эзэн автомат батлалтыг унтраана');
  console.log(`=== channels: ${pass} PASS ===`);
  process.exit(0);
}
main().catch((e) => { console.error('FAIL', e); process.exit(1); });
