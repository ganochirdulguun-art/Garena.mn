// ── Garena.mn WarKey — платформд шигтгэсэн (embedded) горим ──
// WarKey (C#/.NET, тусдаа процесс) платформын суулгацад багцлагдана. Платформ нэвтэрмэгц
// WarKey-г далд (цонхгүй) горимоор асааж, платформ хаагдахад хамт унтраана. WarKey нь
// 127.0.0.1 дээр локал API нээж (порт + нууц түлхүүрийг платформ env-ээр өгнө), платформын
// "WarKey" таб тэр API-аар inventory/skill/quickchat тохиргоог уншиж/бичнэ. Тоглоом доторх
// Ctrl+F6 overlay нь WarKey-ийн native overlay хэвээр (хамгийн хурдан, найдвартай хэсэг).
// Ямар ч алдаа платформыг зогсоохгүй: WarKey олдохгүй/асахгүй бол таб нь шалтгааныг харуулна.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const PORT_BASE = 47831;
let _proc = null;
let _port = 0;
let _secret = '';
let _tokenProvider = null;   // () => JWT string | null
let _lastError = null;
let _restarts = 0;
let _stopping = false;
let _startedAt = 0;
let _exitCode = null;
let _mode = 'normal';   // 'normal' = child процесс | 'elevated' = UAC-аар асаасан (PID-гүй, зөвхөн API-аар удирдана)
let _elevatedAlive = false;

function log(...a) { console.log('[WarKey]', ...a); }

// Багцлагдсан exe-ийн зам: packaged → resources/warkey/GarenaWarKey.exe; dev → client/resources/warkey/
function exePath() {
  const cands = [
    process.resourcesPath ? path.join(process.resourcesPath, 'warkey', 'GarenaWarKey.exe') : null,
    path.join(__dirname, '..', '..', 'resources', 'warkey', 'GarenaWarKey.exe'),
  ].filter(Boolean);
  for (const p of cands) { try { if (fs.existsSync(p)) return p; } catch {} }
  return null;
}

function setTokenProvider(fn) { _tokenProvider = typeof fn === 'function' ? fn : null; }

function isRunning() { return _mode === 'elevated' ? _elevatedAlive : !!(_proc && _proc.exitCode === null && !_proc.killed); }

// WarKey-г асаана (аль хэдийн ажиллаж байвал юу ч хийхгүй). Windows дээр л.
function start(reason = '') {
  if (process.platform !== 'win32') { _lastError = 'зөвхөн Windows'; return false; }
  if (isRunning()) return true;
  const exe = exePath();
  if (!exe) { _lastError = 'WarKey exe олдсонгүй (суулгацад багцлагдаагүй)'; log(_lastError); return false; }
  const token = _tokenProvider ? _tokenProvider() : null;
  if (!token) { _lastError = 'нэвтрээгүй'; return false; }
  _stopping = false;
  _mode = 'normal';
  _port = PORT_BASE + Math.floor(Math.random() * 100);
  _secret = crypto.randomBytes(24).toString('hex');
  _lastError = null;
  _exitCode = null;
  _startedAt = Date.now();
  try {
    _proc = spawn(exe, ['--embedded'], {
      detached: false, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, GARENA_WARKEY_TOKEN: token, GARENA_WARKEY_PORT: String(_port), GARENA_WARKEY_SECRET: _secret },
    });
  } catch (e) { _lastError = 'асаахад алдаа: ' + e.message; log(_lastError); _proc = null; return false; }
  const p = _proc;
  p.on('error', (e) => { _lastError = 'процесс алдаа: ' + e.message; log(_lastError); });
  p.on('exit', (code) => {
    _exitCode = code;
    if (p !== _proc) return;
    _proc = null;
    log(`гарлаа code=${code} (${Math.round((Date.now() - _startedAt) / 1000)}с)`);
    if (_stopping) return;
    if (code === 3) { _lastError = 'WarKey standalone аль хэдийн ажиллаж байна — түүнийг хаагаад "Дахин асаах" дарна уу'; return; }
    // Унасан бол 3 хүртэл удаа дахин асаана (10с зайтай); удаан ажилласан бол тоолуурыг тэглэнэ
    if (Date.now() - _startedAt > 5 * 60 * 1000) _restarts = 0;
    if (_restarts < 3) { _restarts += 1; setTimeout(() => { if (!_stopping) start('restart'); }, 10000); }
    else _lastError = `WarKey ${_restarts} удаа унасан — "Дахин асаах" дарна уу`;
  });
  log(`асаав pid=${p.pid} port=${_port} (${reason})`);
  return true;
}

