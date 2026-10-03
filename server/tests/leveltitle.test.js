// Level цол + дээд level 100 (services/progression.js): Grunt 1–9 · Overlord 10–19 · Blademaster 20–29 · Shaman 30–49 · DemiGod 50–99 · GOD 100
const assert = require('assert');
const path = require('path');
const { levelTitle, levelFromXp, levelProgress, xpForLevel, MAX_LEVEL } = require(path.join(__dirname, '../src/services/progression'));
let n = 0; const ok = (t) => { n++; console.log('PASS ' + t); };
assert.strictEqual(MAX_LEVEL, 100); ok('дээд level 100');
const exp = { 1: 'Grunt', 5: 'Grunt', 9: 'Grunt', 10: 'Overlord', 19: 'Overlord', 20: 'Blademaster', 29: 'Blademaster', 30: 'Shaman', 49: 'Shaman', 50: 'DemiGod', 99: 'DemiGod', 100: 'GOD' };
for (const [l, t] of Object.entries(exp)) assert.strictEqual(levelTitle(Number(l)), t, `LV ${l}`);
ok('цолын хил: 1/9 Grunt, 10/19 Overlord, 20/29 Blademaster, 30/49 Shaman, 50/99 DemiGod, 100 GOD');
assert.strictEqual(levelTitle(0), 'Grunt'); assert.strictEqual(levelTitle(150), 'GOD'); assert.strictEqual(levelTitle(undefined), 'Grunt'); ok('хүрээнээс гадуур утга → хамгийн ойрын цол');
assert.strictEqual(levelFromXp(xpForLevel(100)), 100); assert.strictEqual(levelFromXp(xpForLevel(100) * 10), 100); ok('XP хэчнээн их ч level 100-аас хэтрэхгүй');
assert.strictEqual(levelFromXp(xpForLevel(10)), 10); assert.strictEqual(levelFromXp(xpForLevel(10) - 1), 9); ok('level тооцоо өмнөх шигээ');
const p = levelProgress(xpForLevel(100) + 500);
assert.strictEqual(p.level, 100); assert.strictEqual(p.title, 'GOD'); assert.strictEqual(p.progress, 1); assert.strictEqual(p.next_level_xp, xpForLevel(100)); assert.strictEqual(p.max_level, 100); ok('level 100-д progress 1, title GOD');
const q = levelProgress(xpForLevel(17) + 10); assert.strictEqual(q.title, 'Overlord'); assert.strictEqual(q.level, 17); ok('levelProgress title (LV17 Overlord)');
console.log(`\n=== leveltitle: ${n} PASS ===`);
