// Mesh (Tailscale ↔ Headscale) — клиентэд шигтгэсэн, чимээгүй (2026-09-27, Ш2).
// Юу хийдэг: Tailscale суусан эсэхийг шалгаад суугаагүй бол багцалсан MSI-г НЭГ UAC-аар чимээгүй суулгана,
// серверээс нэг удаагийн preauth түлхүүр авч манай Headscale-д нэгдэнэ (--unattended, DNS хөндөхгүй),
// mesh IP-гээ серверт мэдэгдэнэ. Тоглогч юу ч дарахгүй. Бүх child process async + timeout — Electron main блоклохгүй.
// Аюулгүй байдал: тоглогч ӨӨРИЙН Tailscale-тэй (өөр tailnet) бол ХӨНДӨХГҮЙ (state=ForeignTailnet).
// Лог: %APPDATA%/garena-mn-client/mesh.log
'use strict';
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const TS_EXE = process.env.TAILSCALE_EXE || 'C:\\Program Files\\Tailscale\\tailscale.exe';
const MIN_VERSION = '1.80.0';                      // headscale v0.29 minimum_version=v1.80
const DECLINE_TTL_MS = 24 * 60 * 60 * 1000;       // UAC-ыг татгалзвал 24 ц дахин асуухгүй
const MESH_HOST_PORT = 7000;                      // Ш3: хост дотор LAN listener (firewall дүрэм одооноос)

let _busy = false;
let _last = { installed: false, state: 'Unknown', ip: null, controlUrl: null, version: null, at: 0, error: null };
let _declinedAt = 0;

function logPath() { try { return path.join(process.env.APPDATA || os.homedir(), 'garena-mn-client', 'mesh.log'); } catch { return null; } }
function log(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log('[Mesh]', msg);
  try { const p = logPath(); if (p) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, line + '\n'); } } catch {}
}

function installed() { try { return fs.existsSync(TS_EXE); } catch { return false; } }

function run(args, timeout = 15000) {
  return new Promise((resolve) => {
    if (!installed()) return resolve({ code: -1, out: '', err: 'not installed' });
    execFile(TS_EXE, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout || ''), err: String(stderr || '') });
    });
  });
}

function verGte(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0), pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) > (pb[i] || 0)) return true; if ((pa[i] || 0) < (pb[i] || 0)) return false; }
  return true;
}

async function status() {
  if (!installed()) return set({ installed: false, state: 'NotInstalled', ip: null, controlUrl: null, version: null });
  const v = await run(['version']);
  const version = (v.out.split(/\r?\n/)[0] || '').trim() || null;
  const s = await run(['status', '--json']);
  let st = 'Unknown', ip = null, hostname = null, peers = 0;
  try {
    const j = JSON.parse(s.out);
    st = j.BackendState || 'Unknown';
    ip = (j.Self && Array.isArray(j.Self.TailscaleIPs) && j.Self.TailscaleIPs.find((x) => /^100\./.test(x))) || null;
    hostname = j.Self?.HostName || null;
    peers = Object.keys(j.Peer || {}).length;
  } catch {}
  let controlUrl = null;
  const p = await run(['debug', 'prefs']);
  try { controlUrl = JSON.parse(p.out).ControlURL || null; } catch {}
  return set({ installed: true, state: st, ip, controlUrl, version, hostname, peers });
}

function set(patch) { _last = { ..._last, ...patch, at: Date.now() }; return _last; }
function last() { return _last; }