function stop() {
  _stopping = true;
  if (_mode === 'elevated') {
    // Админ эрхтэй процессыг энгийн эрхээр kill хийж чадахгүй — API-аар унтраана (watchdog ч 30с-д унтраана)
    if (_elevatedAlive) api('POST', '/shutdown').catch(() => {});
    _elevatedAlive = false;
    _mode = 'normal';
    log('elevated WarKey-д shutdown илгээв');
    return;
  }
  const p = _proc;
  _proc = null;
  if (!p) return;
  try { p.kill(); } catch {}
  log('зогсоов');
}

// WC3 админ эрхээр ажиллаж байвал энгийн эрхийн WarKey товч дамжуулж/санах ой уншиж чадахгүй →
// хэрэглэгч хүсвэл UAC-аар (нэг удаа) админ эрхтэй асаана. Env дамждаггүй тул аргументаар өгнө.
async function startElevated() {
  if (process.platform !== 'win32') return false;
  stop();
  const exe = exePath();
  const token = _tokenProvider ? _tokenProvider() : null;
  if (!exe || !token) { _lastError = !exe ? 'WarKey exe олдсонгүй' : 'нэвтрээгүй'; return false; }
  _stopping = false;
  _mode = 'elevated';
  _port = PORT_BASE + Math.floor(Math.random() * 100);
  _secret = crypto.randomBytes(24).toString('hex');
  _lastError = null;
  _startedAt = Date.now();
  const argList = ['--embedded', '--port', String(_port), '--secret', _secret, '--token', token].map((a) => `'${String(a).replace(/'/g, "''")}'`).join(',');
  const ps = `Start-Process -FilePath '${exe.replace(/'/g, "''")}' -ArgumentList ${argList} -Verb RunAs -WindowStyle Hidden`;
  try {
    const r = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'ignore', windowsHide: true });
    await new Promise((res) => { r.on('exit', res); r.on('error', res); });
  } catch (e) { _lastError = 'UAC асаалт алдаа: ' + e.message; _mode = 'normal'; return false; }
  // UAC зөвшөөрсөн эсэхийг API-аар мэдэрнэ (15с хүртэл)
  for (let i = 0; i < 15; i++) {
    await new Promise((res) => setTimeout(res, 1000));
    _elevatedAlive = true;
    const st = await api('GET', '/state');
    if (st && st.ok === true) { log(`elevated асав port=${_port}`); return true; }
    _elevatedAlive = false;
  }
  _lastError = 'Админ эрхээр асаагүй (UAC татгалзсан?)';
  _mode = 'normal';
  return false;
}

// Локал API дуудлага (127.0.0.1) — 2с timeout, алдаанд {ok:false, error}
function api(method, route, body) {
  return new Promise((resolve) => {
    if (!isRunning() || !_port) return resolve({ ok: false, error: _lastError || 'WarKey ажиллахгүй байна', running: false });
    const onFail = (msg) => { if (_mode === 'elevated') _elevatedAlive = false; resolve({ ok: false, error: msg, running: isRunning() }); };
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      host: '127.0.0.1', port: _port, path: route, method, timeout: 2500,
      headers: { 'x-warkey-secret': _secret, 'content-type': 'application/json', 'content-length': data ? data.length : 0 },
    }, (res) => {
      let buf = '';
      res.on('data', (d) => (buf += d));
      res.on('end', () => { try { resolve({ ok: res.statusCode < 300, status: res.statusCode, ...JSON.parse(buf || '{}') }); } catch { resolve({ ok: false, error: 'буруу хариу' }); } });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', (e) => onFail(e.message));
    if (data) req.write(data);
    req.end();
  });
}

function status() {
  return { running: isRunning(), mode: _mode, port: _port, error: _lastError, exit_code: _exitCode, bundled: !!exePath(), restarts: _restarts, uptime_sec: isRunning() ? Math.round((Date.now() - _startedAt) / 1000) : 0 };
}

async function restart() { stop(); _restarts = 0; await new Promise((r) => setTimeout(r, 800)); return start('manual'); }

module.exports = { start, stop, restart, startElevated, status, api, isRunning, setTokenProvider, exePath };
