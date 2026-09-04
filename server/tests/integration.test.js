// /integration/discord-users — GarenaSystem role sync-ийн эх сурвалж (DB stub)
const assert = require('assert');
const path = require('path');
process.env.TIERBOT_API_KEY = 'shared-key-123';

const fakeDb = {
  async query(sql) {
    if (/^SELECT 1$/.test(sql)) return { rows: [] };
    if (/FROM users\s+WHERE discord_id IS NOT NULL/.test(sql)) {
      return { rows: [
        { discord_id: '111111111111111111', username: 'A', banned: false, created_at: '2026-09-01T00:00:00Z' },
        { discord_id: '222222222222222222', username: 'B', banned: true, created_at: '2026-09-02T00:00:00Z' },
      ] };
    }
    throw new Error('unexpected sql: ' + sql.slice(0, 60));
  },
};
require.cache[require.resolve(path.join(__dirname, '../src/config/db'))] = { id: 'db', filename: 'db', loaded: true, exports: fakeDb };
const router = require('../src/routes/integration');
const handler = router.stack.find((l) => l.route && l.route.path === '/discord-users').route.stack.slice(-1)[0].handle;
const call = (headers = {}) => new Promise((resolve) => {
  const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(d) { resolve({ status: this.statusCode, body: d }); } };
  handler({ headers, body: {} }, res);
});

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('PASS ' + name); });
(async () => {
  await ok('түлхүүргүй → 401', async () => { assert.strictEqual((await call()).status, 401); });
  await ok('жагсаалт: discord_id, banned туг, тоо', async () => {
    const r = await call({ 'x-api-key': 'shared-key-123' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.body.count, 2);
    assert.deepStrictEqual(r.body.users.map((u) => [u.discord_id, u.banned]), [['111111111111111111', false], ['222222222222222222', true]]);
    assert.ok(r.body.generated_at);
  });
  console.log(`\n=== integration: ${n} PASS ===`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
