'use strict';
// @everyone: зөвхөн эзэн/админ; бусдынх @\u200beveryone болж саармагжина.
const assert = require('node:assert/strict');
const path = require('node:path');
const serverDir = path.resolve(__dirname, '..');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');
let pass = 0; const ok = (n) => { pass++; console.log('PASS ' + n); };
Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: 'test-secret', SKIP_DB_MIGRATIONS: 'true', OWNER_USER_IDS: '7', ADMIN_DISCORD_IDS: 'd-admin', DISCORD_CLIENT_ID: 'x', DISCORD_CLIENT_SECRET: 'x', DISCORD_REDIRECT_URI: 'http://localhost/cb' });
require.cache[dbModulePath] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { query: async () => ({ rows: [], rowCount: 0 }) } };
const { _everyoneGate: gate } = require(path.join(serverDir, 'src', 'index.js'));
(async () => {
  assert.equal(await gate({ user: { id: 1 } }, 'сайн уу'), 'сайн уу'); ok('@everyone-гүй бол хөндөхгүй');
  assert.equal(await gate({ user: { id: 1, discord_id: 'x' } }, '@everyone тоглоё @here'), '@\u200beveryone тоглоё @\u200bhere'); ok('Энгийн хэрэглэгчийнх саармагжина');
  assert.equal(await gate({ user: { id: 7 } }, '@everyone тоглоё'), '@everyone тоглоё'); ok('Эзэн (OWNER_USER_IDS) хэвээр');
  assert.equal(await gate({ user: { id: 2, discord_id: 'd-admin' } }, '@Everyone!'), '@Everyone!'); ok('Админ (ADMIN_DISCORD_IDS) хэвээр');
  assert.equal(await gate({ user: { id: 1 } }, 'mail@everyone.mn'), 'mail@\u200beveryone.mn'); ok('Хүрээ: имэйл маягийн текст ч саармагжина (хор хөнөөлгүй)');
  console.log(`=== everyone: ${pass} PASS ===`); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
