#!/usr/bin/env node
// Багцлах WarKey exe-г GarenaWarKey release-ээс татна → client/resources/warkey/GarenaWarKey.exe
// Хэрэглээ: node scripts/fetch-warkey.js [vX.Y.Z]   (хувилбар өгөхгүй бол package.json "warkeyVersion")
// electron-builder extraResources энэ хавтсыг суулгацад (resources/warkey/) хуулна. Exe git-д орохгүй.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pkg = require(path.join(__dirname, '..', 'package.json'));
const ver = process.argv[2] || pkg.warkeyVersion;
if (!ver) { console.error('warkeyVersion package.json-д алга'); process.exit(2); }
const dir = path.join(__dirname, '..', 'resources', 'warkey');
fs.mkdirSync(dir, { recursive: true });
const out = path.join(dir, 'GarenaWarKey.exe');
const stamp = path.join(dir, 'VERSION');
if (fs.existsSync(out) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === ver) {
  console.log(`WarKey ${ver} аль хэдийн байна: ${out}`);
  process.exit(0);
}
console.log(`WarKey ${ver} татаж байна…`);
execFileSync('gh', ['release', 'download', ver, '-R', 'ganochirdulguun-art/GarenaWarKey', '-p', 'GarenaWarKey.exe', '-D', dir, '--clobber'], { stdio: 'inherit' });
fs.writeFileSync(stamp, ver + '\n');
console.log(`OK → ${out} (${Math.round(fs.statSync(out).size / 1048576)} MB)`);
