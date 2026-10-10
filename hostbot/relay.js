#!/usr/bin/env node
/**
 * Garena.mn Player-Host Relay — WC3 LAN тоглоомыг интернэтээр дамжуулах reverse-connect relay.
 *
 * Асуудал: хост тоглогч NAT-ын цаана тул relay түүн рүү ЗАЛГАЖ чадахгүй. Тиймээс:
 *   1) Хост клиент relay руу ГАДАГШ control холболт нээж бүртгүүлнэ (game = санамсаргүй токен).
 *   2) Joiner-ийн WC3 → joiner клиентийн локал proxy → relay руу гадагш "joiner" холболт.
 *   3) Relay хостод control-оор "newjoiner + session" мэдэгдэнэ.
 *   4) Хост клиент relay руу "hostdata + session" холболт нээж, локал WC3-той хосолно.
 *   5) Relay joiner ба hostdata 2 холболтыг session-оор хослуулж splice хийнэ.
 *
 * Бүх харилцаа НЭГ TCP порт (RELAY_PORT) дээр — эхний мөр newline-delimited JSON handshake:
 *   {"t":"register","game":G,"key":K,"name":N}  → хост control (KEY шаардлагатай)
 *   {"t":"joiner","game":G,"rc":1}               → joiner data (game байх ёстой); rc=1 → reconnect чадвартай (2026-10-10), relay
 *       {"t":"rc","session":S,"recv":0}\n гэж хариулна; rc-гүй хуучин клиентэд хариу бичихгүй (түүхий байт л).
 *   {"t":"hostdata","game":G,"session":S,"rc":1} → хост data (session хүлээгдэж байх ёстой)
 *   {"t":"joiner"|"hostdata",…,"rc":1,"resume":1,"session":S,"recv":N} → ТАСАРСАН хөлийг сэргээх (GProxy++ маяг):
 *       recv = peer-ийн хүлээн авсан нийт байт → relay тэр offset-оос replay; хариу {"t":"rc","session":S,"recv":M} → peer
 *       M-ээс хойшхи байтаа дахин илгээнэ. Тасарсан хөлийг RELAY_RC_HOLD_MS (55с) барина (rcsession.js).
 *   {"t":"capture","game":G,"key":HMAC}          → ХОСТ-ТАЛЫН бичлэг (Ш3, 2026-09-28): mesh (P2P) тоглолтод урсгал relay-ээр
 *       дамждаггүй тул хост клиент өөрөө бичиж энд урсгана. key = HMAC-SHA256(RELAY_REPORT_KEY, G)[:32] (зөвхөн хост мэднэ).
 *       Хариу {"t":"capture_ok","offset":N}
 → клиент N-ээс үргэлжлүүлнэ (тасарч дахин холбогдоход давхардал/цоорхойгүй).
 *       Дараа нь frame-үүд: [type u8][len u32LE][payload]; 1=W3GS байт, 2=meta JSON {joiners,primarySid}, 3=тоглоом дууссан.
 *   register-д "nocap":1 → хост өөрөө бичиж байгаа тул relay энэ тоглоомыг ДАВХАР бичихгүй.
 * Handshake-ийн дараах байтууд = түүхий WC3 траффик (splice-д дамжина).
 */
'use strict';
const net = require('net');

const { RcSession, rcReply } = require('./rcsession');

const CFG = {
  PORT: Number(process.env.RELAY_PORT || 7000),
  RC_HOLD_MS: Number(process.env.RELAY_RC_HOLD_MS || 55000),        // тасарсан хөлийг хүлээх (клиентийн window 50с-ээс урт)
  RC_RING_BYTES: Number(process.env.RELAY_RC_RING || 2 * 1024 * 1024),
  KEY: process.env.RELAY_KEY || process.env.BOT_KEY || '',
  PUBLIC_IP: process.env.PUBLIC_IP || '',
  SESSION_TIMEOUT_MS: Number(process.env.RELAY_SESSION_TIMEOUT_MS || 15000),
  HANDSHAKE_TIMEOUT_MS: Number(process.env.RELAY_HANDSHAKE_TIMEOUT_MS || 10000),
  MAX_HANDSHAKE: 8192,
};

