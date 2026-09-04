#!/usr/bin/env node
// Билдийн ДАРАА, ПУБЛИШИЙН ӨМНӨ заавал: dist/win-unpacked/resources/app.asar бүрэн бүтэн эсэхийг шалгана.
// 2026-09-04 v2.8.3 осол: билдийн лог client хавтас дотор бичигдэж asar руу багцлагдсан, багцлах явцад
// хэмжээ нь өссөн тул араас нь байгаа бүх файлын офсет шилжсэн → package.json уншигдахгүй → апп exit 1, цонхгүй.
// Энэ скрипт тэр төрлийн эвдрэлийг (JSON биш package.json, солигдсон main.js, root-д орсон лог, хэтэрсэн офсет) барина.
//
// Хэрэглээ:
//   node scripts/verify-build.js                 → dist/win-unpacked/resources/app.asar шалгана
//   node scripts/verify-build.js <asar>          → заасан asar
//   node scripts/verify-build.js --launch        → нэмээд win-unpacked/Garena.mn.exe-г нээж 12с амьд эсэхийг шалгана
//                                                  (⚠️ апп аль хэдийн нээлттэй бол single-instance-ээс exit 0 болж худал унана)
//   node scripts/verify-build.js --selftest      → зөв asar-ыг хуулж санаатай эвдээд шалгалт барьж байгааг батална
// Гарах код: 0 = OK, 1 = асуудал (публиш ХИЙХГҮЙ).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_ASAR = path.join(__dirname, '..', 'dist', 'win-unpacked', 'resources', 'app.asar');
const DEFAULT_EXE = path.join(__dirname, '..', 'dist', 'win-unpacked', 'Garena.mn.exe');

// asar формат: [u32 4][u32 headerSize][u32 pickleLen][u32 strLen][JSON header …][файлын өгөгдөл 8+headerSize-аас]
function openAsar(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const head = Buffer.alloc(16);
    if (fs.readSync(fd, head, 0, 16, 0) !== 16) throw new Error('asar хэт богино');
    if (head.readUInt32LE(0) !== 4) throw new Error('asar pickle эхлэл буруу (uint32 != 4)');
    const headerSize = head.readUInt32LE(4);
    const strLen = head.readUInt32LE(12);
    if (strLen <= 0 || strLen > headerSize) throw new Error('asar header урт буруу');
    const json = Buffer.alloc(strLen);
    fs.readSync(fd, json, 0, strLen, 16);
    return { fd, header: JSON.parse(json.toString('utf8')), dataStart: 8 + headerSize, total: fs.fstatSync(fd).size };
  } catch (e) { fs.closeSync(fd); throw e; }
}

function lookup(header, rel) {
  let node = header;
  for (const part of rel.split('/')) {
    node = node.files && node.files[part];
    if (!node) return null;
  }
  return node;
}

function readEntry(ctx, rel) {
  const ent = lookup(ctx.header, rel);
  if (!ent || ent.offset === undefined) return null;          // unpacked эсвэл алга
  const buf = Buffer.alloc(ent.size);
  fs.readSync(ctx.fd, buf, 0, ent.size, ctx.dataStart + Number(ent.offset));
  return buf;
}

const snip = (buf, n = 60) => buf.toString('utf8', 0, n).replace(/\s+/g, ' ') + '…';

