// ══════════════════════════════════════════════════════════════
// Map-ын сан — клиент тал (main процесс, 2026-09-30).
// Бүгд ASYNC (main процессыг блоклох нь LAN proxy-г царцаадаг — синхрон fs/exec ХОРИОТОЙ).
//  • wc3Info(paths)    — бүртгэсэн WC3 exe-ийн хавтас, Game.dll/exe хувилбар, Maps\Download зам
//  • localStatus(dir, files) — Maps\Download дахь файлуудын хэмжээ + SHA-256 (каталогтой харьцуулах)
//  • download(...)     — серверээс татаж SHA-256 шалгаад Maps\Download руу бичнэ (tmp → rename)
// ══════════════════════════════════════════════════════════════
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const MAP_RE = /\.(w3x|w3m)$/i;
function safeFilename(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/[^\w .()[\]+-]/g, '_').trim().slice(0, 120);
  return MAP_RE.test(base) && base.length > 4 ? base : null;
}
async function exists(p) { try { await fsp.access(p); return true; } catch { return false; } }
function fileVersion(p) {
  // Замыг env-ээр дамжуулна (PowerShell injection-гүй)
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-Item -LiteralPath $env:GX_P).VersionInfo.FileVersion'],
      { windowsHide: true, timeout: 8000, env: { ...process.env, GX_P: p } },
      (err, out) => resolve(err ? null : String(out || '').trim() || null));
  });
}
function isWc3Exe(p) { return /war3|frozen throne|warcraft|wc3/i.test(path.basename(String(p || ''))); }

async function wc3Info(exePaths) {
  const list = [];
  for (const exe of exePaths) {
    if (!exe) continue;
    const dir = path.dirname(exe);
    // Нэрээр (war3/wc3/...) ЭСВЭЛ хавтсанд Game.dll / war3.exe байвал WC3 гэж үзнэ (WC3-Window.exe, WC3-OpenGL.exe г.м.)
    if (!isWc3Exe(exe) && !(await exists(path.join(dir, 'Game.dll'))) && !(await exists(path.join(dir, 'war3.exe')))) continue;
    const ok = await exists(exe);
    const gameDll = path.join(dir, 'Game.dll');
    const hasDll = await exists(gameDll);
    const version = hasDll ? await fileVersion(gameDll) : (ok ? await fileVersion(exe) : null);   // 1.26-д жинхэнэ хувилбар Game.dll-д
    // WC3 1.26-ийн стандарт нь Maps\Download; зарим суулгацад Maps\Downloads байдаг — байгааг нь ашиглана
    const dl = path.join(dir, 'Maps', 'Download'), dls = path.join(dir, 'Maps', 'Downloads');
    const mapsDir = (await exists(dl)) ? dl : (await exists(dls)) ? dls : dl;
    list.push({ exe, dir, exists: ok, version, is126: !!version && /^1[.,]\s*26/.test(version), mapsDir });
  }
  const primary = list.find((x) => x.exists) || list[0] || null;
  return { installs: list, primary };
}

async function sha256File(p) { return crypto.createHash('sha256').update(await fsp.readFile(p)).digest('hex'); }

async function localStatus(mapsDir, files) {
  const out = {};
  if (!mapsDir) return out;
  for (const f of (files || []).slice(0, 300)) {
    const name = safeFilename(f); if (!name) continue;
    const p = path.join(mapsDir, name);
    try { const st = await fsp.stat(p); out[name] = { size: st.size, sha256: await sha256File(p) }; } catch {}
  }
  return out;
}

// Татаж, SHA-256 шалгаад түр файл руу бичнэ (Program Files-д шууд бичих эрх ихэвчлэн алга)
async function fetchToTemp({ client, id, filename, sha256, onProgress }) {
  const name = safeFilename(filename);
  if (!name) throw new Error('Буруу файлын нэр');
  const res = await client.get(`/maps/${encodeURIComponent(id)}/file`, {
    responseType: 'arraybuffer', timeout: 180000, maxContentLength: 40 * 1024 * 1024,
    onDownloadProgress: (e) => { if (e.total) onProgress?.(Math.round((e.loaded / e.total) * 100)); },
  });
  const buf = Buffer.from(res.data);
  const got = crypto.createHash('sha256').update(buf).digest('hex');
  if (sha256 && got !== String(sha256).toLowerCase()) throw new Error('Файл гэмтсэн (SHA-256 таарахгүй) — дахин оролдоно уу');
  const tmpDir = path.join(require('os').tmpdir(), 'garena-maps');
  await fsp.mkdir(tmpDir, { recursive: true });
  const tmp = path.join(tmpDir, `${Date.now()}-${name}`);
  await fsp.writeFile(tmp, buf);
  return { name, tmp, size: buf.length, sha256: got };
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;
// Эрхтэй бол шууд зөөнө; эрхгүй (EPERM/EACCES) бол НЭГ UAC-аар бүгдийг хуулна
async function installFiles(items, mapsDir) {
  const pending = [];
  for (const it of items) {
    const dest = path.join(mapsDir, it.name);
    try {
      await fsp.mkdir(mapsDir, { recursive: true });
      await fsp.copyFile(it.tmp, dest);
      await fsp.unlink(it.tmp).catch(() => {});
    } catch (e) {
      if (!['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
      pending.push({ tmp: it.tmp, dest });
    }
  }
  if (!pending.length) return { elevated: false };
  const script = path.join(require('os').tmpdir(), 'garena-maps', `install-${Date.now()}.ps1`);
  const lines = ['$ErrorActionPreference = "Stop"', `New-Item -ItemType Directory -Force -Path ${psq(mapsDir)} | Out-Null`]
    .concat(pending.map((p) => `Copy-Item -LiteralPath ${psq(p.tmp)} -Destination ${psq(p.dest)} -Force`));
  await fsp.writeFile(script, '\ufeff' + lines.join('\r\n'), 'utf8');
  const cmd = `$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File',${psq(script)}; exit $p.ExitCode`;
  await new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 180000 }, (err) => {
      if (err) reject(new Error('Map хавтас руу хуулах зөвшөөрөл өгөөгүй (UAC) эсвэл алдаа гарлаа'));
      else resolve();
    });
  });
  // шалгах
  for (const p of pending) { await fsp.access(p.dest).catch(() => { throw new Error('Map хуулагдсангүй — дахин оролдоно уу'); }); fsp.unlink(p.tmp).catch(() => {}); }
  fsp.unlink(script).catch(() => {});
  return { elevated: true };
}
async function download({ client, id, filename, sha256, mapsDir, onProgress }) {
  if (!mapsDir) throw new Error('Warcraft III олдсонгүй — эхлээд Тохиргоо → Тоглоомоос war3.exe-ээ нэмнэ үү');
  const f = await fetchToTemp({ client, id, filename, sha256, onProgress });
  const r = await installFiles([f], mapsDir);
  return { path: path.join(mapsDir, f.name), size: f.size, sha256: f.sha256, elevated: r.elevated };
}
async function downloadMany({ client, maps, mapsDir, onProgress }) {
  if (!mapsDir) throw new Error('Warcraft III олдсонгүй — эхлээд Тохиргоо → Тоглоомоос war3.exe-ээ нэмнэ үү');
  const got = [];
  for (const m of maps) got.push(await fetchToTemp({ client, ...m, onProgress: (pct) => onProgress?.(m.id, pct) }));
  const r = await installFiles(got, mapsDir);
  return { count: got.length, elevated: r.elevated };
}

module.exports = { wc3Info, localStatus, download, downloadMany, safeFilename, isWc3Exe };