const hosts = new Map();   // gameId -> { control, name, sessions: Map<sid,{ses,timer}> (хост хараахан холбогдоогүй), nocap }
const rcSessions = new Map();   // `${game}|${sid}` -> RcSession (амьд splice; тасарсан хөлийг сэргээхэд хайна)
const rcKey = (game, sid) => `${game}|${sid}`;
function rcCountFor(game) { let n = 0; for (const k of rcSessions.keys()) if (k.startsWith(game + '|')) n++; return n; }
// Хост control салсан: pending session-уудыг хаана; capture-ийг амьд session-ууд дуусах/хост эргэж ирэх хүртэл (RC_HOLD) хойшлуулна
const capHoldTimers = new Map();
function maybeFinalize(game) {
  if (hosts.has(game) || rcCountFor(game) > 0) return;
  capFinalize(game);
}
let sidCounter = 1;
let joinerCount = 0;

function log(...a) { console.log(new Date().toISOString(), '[relay]', ...a); }

// ════════════════════════════════════════════════════════════════════════════
// ТОГЛООМ CAPTURE (2026-09-02) — тоглогч-хостын тоглоомын урсгалыг сервер тал бичнэ.
// Зорилго: бот-хост БОЛОН клиент replay-гүйгээр бодит K/D/A/creep/denie/ward-ыг гаргах
// (DotA w3mmd host→joiner action урсгалд байдаг). ⚠️ splice-ыг ОГТ хөндөхгүй — зөвхөн
// PASSIVE 'data' сонсогч файлд хуулна. Бүх үйлдэл try/catch-д — capture унасан ч тоглоом
// 100% хэвийн үргэлжилнэ. RELAY_CAPTURE=1 env-ээр л асна (default УНТРААЛТТАЙ — эхлээд
// туршиж баталгаажуулна, дараа нь асаана).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const CAP_ON = process.env.RELAY_CAPTURE === '1';
const CAP_DIR = process.env.RELAY_CAPTURE_DIR || '/tmp/garena-capture';
const CAP_MAX_BYTES = Number(process.env.RELAY_CAPTURE_MAX || 60 * 1024 * 1024); // тоглоом бүрт дээд 60MB хамгаалалт
if (CAP_ON) { try { fs.mkdirSync(CAP_DIR, { recursive: true }); } catch (e) { log('capture dir алдаа: ' + e.message); } }
const captures = new Map(); // gameId -> { file, ws, bytes, primary, primarySid, sidOf:Map, joiners:{sid:name}, socks:Set, onData, capped, startedAt }