function checkAsar(asarPath) {
  const problems = [];
  let ctx;
  try { ctx = openAsar(asarPath); }
  catch (e) { return { ok: false, problems: ['asar нээгдэхгүй: ' + e.message] }; }
  try {
    // 1) package.json — JSON бөгөөд main-тай
    let pkg = null;
    const pkgBuf = readEntry(ctx, 'package.json');
    if (!pkgBuf) problems.push('package.json asar дотор алга');
    else {
      try { pkg = JSON.parse(pkgBuf.toString('utf8')); }
      catch { problems.push('package.json JSON биш (агуулга солигдсон): ' + snip(pkgBuf)); }
      if (pkg && typeof pkg.main !== 'string') problems.push('package.json-д "main" алга');
    }
    // 2) main.js — жинхэнэ Electron main мөн үү
    const mainName = (pkg && typeof pkg.main === 'string') ? pkg.main : 'main.js';
    const mainBuf = readEntry(ctx, mainName);
    if (!mainBuf) problems.push(mainName + ' asar дотор алга');
    else if (!/require\(\s*['"]electron['"]\s*\)/.test(mainBuf.toString('utf8', 0, 600)))
      problems.push(mainName + " эхэнд require('electron') алга (агуулга солигдсон): " + snip(mainBuf));
    // 3) root-д лог/түр файл багцлагдсан уу (build.files хасалт ажиллаагүй)
    for (const name of Object.keys(ctx.header.files || {}))
      if (/\.(log|tmp)$/i.test(name)) problems.push('asar root-д ' + name + ' орсон — билдийн лог хавтас дотор бичигдсэн');
    // 4) бүх файлын offset+size asar-ын хэмжээнээс хэтрэхгүй
    (function walk(node, prefix) {
      for (const [n, e] of Object.entries(node.files || {})) {
        if (e.files) walk(e, prefix + n + '/');
        else if (e.offset !== undefined && ctx.dataStart + Number(e.offset) + e.size > ctx.total)
          problems.push(prefix + n + ': offset asar-ын хэмжээнээс хэтэрсэн');
      }
    })(ctx.header, '');
    return { ok: problems.length === 0, problems, version: pkg && pkg.version, main: mainName };
  } finally { fs.closeSync(ctx.fd); }
}

// Билдсэн exe-г нээж ms хугацаанд амьд байвал OK; дараа нь мод болгон нь хаана.
function launchTest(exePath, ms = 12000) {
  return new Promise((resolve) => {
    if (!fs.existsSync(exePath)) return resolve({ ok: false, note: exePath + ' алга' });
    const child = spawn(exePath, [], { detached: true, stdio: 'ignore' });
    let exited = null;
    child.on('exit', (code) => { exited = code; });
    child.on('error', (e) => { exited = 'error ' + e.message; });
    setTimeout(() => {
      if (exited === null) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
        resolve({ ok: true, note: ms + 'мс амьд, цонхтой процесс' });
      } else {
        resolve({ ok: false, note: 'exit ' + exited + (exited === 0 ? ' — single-instance? апп аль хэдийн нээлттэй байж магадгүй, хаагаад дахин ажиллуул' : ' — main процесс унасан') });
      }
    }, ms);
  });
}

// Зөв asar-ыг хуулж package.json-ы байтуудыг NSIS текстээр дарж, шалгалт барьж байгааг батална.
function selfTest(asarPath) {
  const good = checkAsar(asarPath);
  if (!good.ok) return { ok: false, note: 'эх asar өөрөө буруу: ' + good.problems.join('; ') };
  const tmp = path.join(os.tmpdir(), 'verify-build-selftest-' + process.pid + '.asar');
  fs.copyFileSync(asarPath, tmp);
  try {
    const ctx = openAsar(tmp);
    const ent = lookup(ctx.header, 'package.json');
    fs.closeSync(ctx.fd);
    const fd = fs.openSync(tmp, 'r+');
    const junk = Buffer.from(' хуучин апп-г хаах\n!macro customInit\n  nsExec::Exec ...'.padEnd(ent.size, ' '), 'utf8').subarray(0, ent.size);
    fs.writeSync(fd, junk, 0, junk.length, ctx.dataStart + Number(ent.offset));
    fs.closeSync(fd);
    const bad = checkAsar(tmp);
    return bad.ok ? { ok: false, note: 'эвдэрсэн asar-ыг OK гэж алдав!' } : { ok: true, note: 'эвдрэл баригдав: ' + bad.problems[0] };
  } finally { try { fs.unlinkSync(tmp); } catch {} }
}

if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const asarPath = args.find((a) => !a.startsWith('--')) || DEFAULT_ASAR;
    let failed = false;
    const r = checkAsar(asarPath);
    console.log((r.ok ? '✅' : '❌') + ' asar: ' + asarPath + (r.version ? '  (v' + r.version + ', main=' + r.main + ')' : ''));
    for (const p of r.problems) console.log('   • ' + p);
    failed = failed || !r.ok;
    if (args.includes('--selftest')) {
      const s = selfTest(asarPath);
      console.log((s.ok ? '✅' : '❌') + ' selftest: ' + s.note);
      failed = failed || !s.ok;
    }
    if (args.includes('--launch') && r.ok) {
      const l = await launchTest(DEFAULT_EXE);
      console.log((l.ok ? '✅' : '❌') + ' launch: ' + l.note);
      failed = failed || !l.ok;
    }
    if (failed) { console.log('\n⛔ ПУБЛИШ ХИЙХГҮЙ — билдийг засаад дахин шалга.'); process.exit(1); }
    console.log('\n✔ Публишид бэлэн.');
  })();
}

module.exports = { checkAsar, launchTest, selfTest };
