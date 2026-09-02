// Алхам 3: relay дүнгийн цэвэр функцүүд — ranked хүчинтэй эсэх, нэр→хэрэглэгч тааруулалт
const assert = require('assert');
process.env.RELAY_REPORT_KEY = process.env.RELAY_REPORT_KEY || 'test-key';
const { rankedValidity, resolvePlayers, RANKED } = require('../src/routes/relayStats');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS ' + name); };
const P = (team, uid, extra = {}) => ({ team, user_id: uid, ...extra });

ok('3v3, 15 мин, ялагч → хүчинтэй', () => {
  const players = [P(1, 1), P(1, 2), P(1, 3), P(2, 4), P(2, 5), P(2, 6)];
  assert.deepStrictEqual(rankedValidity({ gameTimeSec: 900, winnerTeam: 1, players }), { valid: true, reason: null });
});
ok('ялагчгүй → no-winner', () => {
  assert.strictEqual(rankedValidity({ gameTimeSec: 900, winnerTeam: null, players: [] }).reason, 'no-winner');
});
ok('11 мин → too-short (доод хязгаар ' + RANKED.MIN_GAME_SEC + 'с)', () => {
  const players = [P(1, 1), P(1, 2), P(1, 3), P(2, 4), P(2, 5), P(2, 6)];
  assert.strictEqual(rankedValidity({ gameTimeSec: 11 * 60, winnerTeam: 2, players }).reason, 'too-short');
});
ok('2v2 → team-size; бүртгэлгүй (user_id-гүй) тоглогч тоологдохгүй', () => {
  const players = [P(1, 1), P(1, 2), P(1, null), P(2, 4), P(2, 5), P(2, null)];
  assert.strictEqual(rankedValidity({ gameTimeSec: 900, winnerTeam: 1, players }).reason, 'team-size');
});
ok('resolvePlayers: joiner нэр → user_id, хост pid1 → host_user_id, статистик дамжина', () => {
  const players = [
    { pid: 1, name: 'daahguine', team: 2, kills: 1, deaths: 2, assists: 0, creepKills: 43, creepDenies: 1, neutralKills: 5, gold: 1238, hero: 'NC00', wards: 2 },
    { pid: 2, name: 'Vito_Andolini_C', team: 1, kills: 1, deaths: 3, assists: 0, creepKills: 3, creepDenies: 0, neutralKills: 0, gold: 372, hero: 'H00I', wards: 0, left_at_sec: null },
    { pid: 3, name: 'Unknown', team: 1, kills: 0, deaths: 0, assists: 0, creepKills: 0, creepDenies: 0, neutralKills: 0, gold: 0, hero: 'X', wards: 0 },
  ];
  const r = resolvePlayers(players, { hostUserId: 10, hostWc3Name: 'daahguine', joiners: [{ user_id: 20, wc3_name: 'vito_andolini_c' }] });
  assert.strictEqual(r[0].user_id, 10); assert.strictEqual(r[0].team, 2); assert.strictEqual(r[0].creep_kills, 43); assert.strictEqual(r[0].wards, 2);
  assert.strictEqual(r[1].user_id, 20); assert.strictEqual(r[1].team, 1); assert.strictEqual(r[1].hero, 'H00I');
  assert.strictEqual(r[2].user_id, undefined); assert.strictEqual(r[2].name, 'Unknown');   // сервер users.wc3_name/username-ээр үзнэ
});
ok('resolvePlayers: нэг user_id-г хоёр тоглогчид давхар өгөхгүй', () => {
  const r = resolvePlayers([{ pid: 1, name: 'a', team: 1 }, { pid: 2, name: 'a', team: 2 }], { hostUserId: 1, hostWc3Name: 'a', joiners: [] });
  assert.strictEqual(r[0].user_id, 1); assert.strictEqual(r[1].user_id, undefined);
});
console.log(`\n=== relaystats: ${n} PASS ===`);