// 2026-10-10: capture нь socket биш SESSION-д суурилна (хөл тасарч сэргэхэд ч бичлэг үргэлжилнэ): ses 'hostdata' = хост→joiner байт,
// 'joinerdata' = joiner→хост (REQJOIN нэр), 'close' = session дууссан → өөр session-д шилжинэ.
function capAttach(gameId, ses, sid) {
  if (!CAP_ON) return;
  try {
    let cap = captures.get(gameId);
    if (!cap) {
      const file = path.join(CAP_DIR, `${gameId}-${Date.now()}.w3gs`);
      const ws = fs.createWriteStream(file);
      ws.on('error', () => {});   // диск алдаа splice-д нөлөөлөхгүй
      cap = { file, ws, bytes: 0, primary: null, primarySid: null, sidOf: new Map(), joiners: {}, socks: new Set(), onData: null, capped: false, startedAt: Date.now() };
      captures.set(gameId, cap);
    }
    cap.socks.add(ses);
    cap.sidOf.set(ses, sid);
    ses.on('close', () => { try { cap.socks.delete(ses); cap.sidOf.delete(ses); if (cap.primary === ses) capPromote(gameId); } catch {} });
    if (!cap.primary) { capSetPrimary(gameId, ses); cap.primarySid = sid; }
    capJoinerName(cap, sid, ses);   // joiner-ийн WC3 нэр (REQJOIN) — дүнд нэр тааруулахад
  } catch (e) { /* capture хэзээ ч splice-ыг эвдэхгүй */ }
}
// Joiner→host урсгалын ЭХНИЙ пакет = W3GS_REQJOIN (F7 1E len hostCounter[4] entryKey[4] ?[1] port[2] peerKey[4] name\0 …).
// Capture нь host→joiner чиглэл тул joiner-ийн ӨӨРИЙН нэр тэнд байдаггүй — энд passive уншиж хадгална.
function capJoinerName(cap, sid, ses) {
  try {
    let buf = Buffer.alloc(0);
    const tryParse = () => {
      const i = buf.indexOf(Buffer.from([0xF7, 0x1E]));
      if (i < 0 || buf.length < i + 20) return false;
      const end = buf.indexOf(0, i + 19);
      if (end < 0) return buf.length > i + 64;   // 64 байтад \0 алга → нэр биш, болино
      const name = buf.subarray(i + 19, end).toString('utf8').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 31);
      if (name) { cap.joiners[String(sid)] = name; log(`joiner нэр sid=${sid} name=${name}`); }
      return true;
    };
    const onData = (d) => {
      try { buf = Buffer.concat([buf, d]); if (tryParse() || buf.length > 2048) ses.removeListener('joinerdata', onData); }
      catch { try { ses.removeListener('joinerdata', onData); } catch {} }
    };
    ses.on('joinerdata', onData);
    ses.once('close', () => { try { ses.removeListener('joinerdata', onData); } catch {} });
  } catch {}
}
function capSetPrimary(gameId, ses) {
  const cap = captures.get(gameId); if (!cap) return;
  cap.primary = ses;
  cap.onData = (d) => {
    try {
      if (cap.capped) return;
      cap.bytes += d.length;
      if (cap.bytes > CAP_MAX_BYTES) { cap.capped = true; return; }
      cap.ws.write(d);   // fire-and-forget; backpressure-ыг үл тоомсорлоно (санах ойд буферлэнэ)
    } catch {}
  };
  try { ses.on('hostdata', cap.onData); } catch {}
}
function capPromote(gameId) {
  const cap = captures.get(gameId); if (!cap) return;
  cap.primary = null;
  const next = cap.socks.values().next().value;   // өөр амьд session байвал үргэлжлүүлнэ
  if (next) { capSetPrimary(gameId, next); cap.primarySid = cap.sidOf.get(next) ?? cap.primarySid; }
}
function capFinalize(gameId) {
  const cap = captures.get(gameId); if (!cap) return;
  captures.delete(gameId);
  log(`capture дуусав game=${gameId.slice(0, 12)} bytes=${cap.bytes}${cap.capped ? ' (дээд хязгаарт хүрсэн)' : ''} joiners=${JSON.stringify(cap.joiners)}`);
  try { cap.ws.end(() => capReport(gameId, cap)); } catch { capReport(gameId, cap); }
}
// Тоглоом дуусмагц meta бичээд ТУСДАА процессоор (relay-ийн event loop-ийг блоклохгүй!) w3gsStats задлал +
// платформ сервер рүү дүн илгээнэ (reportGame.js). RELAY_REPORT_URL тохируулаагүй бол зөвхөн meta үлдээнэ.
function capReport(gameId, cap) {
  try {
    if (!cap.bytes) return;
    const meta = { game: gameId, primarySid: cap.primarySid, joiners: cap.joiners, startedAt: cap.startedAt, endedAt: Date.now(), bytes: cap.bytes, capped: cap.capped };
    fs.writeFileSync(cap.file + '.meta.json', JSON.stringify(meta));
    if (!process.env.RELAY_REPORT_URL) return;
    const child = spawn(process.execPath, [path.join(__dirname, 'reportGame.js'), cap.file], { detached: true, stdio: 'ignore', env: process.env });
    child.on('error', (e) => log('report процесс алдаа: ' + e.message));
    child.unref();
    log(`report илгээгч эхлүүлэв game=${gameId.slice(0, 12)} pid=${child.pid}`);
  } catch (e) { log('capReport алдаа: ' + e.message); }
}

