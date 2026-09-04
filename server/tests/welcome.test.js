// Шинэ хэрэглэгчийн урамшуулал (services/welcome.js) — DB-г дуурайж, идемпотент байдал + DM + мэдэгдлийг шалгана
const assert = require('assert');
const path = require('path');
process.env.WELCOME_DIAMONDS = '350';

const state = { users: { 5: { id: 5, username: 'Newbie', diamonds: 0 } }, tx: [], messages: [], nextId: 100 };
const sqls = [];
async function query(sql, params = []) {
  sqls.push(sql);
  if (/^SELECT 1$/.test(sql) || /^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return { rows: [] };
  if (/SELECT 1 FROM diamond_transactions WHERE user_id = \$1 AND ref = \$2/.test(sql)) {
    return { rows: state.tx.filter((t) => t.user_id === params[0] && t.ref === params[1]).slice(0, 1) };
  }
  if (/^UPDATE users SET diamonds = GREATEST/.test(sql)) {
    const u = state.users[params[1]]; if (!u) return { rows: [] };
    u.diamonds = Math.max(0, u.diamonds + params[0]); return { rows: [{ diamonds: u.diamonds }] };
  }
  if (/^INSERT INTO diamond_transactions/.test(sql)) { state.tx.push({ user_id: params[0], amount: params[1], type: params[2], ref: params[3], note: params[4] }); return { rows: [] }; }
  if (/SELECT id FROM users WHERE LOWER\(email\) = \$1/.test(sql)) {
    const sys = Object.values(state.users).find((u) => u.email === params[0]); return { rows: sys ? [{ id: sys.id }] : [] };
  }
  if (/^INSERT INTO users \(username, email, password_hash\) VALUES \(\$1, \$2, NULL\)/.test(sql)) {
    const id = state.nextId++; state.users[id] = { id, username: params[0], email: params[1], diamonds: 0 }; return { rows: [{ id }] };
  }
  if (/^INSERT INTO messages/.test(sql)) { const id = state.nextId++; state.messages.push({ id, sender_id: params[0], receiver_id: params[1], text: params[2] }); return { rows: [{ id }] }; }
  throw new Error('unexpected sql: ' + sql.slice(0, 70));
}
const fakeDb = { query, connect: async () => ({ query, release() {} }) };
require.cache[require.resolve(path.join(__dirname, '../src/config/db'))] = { id: 'db', filename: 'db', loaded: true, exports: fakeDb };

const membership = require('../src/routes/membership');
const emitted = [];
membership.setIO({ to: (room) => ({ emit: (ev, payload) => emitted.push({ room, ev, payload }) }) });
const welcome = require('../src/services/welcome');

let n = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { n++; console.log('PASS ' + name); });

(async () => {
  await ok('анхны олголт: +350 💎, дэвтэр welcome/welcome:v1, системийн хэрэглэгч үүсч DM илгээнэ', async () => {
    const r = await welcome.grantWelcome(5, { username: 'Newbie' });
    assert.strictEqual(r.granted, true); assert.strictEqual(r.amount, 350); assert.strictEqual(r.balance, 350);
    assert.strictEqual(state.users[5].diamonds, 350);
    assert.deepStrictEqual(state.tx.map((t) => [t.type, t.ref]), [['welcome', 'welcome:v1']]);
    const sys = Object.values(state.users).find((u) => u.email === 'system@garena.mn');
    assert.ok(sys && sys.username === 'Garena.mn');
    assert.strictEqual(state.messages.length, 1);
    assert.strictEqual(state.messages[0].sender_id, sys.id); assert.strictEqual(state.messages[0].receiver_id, 5);
    assert.ok(state.messages[0].text.includes('тавтай морил') && state.messages[0].text.includes('350 Diamond'));
  });
  await ok('мэдэгдэл: diamonds:received + private:message (live DM) user:5 room руу', () => {
    const evs = emitted.filter((e) => e.room === 'user:5').map((e) => e.ev);
    assert.deepStrictEqual(evs, ['diamonds:received', 'private:message']);
    const dm = emitted.find((e) => e.ev === 'private:message').payload;
    assert.strictEqual(dm.fromUsername, 'Garena.mn'); assert.ok(dm.text.includes('350'));
    assert.strictEqual(emitted.find((e) => e.ev === 'diamonds:received').payload.reason, 'welcome');
  });
  await ok('идемпотент: хоёр дахь удаа олгохгүй, DM давхардахгүй', async () => {
    const r = await welcome.grantWelcome(5);
    assert.strictEqual(r.granted, false); assert.strictEqual(r.reason, 'already');
    assert.strictEqual(state.users[5].diamonds, 350); assert.strictEqual(state.messages.length, 1);
  });
  await ok('grantWelcomeSafe: алдаа бүртгэлийг унагахгүй (байхгүй хэрэглэгч)', async () => {
    welcome.grantWelcomeSafe(999);
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(state.tx.length, 1);
  });
  await ok('системийн хэрэглэгч нэг л удаа үүснэ (кэш)', async () => {
    const before = Object.keys(state.users).length;
    await welcome.systemUser(); await welcome.systemUser();
    assert.strictEqual(Object.keys(state.users).length, before);
  });
  console.log(`\n=== welcome: ${n} PASS ===`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
