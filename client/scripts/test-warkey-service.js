#!/usr/bin/env node
// Шигтгэсэн WarKey-ийн платформ талын сервисийг (src/services/warkey.js) бодит багцлагдсан exe-ээр турших:
// resources/warkey/GarenaWarKey.exe асааж → локал API /state → inventory бичих/арилгах → stop. Профайл хөндөгдөхгүй.
// Хэрэглээ: node scripts/test-warkey-service.js   (платформд нэвтэрсэн token.json + платформ асаалттай байх ёстой)
'use strict';
const fs = require('fs');
const path = require('path');
const svc = require('../src/services/warkey');

const tokenFile = path.join(process.env.APPDATA, 'garena-mn-client', 'token.json');
const token = JSON.parse(fs.readFileSync(tokenFile, 'utf8')).token;
const profile = path.join(process.env.LOCALAPPDATA, 'LexusWarKey', 'profile.json');
const backup = profile + '.svc-backup';
if (fs.existsSync(profile)) fs.copyFileSync(profile, backup);
let pass = 0, fail = 0;
const chk = (n, c, x = '') => { if (c) { pass++; console.log('PASS ' + n + (x ? ' — ' + x : '')); } else { fail++; console.log('FAIL ' + n + (x ? ' — ' + x : '')); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  chk('exe багцлагдсан', !!svc.exePath(), svc.exePath() || '');
  svc.setTokenProvider(() => token);
  chk('start() → true', svc.start('test') === true, svc.status().error || '');
  await sleep(3500);
  const st = await svc.api('GET', '/state');
  chk('GET /state ok', st.ok === true, JSON.stringify({ version: st.version, account: st.account, locked: st.locked, hook: st.hookInstalled }));
  const s1 = await svc.api('POST', '/inventory', { slot: 5, vk: 0x4B });
  chk('inventory slot6=K', s1.ok === true && s1.inventory && s1.inventory[5].from === 'K');
  const s2 = await svc.api('POST', '/inventory', { slot: 5, vk: 0 });
  chk('inventory slot6 арилгав', s2.ok === true && s2.inventory && s2.inventory[5].from === '');
  chk('status(): running', svc.status().running === true, JSON.stringify(svc.status()));
  svc.stop();
  await sleep(1500);
  chk('stop() → унтарсан', svc.status().running === false, JSON.stringify(svc.status()));
  if (fs.existsSync(backup)) { fs.copyFileSync(backup, profile); fs.unlinkSync(backup); }
  console.log(`\n=== warkey service: ${pass} PASS, ${fail} FAIL ===`);
  process.exit(fail ? 1 : 0);
})();
