// Tailscale MSI-г суулгацад багцлахын өмнө татна (git-д оруулахгүй, resources/ — asar-ын ГАДНА extraResources).
// Build: package.json "build" скрипт эхэнд ажиллана. Хувилбар өөрчлөхдөө TS_VERSION + src/services/mesh.js-ийн MIN_VERSION-ийг хамт.
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');

const TS_VERSION = process.env.TS_VERSION || '1.102.4';
const URL = `https://pkgs.tailscale.com/stable/tailscale-setup-${TS_VERSION}-amd64.msi`;
const OUT = path.join(__dirname, '..', 'resources', 'tailscale-setup.msi');
const MIN_BYTES = 20 * 1024 * 1024;

function looksLikeMsi(p) {
  try {
    const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, 0); fs.closeSync(fd);
    return b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && fs.statSync(p).size > MIN_BYTES;   // OLE compound file
  } catch { return false; }
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const tmp = dest + '.part';
    const file = fs.createWriteStream(tmp);
    const req = https.get(url, { headers: { 'User-Agent': 'garena-mn-build' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) { file.close(); fs.rmSync(tmp, { force: true }); return download(res.headers.location, dest).then(resolve, reject); }
      if (res.statusCode !== 200) { file.close(); fs.rmSync(tmp, { force: true }); return reject(new Error(`HTTP ${res.statusCode}`)); }
      res.pipe(file);
      file.on('finish', () => file.close(() => { fs.renameSync(tmp, dest); resolve(); }));
    });
    req.on('error', (e) => { file.close(); fs.rmSync(tmp, { force: true }); reject(e); });
  });
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (looksLikeMsi(OUT)) { console.log(`[fetch-tailscale] бэлэн: ${OUT} (${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB)`); return; }
  console.log(`[fetch-tailscale] татаж байна ${URL}`);
  await download(URL, OUT);
  if (!looksLikeMsi(OUT)) { fs.rmSync(OUT, { force: true }); throw new Error('MSI биш/дутуу файл'); }
  console.log(`[fetch-tailscale] OK ${(fs.statSync(OUT).size / 1048576).toFixed(1)} MB`);
})().catch((e) => { console.error('[fetch-tailscale] АЛДАА:', e.message); process.exit(1); });
