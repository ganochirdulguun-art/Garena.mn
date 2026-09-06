// routes/radar.js — sanitizeRadar / summaryRow (цэвэр функцууд)
const assert = require('assert');
const { sanitizeRadar, summaryRow, heroInfo } = require('../src/routes/radar');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS ' + name); };

ok('sanitizeRadar: token цэвэрлэнэ, paths бүхэл тоо болно, kill/event хэлбэржинэ', () => {
  const s = sanitizeRadar({
    game_token: 'ABC-123zz!', game_time_sec: '2937.9', winner_team: '2', ended_at: '2026-09-05T06:29:00Z',
    players: [{ pid: 1, colour: 1, team: 1, name: 'sgot', hero: 'HC92', hero_orders: 3083 }, { pid: 2, colour: 7, team: 2, hero: 'Nbrn' }],
    paths: { 1: [[120788, -6823.4, -6850.2], [121000, 'x', 1], [125000, 10, 20]], bad: [[1, 2, 3]] },
    kills: [{ t: 406000.4, killer: 7, victim: 1 }, { t: 'nope' }],
    events: [{ t: 1000, key: 'Tower7', v: 3 }, { key: 'nokey' }],
  });
  assert.strictEqual(s.token, 'ABC123');
  assert.strictEqual(s.game_time_sec, 2937); assert.strictEqual(s.winner_team, 2);
  assert.deepStrictEqual(s.paths[1], [[120788, -6823, -6850], [125000, 10, 20]]);
  assert.strictEqual(s.paths.bad, undefined);
  assert.deepStrictEqual(s.kills, [{ t: 406000, killer: 7, victim: 1 }]);
  assert.deepStrictEqual(s.events, [{ t: 1000, key: 'Tower7', v: 3 }]);
  assert.strictEqual(s.players[1].name, null); assert.strictEqual(s.players[0].hero_orders, 3083);
  assert.strictEqual(s.played_at.toISOString(), '2026-09-05T06:29:00.000Z');
});
ok('sanitizeRadar: ended_at Unix ms тоо → played_at зөв огноо', () => {
  const s = sanitizeRadar({ game_token: 'ab', ended_at: 1788631163260 });
  assert.strictEqual(s.played_at.toISOString(), new Date(1788631163260).toISOString());
});
ok('sanitizeRadar: token дутуу бол алдаа; winner буруу бол null', () => {
  assert.throws(() => sanitizeRadar({ players: [] }), /game_token/);
  assert.strictEqual(sanitizeRadar({ game_token: 'ff', winner_team: 5 }).winner_team, null);
});
ok('summaryRow: paths-гүй жижиг мөр, kill тоо', () => {
  const r = summaryRow({ token: 'ff', room_id: 3, room_name: 'A', host_name: 'h', game_time_sec: 10, winner_team: 1,
    players: [{ pid: 1, team: 1, name: 'x', hero: 'Nbrn', hero_orders: 9 }], kills: [{}, {}], played_at: 'd' });
  assert.strictEqual(r.kills, 2);
  assert.strictEqual(r.players[0].hero_name, 'Drow Ranger'); assert.strictEqual(r.players[0].hero_proper, 'Traxex');
  assert.ok(/\/assets\/heroes\/Nbrn\.png$/.test(r.players[0].hero_icon), 'оригинал WC3 icon (assets/heroes) түрүүлнэ: ' + r.players[0].hero_icon);
  assert.strictEqual(r.paths, undefined);
  assert.strictEqual(summaryRow({ token: 'a', players: [], kill_count: '4' }).kills, 4);
});
ok('heroInfo: DotA код → нэр + Dota 2 icon; мэдэгдэхгүй код → кодоороо, icon null', () => {
  const h = heroInfo('N0HP');
  assert.strictEqual(h.hero_name, 'Ancient Apparition'); assert.ok(/icons\/ancient_apparition\.png$/.test(h.hero_icon), 'AA custom icon → Dota 2 fallback');
  assert.strictEqual(heroInfo('Nbrn').hero_name, 'Drow Ranger');
  assert.deepStrictEqual(heroInfo('ZZZZ'), { hero_name: 'ZZZZ', hero_proper: null, hero_icon: null });
  assert.strictEqual(heroInfo(null).hero_name, null);
  const row = summaryRow({ token: 'a', players: [{ pid: 1, team: 1, name: null, hero: 'E02N' }], kills: [] });
  assert.strictEqual(row.players[0].hero_name, 'Gyrocopter');
});
console.log(`\n=== radar: ${n} PASS ===`);
