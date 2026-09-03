// !maphack тайлангийн API (/anticheat/list, /anticheat/reset) — DB-г дуурайж, route handler-уудыг шууд дуудна
const assert = require('assert');
const path = require('path');
process.env.TIERBOT_API_KEY = 'shared-key-123';

// ── DB stub: query(sql, params) → SQL-ийн агуулгаар хариулна ──
const calls = [];
const state = { users: [
  { id: 7, username: 'Cheater', discord_id: '111111111111111111', wc3_name: 'chtr', maphack_warnings: 3, banned: true, ban_reason: 'MapHack: xenon', banned_at: '2026-09-03T10:00:00Z' },
  { id: 8, username: 'Warned', discord_id: null, wc3_name: null, maphack_warnings: 1, banned: false, ban_reason: null, banned_at: null },
  { id: 9, username: 'Manual', discord_id: '222222222222222222', wc3_name: null, maphack_warnings: 2, banned: true, ban_reason: 'Гараар: зүй бус үг', banned_at: '2026-09-01T10:00:00Z' },
] };
const fakeDb = {
  async query(sql, params = []) {
    calls.push({ sql, params });
    if (/^SELECT 1$/.test(sql)) return { rows: [{ '?column?': 1 }] };
    if (/FROM maphack_events m JOIN users/.test(sql)) return { rows: [{ created_at: '2026-09-03T10:00:00Z', tool: 'xenon', warnings: 3, banned: true, username: 'Cheater', discord_id: '111111111111111111' }] };
    if (/FROM users u/.test(sql)) return { rows: state.users.filter((u) => u.maphack_warnings > 0 || u.banned).map((u) => ({ ...u, last_tool: 'xenon', last_at: '2026-09-03T10:00:00Z', events_total: u.maphack_warnings })) };
    if (/^SELECT id, username, discord_id.*FROM users WHERE/.test(sql)) {
      const [p] = params;
      let rows = [];
      if (/WHERE id = \$1/.test(sql)) rows = state.users.filter((u) => u.id === p);
      else if (/discord_id = \$1/.test(sql)) rows = state.users.filter((u) => u.discord_id === p);
      else rows = state.users.filter((u) => u.username.toLowerCase() === String(p).toLowerCase());
      return { rows: rows.map((u) => ({ ...u })) };   // бодит DB шиг хуулбар
    }
    if (/^UPDATE users SET maphack_warnings = 0/.test(sql)) {
      const u = state.users.find((x) => x.id === params[0]);
      u.maphack_warnings = 0;
      if (/banned = FALSE/.test(sql)) { u.banned = false; u.ban_reason = null; u.banned_at = null; }
      return { rows: [] };
    }
    throw new Error('unexpected sql: ' + sql.slice(0, 60));
  },
};
require.cache[require.resolve(path.join(__dirname, '../src/config/db'))] = { id: 'db', filename: 'db', loaded: true, exports: fakeDb };
// stats.js-ийн tierBotHelpers-ийг ачаалахад DB/env хэрэггүй
const anticheat = require('../src/routes/anticheat');

const handler = (method, p) => anticheat.stack.find((l) => l.route && l.route.path === p && l.route.methods[method]).route.stack.slice(-1)[0].handle;
const call = (h, { headers = {}, body = {} } = {}) => new Promise((resolve) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(d) { resolve({ status: this.statusCode, body: d }); } };
  h({ headers, body, user: null }, res);
});

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('PASS ' + name); });

(async () => {
  await ok('botKeyOk: зөв/буруу/хоосон түлхүүр', () => {
    assert.strictEqual(anticheat.botKeyOk({ headers: { 'x-api-key': 'shared-key-123' } }), true);
    assert.strictEqual(anticheat.botKeyOk({ headers: { 'x-api-key': 'shared-key-124' } }), false);
    assert.strictEqual(anticheat.botKeyOk({ headers: {} }), false);
  });
  await ok('list: түлхүүргүй → 401', async () => {
    const r = await call(handler('get', '/list'));
    assert.strictEqual(r.status, 401);
  });
  await ok('list: бан + сануулгатай хүмүүс, сүүлийн илрэлт, blocklist', async () => {
    const r = await call(handler('get', '/list'), { headers: { 'x-api-key': 'shared-key-123' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.warn_limit, 3);
    assert.deepStrictEqual(r.body.users.map((u) => u.id), [7, 8, 9]);
    assert.strictEqual(r.body.users[0].last_tool, 'xenon');
    assert.strictEqual(r.body.events.length, 1);
    assert.ok(r.body.blocklist.includes('xenon'));
  });
  await ok('reset: discord_id-аар — сануулга 0, MapHack бан цуцлагдана', async () => {
    const r = await call(handler('post', '/reset'), { headers: { 'x-api-key': 'shared-key-123' }, body: { discord_id: '111111111111111111', by: 'test' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.unbanned, true);
    assert.strictEqual(r.body.previous_warnings, 3);
    assert.strictEqual(state.users[0].banned, false);
    assert.strictEqual(state.users[0].maphack_warnings, 0);
  });
  await ok('reset: гараар бан хийсэн хүний банг ХӨНДӨХГҮЙ, зөвхөн сануулга тэглэнэ', async () => {
    const r = await call(handler('post', '/reset'), { headers: { 'x-api-key': 'shared-key-123' }, body: { username: 'manual' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.unbanned, false);
    assert.strictEqual(r.body.still_banned, true);
    assert.strictEqual(state.users[2].banned, true);
    assert.strictEqual(state.users[2].maphack_warnings, 0);
  });
  await ok('reset: олдохгүй → 404, параметргүй → 400, түлхүүргүй → 401', async () => {
    assert.strictEqual((await call(handler('post', '/reset'), { headers: { 'x-api-key': 'shared-key-123' }, body: { username: 'nobody' } })).status, 404);
    assert.strictEqual((await call(handler('post', '/reset'), { headers: { 'x-api-key': 'shared-key-123' }, body: {} })).status, 400);
    assert.strictEqual((await call(handler('post', '/reset'), { body: { username: 'x' } })).status, 401);
  });
  console.log(`\n=== anticheat: ${n} PASS ===`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
