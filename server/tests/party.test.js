'use strict';
// Party (routes/party.js): урих → үүсгэх, нэгдэх/татгалзах, дүүрэх хязгаар, гарах/удирдагч шилжих, хасах, чат, өмнөх party-гаас шилжих.
// node tests/party.test.js
const assert = require('assert');
const path = require('path');
process.env.PARTY_MAX = '3';
const party = require(path.join(__dirname, '..', 'src', 'routes', 'party.js'));

let n = 0;
const ok = (m) => { n++; console.log('PASS', m); };
const sent = []; const joins = []; const leaves = [];
const online = new Set(['1', '2', '3', '4', '5']);
const rooms = { 2: { id: '901' } };
party.setup({
  io: { to: (room) => ({ emit: (ev, data) => sent.push({ room, ev, data }) }), in: (room) => ({ socketsJoin: (r) => joins.push([room, r]), socketsLeave: (r) => leaves.push([room, r]) }) },
  isOnline: (uid) => online.has(String(uid)),
  roomOf: (uid) => rooms[uid] || null,
});
const last = (ev, room) => [...sent].reverse().find((x) => x.ev === ev && (!room || x.room === room));

let r = party.invite({ fromId: 1, fromName: 'A', toId: 1 }); assert.equal(r.ok, false); ok('Өөрийгөө урихгүй');
online.delete('9'); r = party.invite({ fromId: 1, fromName: 'A', toId: 9 }); assert.equal(r.ok, false); ok('Офлайн хүнийг урихгүй');

r = party.invite({ fromId: 1, fromName: 'A', toId: 2 });
assert.equal(r.ok, true); assert.equal(r.state.members.length, 1); assert.equal(r.state.leader_id, '1');
assert.deepEqual(last('party:invited', 'user:2').data.from_name, 'A');
assert.ok(joins.some(([u, p]) => u === 'user:1' && p.startsWith('party:')));
ok('Урихад party үүсч урьсан хүн удирдагч, урилга user:2-д очно');
const inv2 = r.invite_id;

r = party.accept({ userId: 3, username: 'C', inviteId: inv2 }); assert.equal(r.ok, false); ok('Өөр хүний урилгыг ашиглахгүй');
r = party.accept({ userId: 2, username: 'B', inviteId: inv2 });
assert.equal(r.ok, true); assert.equal(r.state.members.length, 2);
assert.equal(r.state.members.find((m) => m.user_id === '2').room_id, '901');
assert.ok(last('party:msg').data.text.includes('B Party-д нэгдлээ'));
ok('Нэгдэх → 2 гишүүн, гишүүний одоогийн Room харагдана, чатад системийн мессеж');
r = party.accept({ userId: 2, username: 'B', inviteId: inv2 }); assert.equal(r.ok, false); ok('Нэг урилгыг дахин ашиглахгүй');

const inv3 = party.invite({ fromId: 1, fromName: 'A', toId: 3 }).invite_id;
party.accept({ userId: 3, username: 'C', inviteId: inv3 });
r = party.invite({ fromId: 1, fromName: 'A', toId: 4 }); assert.equal(r.ok, false); assert.match(r.error, /дүүрсэн/); ok('PARTY_MAX (3) хүрвэл урихгүй');

r = party.message({ userId: 2, username: 'B', text: '  сайн уу\u0007  ' });
assert.equal(r.ok, true); const pm = last('party:msg'); assert.equal(pm.data.text, 'сайн уу'); assert.ok(pm.room.startsWith('party:'));
assert.equal(party.message({ userId: 4, username: 'D', text: 'hi' }).ok, false);
ok('Чат: зөвхөн гишүүд, хяналтын тэмдэгт цэвэрлэнэ, party өрөөнд л очно');

r = party.kick({ leaderId: 2, targetId: 3 }); assert.equal(r.ok, false); ok('Удирдагч биш хүн хасахгүй');
r = party.kick({ leaderId: 1, targetId: 3 }); assert.equal(r.ok, true);
assert.equal(party.stateFor(3), null); assert.ok(last('party:kicked', 'user:3')); ok('Удирдагч хасна → хасагдсан хүнд party:kicked');

r = party.leave({ userId: 1 }); assert.equal(r.ok, true);
const st = party.stateFor(2); assert.equal(st.leader_id, '2'); assert.equal(st.members.length, 1);
ok('Удирдагч гарвал дараагийн гишүүн удирдагч болно');

// Шилжих: 5 өөр party үүсгээд 2-ыг урьж нэгдэхэд хуучнаас гарна
const inv = party.invite({ fromId: 5, fromName: 'E', toId: 2 }).invite_id;
r = party.accept({ userId: 2, username: 'B', inviteId: inv });
assert.equal(r.ok, true); assert.equal(party.stateFor(2).leader_id, '5'); assert.equal(party._parties.size, 1);
ok('Өөр party-д нэгдэхэд өмнөхөөс автоматаар гарна (хоосон party устна)');

const i4 = party.invite({ fromId: 5, fromName: 'E', toId: 4 }).invite_id;
r = party.decline({ userId: 4, username: 'D', inviteId: i4 }); assert.equal(r.ok, true);
assert.equal(last('party:declined', 'user:5').data.name, 'D'); ok('Татгалзвал урьсан хүнд мэдэгдэнэ');

assert.equal(party.promote({ leaderId: 5, targetId: 2 }).ok, true); assert.equal(party.stateFor(5).leader_id, '2'); ok('Удирдлага шилжүүлэх');

console.log(`\n=== party: ${n} PASS ===`);
