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
 *   {"t":"joiner","game":G}                      → joiner data (game байх ёстой)
 *   {"t":"hostdata","game":G,"session":S}        → хост data (session хүлээгдэж байх ёстой)
 * Handshake-ийн дараах байтууд = түүхий WC3 траффик (splice-д дамжина).
 */
'use strict';
const net = require('net');

const CFG = {
  PORT: Number(process.env.RELAY_PORT || 7000),
  KEY: process.env.RELAY_KEY || process.env.BOT_KEY || '',
  PUBLIC_IP: process.env.PUBLIC_IP || '',
  SESSION_TIMEOUT_MS: Number(process.env.RELAY_SESSION_TIMEOUT_MS || 15000),
  HANDSHAKE_TIMEOUT_MS: Number(process.env.RELAY_HANDSHAKE_TIMEOUT_MS || 10000),
  MAX_HANDSHAKE: 8192,
};

const hosts = new Map();   // gameId -> { control, name, sessions: Map<sid,{joiner,leftover,timer}> }
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

function capAttach(gameId, hostSock, sid, joinerSock, joinerLeftover) {
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
    cap.socks.add(hostSock);
    cap.sidOf.set(hostSock, sid);
    hostSock.on('close', () => { try { cap.socks.delete(hostSock); cap.sidOf.delete(hostSock); if (cap.primary === hostSock) capPromote(gameId); } catch {} });
    hostSock.on('error', () => { try { cap.socks.delete(hostSock); } catch {} });
    if (!cap.primary) { capSetPrimary(gameId, hostSock); cap.primarySid = sid; }
    capJoinerName(cap, sid, joinerSock, joinerLeftover);   // joiner-ийн WC3 нэр (REQJOIN) — дүнд нэр тааруулахад
  } catch (e) { /* capture хэзээ ч splice-ыг эвдэхгүй */ }
}
// Joiner→host урсгалын ЭХНИЙ пакет = W3GS_REQJOIN (F7 1E len hostCounter[4] entryKey[4] ?[1] port[2] peerKey[4] name\0 …).
// Capture нь host→joiner чиглэл тул joiner-ийн ӨӨРИЙН нэр тэнд байдаггүй — энд passive уншиж хадгална.
function capJoinerName(cap, sid, sock, leftover) {
  try {
    let buf = Buffer.from(leftover || []);
    const tryParse = () => {
      const i = buf.indexOf(Buffer.from([0xF7, 0x1E]));
      if (i < 0 || buf.length < i + 20) return false;
      const end = buf.indexOf(0, i + 19);
      if (end < 0) return buf.length > i + 64;   // 64 байтад \0 алга → нэр биш, болино
      const name = buf.subarray(i + 19, end).toString('utf8').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 31);
      if (name) { cap.joiners[String(sid)] = name; log(`joiner нэр sid=${sid} name=${name}`); }
      return true;
    };
    if (tryParse()) return;
    const onData = (d) => {
      try { buf = Buffer.concat([buf, d]); if (tryParse() || buf.length > 2048) sock.removeListener('data', onData); }
      catch { try { sock.removeListener('data', onData); } catch {} }
    };
    sock.on('data', onData);
    sock.once('close', () => { try { sock.removeListener('data', onData); } catch {} });
  } catch {}
}
function capSetPrimary(gameId, hostSock) {
  const cap = captures.get(gameId); if (!cap) return;
  cap.primary = hostSock;
  cap.onData = (d) => {
    try {
      if (cap.capped) return;
      cap.bytes += d.length;
      if (cap.bytes > CAP_MAX_BYTES) { cap.capped = true; return; }
      cap.ws.write(d);   // fire-and-forget; backpressure-ыг үл тоомсорлоно (санах ойд буферлэнэ)
    } catch {}
  };
  try { hostSock.on('data', cap.onData); } catch {}
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
      const h = { control: sock, name: String(msg.name || ''), sessions: new Map() };
      hosts.set(game, h);
      try { sock.write(JSON.stringify({ t: 'registered', game, relayPort: CFG.PORT, relayIp: CFG.PUBLIC_IP }) + '\n'); } catch {}
      log('host бүртгэгдлээ game=' + game.slice(0, 12) + ' name=' + h.name);
      sock.on('close', () => {
        if (hosts.get(game) === h) {
          hosts.delete(game);
          for (const s of h.sessions.values()) { clearTimeout(s.timer); try { s.joiner.destroy(); } catch {} }
          capFinalize(game);   // тоглоом дуусав — capture файлыг хаана
          log('host салав game=' + game.slice(0, 12));
        }
      });

    } else if (t === 'joiner') {
      const game = String(msg.game || '');
      const h = hosts.get(game);
      if (!h) { log('joiner: game олдсонгүй ' + game.slice(0, 12)); sock.destroy(); return; }
      const sid = String(sidCounter++);
      sock.pause();
      const timer = setTimeout(() => {
        if (h.sessions.get(sid)) { h.sessions.delete(sid); log('session timeout sid=' + sid); try { sock.destroy(); } catch {} }
      }, CFG.SESSION_TIMEOUT_MS);
      h.sessions.set(sid, { joiner: sock, leftover, timer });
      joinerCount++;
      try { h.control.write(JSON.stringify({ t: 'newjoiner', game, session: sid }) + '\n'); }
      catch { clearTimeout(timer); h.sessions.delete(sid); sock.destroy(); return; }
      log('joiner ирлээ game=' + game.slice(0, 12) + ' sid=' + sid);
      sock.on('close', () => { const s = h.sessions.get(sid); if (s && s.joiner === sock) { clearTimeout(s.timer); h.sessions.delete(sid); } });

    } else if (t === 'hostdata') {
      const game = String(msg.game || '');
      const sid = String(msg.session || '');
      const h = hosts.get(game);
      if (!h) { sock.destroy(); return; }
      const s = h.sessions.get(sid);
      if (!s) { log('hostdata: session олдсонгүй sid=' + sid); sock.destroy(); return; }
      clearTimeout(s.timer); h.sessions.delete(sid);
      try { s.joiner.resume(); } catch {}
      splice(sock, s.joiner, leftover, s.leftover);
      capAttach(game, sock, sid, s.joiner, s.leftover);   // PASSIVE tee — splice-ыг хөндөхгүй
      log('splice хийв game=' + game.slice(0, 12) + ' sid=' + sid);

    } else {
      sock.destroy();
    }
  });
});

server.on('error', (e) => { log('server алдаа: ' + e.message); process.exitCode = 1; });
server.listen(CFG.PORT, () => log('relay сонсож байна PORT=' + CFG.PORT + ' public=' + (CFG.PUBLIC_IP || '(тохируулаагүй)')));

// Статус лог
setInterval(() => { if (hosts.size) log('идэвхтэй: ' + hosts.size + ' host, нийт ' + joinerCount + ' joiner'); }, 60000);

process.on('SIGTERM', () => { try { server.close(); } catch {} process.exit(0); });