// Багцалсан MSI-г нэг UAC-аар чимээгүй суулгана; мөн Ш3-ын хост listener-т firewall дүрэм (ижил elevated скриптэд).
function install(msiPath) {
  return new Promise((resolve) => {
    if (!msiPath || !fs.existsSync(msiPath)) return resolve({ ok: false, error: 'msi алга' });
    const dir = path.join(os.tmpdir(), 'garena-mesh-setup');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const ps1 = path.join(dir, 'mesh-setup.ps1');
    const msi = msiPath.replace(/'/g, "''");
    const exe = process.execPath.replace(/'/g, "''");
    fs.writeFileSync(ps1, [
      '# Garena.mn — mesh (Tailscale) чимээгүй суулгалт + firewall',
      `$p = Start-Process msiexec.exe -ArgumentList '/i','"${msi}"','/qn','/norestart','TS_NOLAUNCH=1','TS_UNATTENDEDMODE=always','TS_INSTALLUPDATES=never' -Wait -PassThru`,
      `netsh advfirewall firewall delete rule name="Garena.mn Mesh Host TCP In" >$null 2>&1`,
      `netsh advfirewall firewall add rule name="Garena.mn Mesh Host TCP In" dir=in action=allow protocol=TCP localport=${MESH_HOST_PORT} program="${exe}" profile=any | Out-Null`,
      'exit $p.ExitCode',
    ].join('\r\n'), 'utf8');
    log(`суулгаж байна: ${msiPath}`);
    const child = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `$r = Start-Process powershell -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File','${ps1.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru; exit $r.ExitCode`],
      { windowsHide: true, stdio: 'ignore' });
    const t = setTimeout(() => { try { child.kill(); } catch {} resolve({ ok: false, error: 'timeout' }); }, 10 * 60 * 1000);
    child.on('exit', (code) => {
      clearTimeout(t);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
      const ok = installed();
      log(`суулгалт дууслаа code=${code} installed=${ok}`);
      resolve(ok ? { ok: true } : { ok: false, error: code === 1223 || code === 1 ? 'declined' : `code ${code}` });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ ok: false, error: e.message }); });
  });
}

async function join({ login_server, auth_key, hostname }) {
  const r = await run(['up', '--reset', `--login-server=${login_server}`, `--auth-key=${auth_key}`, '--unattended', '--accept-dns=false', `--hostname=${hostname}`, '--timeout=60s'], 95000);
  log(`up → code=${r.code} ${r.err.trim().slice(0, 160)}`);
  return r.code === 0;
}

function sameServer(a, b) { return String(a || '').replace(/\/+$/, '').toLowerCase() === String(b || '').replace(/\/+$/, '').toLowerCase(); }

// Гол урсгал. ctx: { loginServer, msiPath, getAuthKey: async () => {login_server, auth_key, hostname}, report: async (rec) => {}, onStatus: (rec) => {} }
async function ensure(ctx) {
  if (_busy) return _last;
  _busy = true;
  try {
    if (!ctx.loginServer) return set({ state: 'Disabled', error: null });
    let st = await status();
    if (!st.installed) {
      if (Date.now() - _declinedAt < DECLINE_TTL_MS) return set({ state: 'NotInstalled', error: 'declined' });
      const r = await install(ctx.msiPath);
      if (!r.ok) { if (r.error === 'declined') _declinedAt = Date.now(); return set({ state: 'NotInstalled', error: r.error }); }
      st = await status();
    }
    if (st.version && !verGte(st.version, MIN_VERSION)) return set({ state: 'TooOld', error: `tailscale ${st.version} < ${MIN_VERSION}` });
    const ours = sameServer(st.controlUrl, ctx.loginServer);
    if (st.state === 'Running' && st.controlUrl && !ours) {
      // Тоглогч ӨӨРИЙН Tailscale/өөр tailnet-д нэвтэрсэн — хөндөхгүй (NeedsLogin бол манайхыг ашиглана)
      log(`гадаад tailnet (${st.controlUrl}) — алгасав`);
      return set({ state: 'ForeignTailnet', error: null });
    }
    if (!(st.state === 'Running' && ours && st.ip)) {
      const k = await ctx.getAuthKey();
      if (!k || !k.auth_key) return set({ state: st.state, error: 'authkey алга' });
      const ok = await join(k);
      st = await status();
      if (!ok || !(st.state === 'Running' && st.ip)) return set({ state: st.state, error: 'нэгдэж чадсангүй' });
    }
    set({ error: null });
    try { await ctx.report({ mesh_ip: st.ip, state: st.state, version: st.version, hostname: st.hostname }); } catch {}
    log(`OK ip=${st.ip} state=${st.state} v=${st.version} peers=${st.peers}`);
    return _last;
  } catch (e) {
    log(`ensure алдаа: ${e.message}`);
    return set({ error: e.message });
  } finally {
    _busy = false;
    try { ctx.onStatus?.(_last); } catch {}
  }
}

module.exports = { TS_EXE, installed, status, ensure, last, run, verGte, sameServer, _setDeclinedForTest: (t) => { _declinedAt = t; } };