// ── ХОСТ-ТАЛЫН бичлэг хүлээн авах (Ш3) — файл нэр/meta формат relay-ийн бичлэгтэй ЯГ ИЖИЛ тул radarLive.js ба
//    reportGame.js өөрчлөлтгүй ажиллана. RELAY_REPORT_KEY тохируулаагүй бол энэ суваг хаалттай.
const crypto = require('crypto');
const HC_KEY = process.env.RELAY_REPORT_KEY || '';
const HC_IDLE_FINALIZE_MS = Number(process.env.HOSTCAP_IDLE_MS || 10 * 60 * 1000);   // хост тасраад эргэж ирээгүй бол
const hostCaps = new Map();   // game -> { file, ws, bytes, joiners, primarySid, startedAt, capped, sock, idleTimer, done }
function hostCapKey(game) { return crypto.createHmac('sha256', HC_KEY).update(String(game)).digest('hex').slice(0, 32); }
function hostCapFinalize(game) {
  const hc = hostCaps.get(game); if (!hc || hc.done) return;
  hc.done = true; hostCaps.delete(game); clearTimeout(hc.idleTimer);
  log(`host-capture дуусав game=${game.slice(0, 12)} bytes=${hc.bytes} joiners=${JSON.stringify(hc.joiners)}`);
  const cap = { file: hc.file, bytes: hc.bytes, primarySid: hc.primarySid, joiners: hc.joiners, startedAt: hc.startedAt, capped: hc.capped };
  try { hc.ws.end(() => capReport(game, cap)); } catch { capReport(game, cap); }
}
function handleHostCapture(sock, msg, leftover) {
  const game = String(msg.game || '');
  // БАЙТ уртаар харьцуулна: 32 тэмдэгт боловч олон-байтын (64 байт) key-д timingSafeEqual RangeError шидэж
  // relay процесс бүхэлдээ унадаг байв (бүх тоглолт тасарна) — аудит 2026-10-02
  const hcGot = Buffer.from(typeof msg.key === 'string' ? msg.key : '');
  const hcWant = Buffer.from(HC_KEY && game ? hostCapKey(game) : '');
  if (!HC_KEY || !game || !hcGot.length || hcGot.length !== hcWant.length || !crypto.timingSafeEqual(hcGot, hcWant)) { log('capture: буруу key'); sock.destroy(); return; }
  let hc = hostCaps.get(game);
  if (!hc) {
    try { fs.mkdirSync(CAP_DIR, { recursive: true }); } catch {}
    const file = path.join(CAP_DIR, `${game}-${Date.now()}.w3gs`);
    const ws = fs.createWriteStream(file); ws.on('error', () => {});
    hc = { file, ws, bytes: 0, joiners: {}, primarySid: null, startedAt: Date.now(), capped: false, sock: null, idleTimer: null, done: false };
    hostCaps.set(game, hc);
    log('host-capture эхлэв game=' + game.slice(0, 12));
  }
  if (hc.sock && hc.sock !== sock) { try { hc.sock.destroy(); } catch {} }   // хуучин (тасарсан) холболт
  hc.sock = sock; clearTimeout(hc.idleTimer);
  try { sock.write(JSON.stringify({ t: 'capture_ok', offset: hc.bytes }) + '\n'); } catch {}
  let buf = Buffer.from(leftover || []);
  const onFrames = () => {
    while (buf.length >= 5) {
      const type = buf[0], len = buf.readUInt32LE(1);
      if (len > 4 * 1024 * 1024) { sock.destroy(); return; }
      if (buf.length < 5 + len) return;
      const payload = buf.subarray(5, 5 + len); buf = buf.subarray(5 + len);
      if (type === 1) {
        if (!hc.capped) { hc.bytes += payload.length; if (hc.bytes > CAP_MAX_BYTES) hc.capped = true; else { try { hc.ws.write(Buffer.from(payload)); } catch {} } }
      } else if (type === 2) {
        try { const m = JSON.parse(payload.toString('utf8')); if (m && typeof m.joiners === 'object') hc.joiners = m.joiners; if (m && m.primarySid != null) hc.primarySid = String(m.primarySid); } catch {}
      } else if (type === 3) { hostCapFinalize(game); try { sock.end(); } catch {} return; }
    }
  };
  onFrames();
  sock.on('data', (d) => { buf = Buffer.concat([buf, d]); onFrames(); });
  sock.on('close', () => {
    if (hc.done || hc.sock !== sock) return;
    hc.sock = null;
    hc.idleTimer = setTimeout(() => hostCapFinalize(game), HC_IDLE_FINALIZE_MS);   // эргэж холбогдвол цуцлагдана
  });
}

// Socket-оос эхний newline хүртэлх JSON-ыг уншаад {msg, leftover}-ыг буцаана.
function readHandshake(sock, cb) {
  let buf = Buffer.alloc(0);
  // Handshake newline ирэхгүй бол socket мөнхөд нээлттэй үлдэхээс сэргийлж timeout тавина
  // (auth-гүй slowloris маягийн FD/санах ой шавхах DoS-оос хамгаална).
  const hsTimer = setTimeout(() => { try { sock.destroy(); } catch {} }, CFG.HANDSHAKE_TIMEOUT_MS);
  const onData = (d) => {
    buf = Buffer.concat([buf, d]);
    const nl = buf.indexOf(0x0a);
    if (nl === -1) {
      if (buf.length > CFG.MAX_HANDSHAKE) { clearTimeout(hsTimer); try { sock.destroy(); } catch {} }
      return;
    }
    clearTimeout(hsTimer);
    sock.removeListener('data', onData);
    const line = buf.slice(0, nl).toString('utf8').trim();
    const leftover = buf.slice(nl + 1);
    let msg = null;
    try { msg = JSON.parse(line); } catch { try { sock.destroy(); } catch {} return; }
    cb(msg, leftover);
  };
  sock.on('data', onData);
  sock.on('error', () => { clearTimeout(hsTimer); });
  sock.on('close', () => { clearTimeout(hsTimer); });
}

