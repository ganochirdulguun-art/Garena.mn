'use strict';
// Чатын хариулт: клиентээс ирсэн replyTo-г цэвэрлэх (зөвхөн username/text/time, урт хязгаар, буруу огноо татгалзана).
const assert = require('node:assert/strict');
const path = require('node:path');
const { sanitizeReplyTo } = require(path.join(__dirname, '..', 'src', 'routes', 'social.js'));
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };

const t = new Date().toISOString();
assert.deepEqual(sanitizeReplyTo({ username: 'Тэмүүжин Бат', text: 'сайн уу', time: t, evil: '<script>' }), { username: 'Тэмүүжин Бат', text: 'сайн уу', time: t });
ok('Зөвхөн username/text/time үлдэнэ');
assert.equal(sanitizeReplyTo(null), null); assert.equal(sanitizeReplyTo('x'), null);
assert.equal(sanitizeReplyTo({ username: '', text: 'a', time: t }), null);
assert.equal(sanitizeReplyTo({ username: 'a', text: 'a', time: 'not-a-date' }), null);
assert.equal(sanitizeReplyTo({ username: { $ne: 1 }, text: 'a', time: t }), null);
ok('Хоосон/буруу төрөл/огноо татгалзана');
const r = sanitizeReplyTo({ username: 'x'.repeat(100), text: 'y '.repeat(200), time: t });
assert.equal(r.username.length, 40); assert.ok(r.text.length <= 80 && r.text.endsWith('…'));
ok('Урт хязгаар (нэр 40, текст 80)');
console.log(`=== chatreply: ${pass} PASS ===`);
process.exit(0);
