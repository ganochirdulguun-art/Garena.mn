// services/playtime.js — цэвэр функцууд: computePlaytime / diamondsDue / secToNextDiamond
const assert = require('assert');
const { RULES, computePlaytime, diamondsDue, secToNextDiamond } = require('../src/services/playtime');
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('PASS ' + name); };

ok('47 мин дуустал → 94 + 10 = 104 XP; задаргаа 2 мөр', () => {
  const c = computePlaytime({ gameSeconds: 47 * 60 + 30 });
  assert.strictEqual(c.counted_sec, 47 * 60 + 30); assert.strictEqual(c.xp, 47 * 2 + 10); assert.strictEqual(c.stayed, true);
  assert.strictEqual(c.lines.length, 2);
});
ok('15 минутад гарсан (leaver) → 30 XP, бонусгүй', () => {
  const c = computePlaytime({ gameSeconds: 40 * 60, leftAtSec: 15 * 60 });
  assert.strictEqual(c.counted_sec, 900); assert.strictEqual(c.xp, 30); assert.strictEqual(c.stayed, false);
});
ok('7 мин → remake, 0', () => {
  const c = computePlaytime({ gameSeconds: 7 * 60 });
  assert.strictEqual(c.counted_sec, 0); assert.strictEqual(c.xp, 0);
});
ok('Ranked ×1.25: 60 мин → (120+10)×1.25 = 163', () => {
  assert.strictEqual(computePlaytime({ gameSeconds: 3600, ranked: true }).xp, Math.round(130 * 1.25));
});
ok('Өдрийн 8ц хязгаар: 7ц30м тоглосон + 60 мин тоглолт → 30 мин л тоологдоно; 8ц дүүрсэн → 0', () => {
  const c = computePlaytime({ gameSeconds: 3600, todaySeconds: 7.5 * 3600 });
  assert.strictEqual(c.counted_sec, 1800); assert.strictEqual(c.capped, true);
  assert.strictEqual(computePlaytime({ gameSeconds: 3600, todaySeconds: 8 * 3600 }).counted_sec, 0);
});
ok('💎: 1 цаг = 2, хуримтлагдана, өмнө өгснийг хасна', () => {
  assert.strictEqual(diamondsDue(59 * 60, 0), 0);
  assert.strictEqual(diamondsDue(3600, 0), 2);
  assert.strictEqual(diamondsDue(3 * 3600 + 100, 4), 2);
  assert.strictEqual(diamondsDue(3 * 3600 + 100, 6), 0);
  assert.strictEqual(secToNextDiamond(3 * 3600 + 100), 3500);
  assert.strictEqual(RULES.DIAMONDS_PER_HOUR, 2);
});
console.log(`\n=== playtime: ${n} PASS ===`);
