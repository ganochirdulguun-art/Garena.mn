// !rank / !ping чатын команд (routes/chatCommands.js) — задлал, cooldown, LAN тоглогч олох, формат
const assert = require('assert');
const cc = require('../src/routes/chatCommands');
let n = 0; const ok = (name) => { n++; console.log('PASS ' + name); };

(async () => {
  assert.deepStrictEqual(cc.parse('!rank'), { cmd: 'rank', arg: '' });
  assert.deepStrictEqual(cc.parse('  !PING  Bibi '), { cmd: 'ping', arg: 'Bibi' });
  assert.strictEqual(cc.parse('!rankx'), null);
  assert.strictEqual(cc.parse('hello !rank'), null);
  ok('parse: !rank / !ping [нэр]');

  assert.strictEqual(cc.onCooldown(7, 1000), false);
  assert.strictEqual(cc.onCooldown(7, 5000), true);
  assert.strictEqual(cc.onCooldown(7, 1000 + cc.COOLDOWN_MS), false);
  ok('cooldown 10с');

  const users = { 1: { id: 1, username: 'Host', tierbot_tier: '2-3', wins: 10, losses: 4, leavers: 1 }, 2: { id: 2, username: 'Joiner', tierbot_tier: null, wins: 0, losses: 2, leavers: 0 }, 3: { id: 3, username: 'Other', wins: 5, losses: 5, leavers: 0 } };
  const db = { query: async (sql, p) => {
    if (sql.includes('FROM lan_game_players')) return { rows: [{ token: 'tokA', user_id: 2 }] };
    if (sql.includes('FROM users u WHERE u.id = ANY')) return { rows: p[0].map((id) => users[id]).filter(Boolean) };
    if (sql.includes('LOWER(username) = LOWER($1)')) { const u = Object.values(users).find((x) => x.username.toLowerCase() === String(p[0]).toLowerCase()); return { rows: u ? [{ id: u.id }] : [] }; }
    return { rows: [] };
  } };
  const games = [{ token: 'tokA', host_user_id: 1 }, { token: 'tokB', host_user_id: 3 }];
  cc._lastAt.clear();
  let t = await cc.handle({ userId: 1, text: '!rank', db, games, rttOf: () => null });
  assert.ok(t.includes('Host: 10 хожил / 4 хожигдол / 1 leaver · Tier 2-3'), t);
  assert.ok(t.includes('Joiner: 0 хожил / 2 хожигдол / 0 leaver') && !t.includes('Other'), t);
  ok('!rank: хост + нэгдсэн тоглогч (бусад тоглоомынх орохгүй)');

  cc._lastAt.clear();
  t = await cc.handle({ userId: 2, text: '!ping', db, games, rttOf: (id) => (id === 1 ? 12 : null) });
  assert.strictEqual(t, '📡 Host: 12мс  |  Joiner: —');
  ok('!ping: joiner-ийн талаас ч ижил тоглоом, RTT байхгүй бол —');

  cc._lastAt.clear();
  t = await cc.handle({ userId: 3, text: '!rank', db, games: [games[0]], rttOf: () => null });
  assert.ok(t.includes('LAN тоглоомд ороогүй'), t);
  t = await cc.handle({ userId: 3, text: '!rank', db, games, rttOf: () => null });
  assert.strictEqual(t, null);   // cooldown
  cc._lastAt.clear();
  t = await cc.handle({ userId: 3, text: '!rank other', db, games, rttOf: () => null });
  assert.ok(t.includes('Other: 5 хожил / 5 хожигдол'), t);
  t = await cc.handle({ userId: 9, text: '!rank nobody', db, games, rttOf: () => null });
  assert.ok(t.includes('олдсонгүй'), t);
  ok('LAN тоглоомгүй → заавар; cooldown; нэрээр хайх');
  console.log(`\n=== chatcmd: ${n} PASS ===`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
