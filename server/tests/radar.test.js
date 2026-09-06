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

// ── LIVE + эрх (2026-09-06) ──
const { goldActive, mergeLive, visibleMs, visibleView, isParticipant, liveRow, PUBLIC_DELAY_SEC, OWNER_DELAY_SEC } = require('../src/routes/radar');
ok('эрх: GOLD идэвхтэй л ok; хугацаа дууссан/silver/bronze → үгүй; саатлын тогтмол 0/120', () => {
  assert.strictEqual(goldActive({ membership: 'gold', membership_until: new Date(Date.now() + 86400e3) }), true);
  assert.strictEqual(goldActive({ membership: 'gold', membership_until: new Date(Date.now() - 1000) }), false);
  assert.strictEqual(goldActive({ membership: 'silver', membership_until: new Date(Date.now() + 86400e3) }), false);
  assert.strictEqual(goldActive({ membership: 'bronze' }), false); assert.strictEqual(goldActive(null), false);
  assert.strictEqual(OWNER_DELAY_SEC, 0); assert.strictEqual(PUBLIC_DELAY_SEC, 120);
});
ok('mergeLive: бүтэн → delta нэмэгдэнэ, нэр хадгална, offset = now − t', () => {
  const g = { players: [], paths: {}, kills: [], events: [], game_time_ms: 0 };
  const now = 1_800_000_000_000;
  mergeLive(g, sanitizeRadar({ game_token: 'ab', players: [{ pid: 1, name: 'chrs', hero: 'Nbrn', team: 1 }], paths: { 1: [[1000, 1, 1], [2000, 2, 2]] }, kills: [] }), 2500, 0, now);
  mergeLive(g, sanitizeRadar({ game_token: 'ab', players: [{ pid: 1, name: null, hero: 'Nbrn', team: 1 }, { pid: 2, hero: 'HC92', team: 2 }], paths: { 1: [[3000, 3, 3]], 2: [[2800, 9, 9]] }, kills: [{ t: 2900, killer: 3, victim: 5 }] }), 3100, 2500, now + 5000);
  assert.deepStrictEqual(g.paths[1], [[1000, 1, 1], [2000, 2, 2], [3000, 3, 3]]); assert.deepStrictEqual(g.paths[2], [[2800, 9, 9]]);
  assert.strictEqual(g.players[0].name, 'chrs'); assert.strictEqual(g.kills.length, 1);
  assert.strictEqual(g.game_time_ms, 3100); assert.strictEqual(g.offset_ms, now + 5000 - 3100);
});
ok('visibleMs/visibleView: 120 с саатал — сүүлийн 120 с харагдахгүй; эзэн 0 с — өгөгдлийн зах хүртэл; хожуу орсон тоглогч нуугдана', () => {
  const now = 1_800_000_000_000;
  const g = { game_time_ms: 300_000, offset_ms: now - 300_000, players: [{ pid: 1, team: 1, hero: 'Nbrn' }, { pid: 2, team: 2, hero: 'HC92' }],
    paths: { 1: [[10_000, 1, 1], [200_000, 2, 2], [250_000, 3, 3]], 2: [[190_000, 5, 5]] }, kills: [{ t: 100_000, killer: 1, victim: 2 }, { t: 240_000, killer: 2, victim: 1 }], events: [] };
  const tvPub = visibleMs(g, 120, now); assert.strictEqual(tvPub, 180_000);
  const vp = visibleView(g, tvPub);
  assert.deepStrictEqual(vp.paths[1], [[10_000, 1, 1]]); assert.deepStrictEqual(vp.paths[2], []);
  assert.strictEqual(vp.players.length, 1, 'pid 2 эхний тушаал 190 с → 180 с-д харагдахгүй'); assert.strictEqual(vp.kills.length, 1); assert.strictEqual(vp.game_time_sec, 180);
  const tvOwn = visibleMs(g, 0, now); assert.strictEqual(tvOwn, 300_000);
  const vo = visibleView(g, tvOwn); assert.strictEqual(vo.paths[1].length, 3); assert.strictEqual(vo.kills.length, 2); assert.strictEqual(vo.players.length, 2);
  // delta: since=200_000 → зөвхөн 250_000 цэг + 240_000 kill
  const vd = visibleView(g, tvOwn, 200_000); assert.deepStrictEqual(vd.paths[1], [[250_000, 3, 3]]); assert.strictEqual(vd.kills.length, 1);
  // хугацаа хойшилсон (wall урагшилсан ч daemon зогссон) → өгөгдлийн захаас хэтрэхгүй
  assert.strictEqual(visibleMs(g, 0, now + 60_000), 300_000);
  // тоглоом дөнгөж эхэлсэн: 120 с болоогүй → tv < 0 → visible_in_sec > 0
  const g2 = { ...g, game_time_ms: 30_000, offset_ms: now - 30_000 };
  assert.strictEqual(visibleMs(g2, 120, now), -1); assert.strictEqual(liveRow(g2, 120, now).visible_in_sec, 90);
});
ok('isParticipant: өрөөний гишүүн (id) эсвэл тоглогчийн нэр таарвал харахгүй', () => {
  const g = { participants: new Set(['7']), players: [{ pid: 1, name: 'BRAVEE' }] };
  assert.strictEqual(isParticipant(g, { id: 7, username: 'x' }), true);
  assert.strictEqual(isParticipant(g, { id: 8, username: 'bravee' }), true);
  assert.strictEqual(isParticipant(g, { id: 8, username: 'Вито' }), false);
  assert.strictEqual(isParticipant(g, null), true);
});
console.log(`=== radar live: ${n} PASS ===`);
