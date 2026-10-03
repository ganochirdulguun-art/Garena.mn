// TierSystem-ийн хожил/хожигдол → Level/XP (routes/stats.js creditTierXp): зөвхөн өсөлтийг нэмнэ, давхар олгохгүй
const assert = require('assert');
const path = require('path');
const state = { 5: { id: 5, xp: 0, level: 1, tierbot_xp_wins: 0, tierbot_xp_losses: 0 } };
const fakeDb = { query: async (sql, p = []) => {
  if (/SELECT xp, COALESCE\(tierbot_xp_wins/.test(sql)) { const u = state[p[0]]; return { rows: u ? [{ xp: u.xp, cw: u.tierbot_xp_wins, cl: u.tierbot_xp_losses }] : [] }; }
  if (/^UPDATE users SET xp = \$1, level = \$2, tierbot_xp_wins/.test(sql)) { const u = state[p[4]]; Object.assign(u, { xp: p[0], level: p[1], tierbot_xp_wins: p[2], tierbot_xp_losses: p[3] }); return { rows: [] }; }
  return { rows: [] };
} };
const dbPath = path.join(__dirname, '../src/config/db');
require.cache[require.resolve(dbPath)] = { id: 'db', filename: 'db', loaded: true, exports: fakeDb };
const { tierBotHelpers: h } = require('../src/routes/stats');
let n = 0; const ok = (t) => { n++; console.log('PASS ' + t); };
(async () => {
  let d = await h.creditTierXp(5, 10, 4);
  assert.strictEqual(d, 10 * 40 + 4 * 10); assert.strictEqual(state[5].xp, 440); assert.ok(state[5].level >= 2);
  ok('анхны sync: бүх түүх (10 хожил, 4 хожигдол) → 440 XP, level өссөн');
  d = await h.creditTierXp(5, 10, 4);
  assert.strictEqual(d, 0); assert.strictEqual(state[5].xp, 440);
  ok('ижил тоо дахин sync → давхар XP үгүй');
  d = await h.creditTierXp(5, 12, 5);
  assert.strictEqual(d, 2 * 40 + 10); assert.strictEqual(state[5].xp, 530);
  ok('өсөлт (2 хожил, 1 хожигдол) → +90 XP');
  d = await h.creditTierXp(5, 11, 5);
  assert.strictEqual(d, 0);
  ok('буурсан тоо (засвар) → XP хасахгүй, өөрчлөхгүй');
  d = await h.creditTierXp(999, 3, 3);
  assert.strictEqual(d, 0);
  ok('байхгүй хэрэглэгч → 0');
  console.log(`\n=== tierxp: ${n} PASS ===`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
