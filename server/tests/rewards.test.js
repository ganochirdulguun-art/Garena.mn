'use strict';
// Урамшууллын дүрэм (эзэн 2026-10-08): 1v1 хожил +10 XP +1💎 / хожигдол +3 XP, гарснаар ялсан 1v1-д 💎 үгүй;
// багийн тоглолтод K/D/A нэмэлт XP (≤40) ба K/D/A ≥ 3 бол Ranked +1💎. node tests/rewards.test.js
const assert = require('assert');
const path = require('path');
const { xpFor, kdaBonusEarned, awardGameOutcome, RULES } = require(path.join(__dirname, '..', 'src', 'services', 'progression.js'));

let n = 0;
const ok = (m) => { n++; console.log('PASS', m); };

// Хуурамч pg client: users мөр + diamond_transactions бичлэгийг тэмдэглэнэ
function fakeClient(start = {}) {
  const u = { xp: 0, block_games: 0, block_wins: 0, diamonds: 0, level: 1, ...start };
  const tx = [];
  return {
    u, tx,
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ');
      if (s.startsWith('SELECT xp, level')) return { rows: [u] };
      if (s.includes('SET xp = GREATEST')) {
        u.xp = Math.max(0, u.xp + p[0]); u.block_wins += p[1]; u.block_games += p[3];
        return { rows: [{ xp: u.xp, block_games: u.block_games, block_wins: u.block_wins, diamonds: u.diamonds }] };
      }
      if (s.includes('SET diamonds')) { u.diamonds += p[0]; return { rows: [] }; }
      if (s.includes('INSERT INTO diamond_transactions')) { tx.push({ amount: p[1], type: s.match(/'(\w+)'/)[1], note: p[3] }); return { rows: [] }; }
      if (s.includes('SET block_games = 0')) { u.block_games = 0; u.block_wins = 0; return { rows: [] }; }
      if (s.includes('SET level')) { u.level = p[0]; return { rows: [] }; }
      return { rows: [] };
    },
  };
}

(async () => {
  // ── XP ──
  assert.equal(xpFor({ isWinner: true, oneVsOne: true, kills: 50 }), 10);
  assert.equal(xpFor({ isWinner: false, oneVsOne: true, kills: 50 }), 3);
  assert.equal(xpFor({ isLeaver: true, oneVsOne: true }), RULES.XP_LEAVER);
  ok('1v1: хожил 10 XP, хожигдол 3 XP, K/D/A нэмэлтгүй, leaver −30');

  assert.equal(xpFor({ isWinner: true, kills: 10, assists: 6, deaths: 4 }), 40 + Math.round(15 + 4.5 - 2));
  assert.equal(xpFor({ isWinner: true, kills: 1000 }), 40 + 40);
  assert.equal(xpFor({ isWinner: false, kills: 0, assists: 0, deaths: 20 }), 10);
  assert.equal(xpFor({ isWinner: true, kills: -9, assists: -9, deaths: -9 }), 40);
  ok('Багийн: kill 1.5 / assist 0.75 / үхэл −0.5, нэмэлт 0..40 (сөрөг өгөгдөл XP хасахгүй)');

  assert.equal(kdaBonusEarned({ kills: 6, assists: 3, deaths: 3 }), true);
  assert.equal(kdaBonusEarned({ kills: 6, assists: 2, deaths: 3 }), false);
  assert.equal(kdaBonusEarned({ kills: 3, assists: 1, deaths: 0 }), false);   // kill+assist < 5
  assert.equal(kdaBonusEarned({ kills: 5, assists: 0, deaths: 0 }), true);
  ok('K/D/A бонусын нөхцөл: (kill+assist)/үхэл ≥ 3 ба kill+assist ≥ 5');

  // ── 💎 ──
  let c = fakeClient();
  let r = await awardGameOutcome(c, { userId: 1, isWinner: true, durationMinutes: 15, ranked: true, oneVsOne: true });
  assert.equal(r.xp_earned, 10); assert.equal(r.diamonds_earned, 1); assert.equal(c.u.block_wins, 1);
  ok('Ranked 1v1 хожил → +10 XP +1💎, блокын хожил тоологдоно');

  c = fakeClient();
  r = await awardGameOutcome(c, { userId: 1, isWinner: true, durationMinutes: 15, ranked: true, oneVsOne: true, leaveWin: true });
  assert.equal(r.diamonds_earned, 0); assert.equal(c.u.block_wins, 0); assert.equal(c.u.block_games, 1); assert.equal(r.xp_earned, 10);
  ok('1v1-д нөгөө нь гарснаар ялсан → 💎 үгүй, блокын хожил үгүй (фермлэлтээс хамгаална)');

  c = fakeClient();
  r = await awardGameOutcome(c, { userId: 1, isWinner: true, durationMinutes: 30, ranked: true, kills: 9, assists: 6, deaths: 3 });
  assert.equal(r.diamonds_earned, 3); assert.deepEqual(c.tx.map((t) => t.type), ['ranked_win', 'kda_bonus']);
  ok('Багийн Ranked хожил + K/D/A ≥ 3 → 2💎 + 1💎 бонус');

  c = fakeClient();
  r = await awardGameOutcome(c, { userId: 1, isWinner: false, durationMinutes: 30, ranked: true, kills: 9, assists: 6, deaths: 3 });
  assert.equal(r.diamonds_earned, 1);
  ok('Хожигдсон ч бодит чадвар өндөр бол K/D/A бонус +1💎');

  c = fakeClient();
  r = await awardGameOutcome(c, { userId: 1, isWinner: true, durationMinutes: 30, ranked: false, kills: 9, assists: 6, deaths: 3 });
  assert.equal(r.diamonds_earned, 0);
  ok('Энгийн (Ranked биш) өрөө → 💎 үгүй (хуучин дүрэм хэвээр)');

  c = fakeClient();
  r = await awardGameOutcome(c, { userId: 1, isWinner: false, isLeaver: true, durationMinutes: 30, ranked: true, kills: 20, deaths: 0 });
  assert.equal(r.diamonds_earned, 0);
  ok('Leaver → K/D/A бонусгүй');

  c = fakeClient();
  r = await awardGameOutcome(c, { userId: 1, isWinner: true, durationMinutes: 5, ranked: true, oneVsOne: true });
  assert.equal(r.counted, false); assert.equal(r.diamonds_earned, 0);
  ok('8 минутаас богино (remake) → юу ч олгохгүй');

  console.log(`\n=== rewards: ${n} PASS ===`);
})().catch((e) => { console.error(e); process.exit(1); });