// 2 socket-ыг хос чиглэлд холбоно. Тус бүрийн leftover (handshake-ийн дараах байт)-ыг эсрэг тал руу түлхэнэ.
function splice(a, b, aLeftover, bLeftover) {
  try { a.setNoDelay(true); b.setNoDelay(true); } catch {}
  if (bLeftover && bLeftover.length) { try { a.write(bLeftover); } catch {} }
  if (aLeftover && aLeftover.length) { try { b.write(aLeftover); } catch {} }
  a.pipe(b); b.pipe(a);
  const done = () => { try { a.destroy(); } catch {} try { b.destroy(); } catch {} };
  a.on('error', done); b.on('error', done); a.on('close', done); b.on('close', done);
}

const server = net.createServer((sock) => {
  try { sock.setNoDelay(true); } catch {}
  sock.on('error', () => {});
  readHandshake(sock, (msg, leftover) => {
    const t = msg && msg.t;

    if (t === 'register') {
      if (CFG.KEY && msg.key !== CFG.KEY) { log('register: буруу key'); sock.destroy(); return; }
      const game = String(msg.game || '');
      if (!game) { sock.destroy(); return; }
      const old = hosts.get(game);
      if (old) { try { old.control.destroy(); } catch {} }
      if (capHoldTimers.has(game)) { clearTimeout(capHoldTimers.get(game)); capHoldTimers.delete(game); }   // хост эргэж ирэв — capture үргэлжилнэ
      const h = { control: sock, name: String(msg.name || ''), sessions: new Map(), nocap: !!msg.nocap };
      hosts.set(game, h);
      // 2026-10-01: хостын PC унтарсан/интернэт тасарсан үед FIN ирэхгүй тул control socket үүрд нээлттэй үлддэг
      // байсан (DATACOM дээр 106 «host» хуримтлагдсан). Зөвхөн CONTROL socket-д TCP keepalive — тоглоомын
      // splice замыг хөндөхгүй; kernel 30с сул зогсолтын дараа шалгаж, үхсэн холболтыг ~2–10 мин-д хаана.
      try { sock.setKeepAlive(true, 30000); } catch {}
      try { sock.write(JSON.stringify({ t: 'registered', game, relayPort: CFG.PORT, relayIp: CFG.PUBLIC_IP }) + '\n'); } catch {}
      log('host бүртгэгдлээ game=' + game.slice(0, 12) + ' name=' + h.name);
      sock.on('close', () => {
        if (hosts.get(game) === h) {
          hosts.delete(game);
          for (const s of h.sessions.values()) { clearTimeout(s.timer); try { s.ses.close('host-left'); } catch {} }
          // Тоглоом дуусав — capture-ийг амьд session-ууд (сэргэх боломжтой хөлүүд) дуусах хүртэл хойшлуулна (reconnect)
          const tm = setTimeout(() => { capHoldTimers.delete(game); for (const [k, ses] of rcSessions) if (k.startsWith(game + '|')) ses.close('host-gone'); maybeFinalize(game); }, CFG.RC_HOLD_MS + 2000);
          if (tm.unref) tm.unref();
          capHoldTimers.set(game, tm);
          log('host салав game=' + game.slice(0, 12) + (rcCountFor(game) ? ` (${rcCountFor(game)} session сэргэхийг хүлээнэ)` : ''));
        }
      });

    } else if ((t === 'joiner' || t === 'hostdata') && msg.resume) {
      // ── Тасарсан хөлийг сэргээх (GProxy++ маяг, 2026-10-10) ──
      const game = String(msg.game || ''), sid = String(msg.session || '');
      const ses = rcSessions.get(rcKey(game, sid));
      const leg = t === 'joiner' ? 'A' : 'B';
      if (!ses) { log(`resume: session олдсонгүй ${leg} sid=${sid}`); try { sock.write(rcReply(sid, { ok: false, error: 'no-session' })); } catch {} sock.destroy(); return; }
      const r = ses.attach(leg, sock, { rc: true, recv: Number(msg.recv) || 0, leftover: null, resume: true, preface: (x) => rcReply(sid, x) });
      if (!r.ok) { try { sock.write(rcReply(sid, r)); } catch {} log(`resume амжилтгүй ${leg} sid=${sid}: ${r.error}`); sock.destroy(); return; }
      if (leftover && leftover.length) ses._onData(leg, sock, leftover);
      log(`resume ${leg === 'A' ? 'joiner' : 'host'} sid=${sid} game=${game.slice(0, 12)}`);

    } else if (t === 'joiner') {
      const game = String(msg.game || '');
      const h = hosts.get(game);
      if (!h) { log('joiner: game олдсонгүй ' + game.slice(0, 12)); sock.destroy(); return; }
      const sid = String(sidCounter++);
      const ses = new RcSession({ id: sid, holdMs: CFG.RC_HOLD_MS, ringBytes: CFG.RC_RING_BYTES, log });
      rcSessions.set(rcKey(game, sid), ses);
      ses.on('close', (reason) => { rcSessions.delete(rcKey(game, sid)); const s = h.sessions.get(sid); if (s && s.ses === ses) { clearTimeout(s.timer); h.sessions.delete(sid); } log(`session хаагдав sid=${sid} (${reason})`); maybeFinalize(game); });
      if (msg.rc) { try { sock.write(rcReply(sid, { ok: true, recv: 0 })); } catch {} }
      ses.attach('A', sock, { rc: !!msg.rc, leftover });   // хост холбогдох хүртэл байтууд ring-д хадгалагдана
      const timer = setTimeout(() => {
        if (h.sessions.get(sid)) { h.sessions.delete(sid); log('session timeout sid=' + sid); ses.close('host-timeout'); }
      }, CFG.SESSION_TIMEOUT_MS);
      h.sessions.set(sid, { ses, timer });
      joinerCount++;
      try { h.control.write(JSON.stringify({ t: 'newjoiner', game, session: sid }) + '\n'); }
      catch { clearTimeout(timer); h.sessions.delete(sid); ses.close('control-write'); return; }
      log('joiner ирлээ game=' + game.slice(0, 12) + ' sid=' + sid + (msg.rc ? ' rc' : ''));

    } else if (t === 'hostdata') {
      const game = String(msg.game || '');
      const sid = String(msg.session || '');
      const h = hosts.get(game);
      if (!h) { sock.destroy(); return; }
      const s = h.sessions.get(sid);
      if (!s) { log('hostdata: session олдсонгүй sid=' + sid); sock.destroy(); return; }
      clearTimeout(s.timer); h.sessions.delete(sid);
      if (msg.rc) { try { sock.write(rcReply(sid, { ok: true, recv: 0 })); } catch {} }
      const r = s.ses.attach('B', sock, { rc: !!msg.rc, leftover });   // joiner-ийн хуримтлагдсан байт (REQJOIN) хост руу очно
      if (!r.ok) { s.ses.close('attach-' + r.error); return; }
      if (!h.nocap) capAttach(game, s.ses, sid);   // PASSIVE tee — splice-ыг хөндөхгүй (nocap = хост өөрөө бичнэ)
      log('splice хийв game=' + game.slice(0, 12) + ' sid=' + sid + (msg.rc ? ' rc' : ''));

    } else if (t === 'capture') {
      handleHostCapture(sock, msg, leftover);

    } else {
      sock.destroy();
    }
  });
});

server.on('error', (e) => { log('server алдаа: ' + e.message); process.exitCode = 1; });
server.listen(CFG.PORT, () => log('relay сонсож байна PORT=' + CFG.PORT + ' public=' + (CFG.PUBLIC_IP || '(тохируулаагүй)')));

// Статус лог
setInterval(() => { if (hosts.size || rcSessions.size) log('идэвхтэй: ' + hosts.size + ' host, ' + rcSessions.size + ' session, нийт ' + joinerCount + ' joiner'); }, 60000);

process.on('SIGTERM', () => { try { server.close(); } catch {} process.exit(0); });
// Нэг холболтын алдаа бүх тоглолтыг унагаахгүй — логлоод үргэлжилнэ (аудит 2026-10-02)
process.on('uncaughtException', (e) => { try { log('uncaughtException: ' + ((e && e.stack) || e)); } catch {} });
process.on('unhandledRejection', (e) => { try { log('unhandledRejection: ' + ((e && e.message) || e)); } catch {} });
