'use strict';
// Нийтийн статистик (/public/stats) — FB туслах ботод зориулсан нэгтгэсэн тоо. node tests/publicstats.test.js
const assert = require('assert');
const Module = require('module');

const calls = [];
const fakeDb = {
  query: async (sql, params) => {
    calls.push(sql);
    if (/FROM rooms/.test(sql)) return { rows: params[0].map((id) => ({ id, name: `WC3 Room ${id}` })) };
    return { rows: [{ registered: 1234, games_24h: 56 }] };
  },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (/config\/db$/.test(req)) return fakeDb;
  return origLoad.call(this, req, ...rest);
};
const ps = require('../src/routes/publicStats');
let n = 0;
const ok = (m) => { n++; console.log('PASS', m); };

(async () => {
  const list = [
    { userId: 1, username: 'a', status: 'online' },
    { userId: 2, username: 'b', status: 'in_room' },
    { userId: 3, username: 'c', status: 'in_game' },
    { userId: 4, username: 'd', status: 'in_game' },
  ];
  const rooms = new Map([['1', { open: 1, started: 2 }], ['3', { open: 0, started: 1 }]]);
  const s = ps.summarize(list, rooms);
  assert.deepStrictEqual(s, { online: 4, in_room: 1, in_game: 2, games_open: 1, games_running: 3 });
  ok('онлайн / өрөөнд / тоглож буй + тоглоомын тоог зөв нэгтгэнэ');

  ps.setSources({ presence: () => list, rooms: () => rooms, version: async () => 'v3.2.0' });
  const b = await ps._build();
  assert.strictEqual(b.registered, 1234);
  assert.strictEqual(b.games_24h, 56);
  assert.strictEqual(b.version, 'v3.2.0');
  assert.deepStrictEqual(b.rooms, [{ name: 'WC3 Room 1', open: 1, running: 2 }, { name: 'WC3 Room 3', open: 0, running: 1 }]);
  ok('бүртгэлтэй хүн, 24 цагийн тоглоом, хувилбар, Room-ын нэртэй тоо');

  const txt = JSON.stringify(b);
  assert(!/"username"|"userId"|"a"|"b"/.test(txt));
  ok('хэрэглэгчийн нэр / ID огт гаргахгүй');

  ps.setSources({ presence: () => [], rooms: () => new Map(), version: async () => { throw new Error('gh down'); } });
  const e = await ps._build();
  assert.strictEqual(e.online, 0); assert.strictEqual(e.version, null); assert.deepStrictEqual(e.rooms, []);
  ok('хоосон / GitHub унасан үед ч алдаагүй');

  console.log(`\n=== publicstats: ${n} PASS ===`);
})().catch((e) => { console.error(e); process.exit(1); });
