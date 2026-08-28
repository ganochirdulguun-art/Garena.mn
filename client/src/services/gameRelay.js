/**
 * WC3 UDP Game Relay — Найдвартай LAN тоглоом илрүүлэгч
 *
 * HOST MODE (startHost):
 *   - Port 6112 дээр reuseAddr-ээр WC3 broadcast-ыг capture
 *   - Тоглогч бүрийн IP руу port 6112-оос forward (WC3 зөвхөн :6112-оос хүлээн авна)
 *
 * PLAYER MODE (startFinder):
 *   - W3GS_SEARCHGAME packet-ыг host IP руу илгээж GAMEINFO trigger хийнэ
 *   - Port 6112-г WC3-д үлдээнэ (bind зөрчилгүй)
 *   - Host relay GAMEINFO-г port 6112-оос илгээдэг → WC3 шууд хүлээн авна
 *
 * WC3 protocol: 0xF7 header, UDP port 6112
 */
const dgram = require('dgram');
const net = require('net');
const os = require('os');
const fs = require('fs');
const path = require('path');

// Оношлогооны лог — %APPDATA%/garena-mn-client/botbridge.log (Claude энэ файлыг уншиж алдааг оношилно)
const _BB_LOG = (() => {
  try { return path.join(process.env.APPDATA || os.homedir(), 'garena-mn-client', 'botbridge.log'); }
  catch { return null; }
})();
function bblog(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  console.log('[BotBridge]', msg);
  if (_BB_LOG) { try { fs.appendFileSync(_BB_LOG, line + '\n'); } catch {} }
}
// WC3 руу GAMEINFO илгээхэд эх порт 6112 хэрэгтэй бөгөөд WC3 (0.0.0.0:6112)-той мөргөлдөхгүйн тулд
// ТОДОРХОЙ IP (ZeroTier эсвэл LAN):6112-т bind хийнэ. Ингэвэл 127.0.0.1 руу илгээсэн пакетыг WC3
// (wildcard) хүлээж авна, bridge өөрөө биш.
function _localBindIp() {
  const ifs = os.networkInterfaces();
  let zt = null, lan = null;
  for (const name of Object.keys(ifs)) {
    for (const a of (ifs[name] || [])) {
      if (a.family === 'IPv4' && !a.internal) {
        if (/^10\.147\./.test(a.address) || /zerotier/i.test(name)) { if (!zt) zt = a.address; }
        else if (!lan) lan = a.address;
      }
    }
  }
  return zt || lan || null;
}

const WC3_PORT = 6112;
const W3_HEADER = 0xF7;
const W3_SEARCHGAME = 0x2F;
const W3_GAMEINFO = 0x30;

// Түгээмэл WC3 хувилбарууд (Frozen Throne + Reign of Chaos)
const SEARCH_VERSIONS = [
  { product: 'W3XP', version: 26 },  // TFT 1.26a (хамгийн түгээмэл)
  { product: 'W3XP', version: 28 },  // TFT 1.28
  { product: 'W3XP', version: 30 },  // TFT 1.30
  { product: 'W3XP', version: 31 },  // TFT 1.31
  { product: 'WAR3', version: 26 },  // RoC 1.26a
  { product: 'W3XP', version: 24 },  // TFT 1.24e
  { product: 'W3XP', version: 27 },  // TFT 1.27
  { product: 'W3XP', version: 29 },  // TFT 1.29
];

let _hostRelay = null;   // Host mode state
let _finder = null;      // Player/Finder mode state

// ═══════════════════════════════════════════════════════════
// W3GS SEARCHGAME packet бүтээх
// ═══════════════════════════════════════════════════════════
function makeSearchPacket(product, version) {
  const buf = Buffer.alloc(16);
  buf[0] = W3_HEADER;                  // 0xF7
  buf[1] = W3_SEARCHGAME;              // 0x2F
  buf.writeUInt16LE(16, 2);            // packet size
  buf.write(product, 4, 4, 'ascii');   // "W3XP" эсвэл "WAR3"
  buf.writeUInt32LE(version, 8);       // хувилбарын дугаар
  buf.writeUInt32LE(0, 12);            // host counter (0 = бүгдийг хай)
  return buf;
}

// ═══════════════════════════════════════════════════════════
// HOST MODE — WC3 broadcast capture + forward (port 6112-оос!)
// ═══════════════════════════════════════════════════════════
function startHost(playerIps) {
  stopHost();
  const ips = (playerIps || []).filter(Boolean);
  if (!ips.length) {
    console.log('[GameRelay:Host] Тоглогчийн IP байхгүй');
    return;
  }

  const state = { ips, running: true, listener: null, sender: null };

  // Sender — SEARCHGAME-г localhost WC3 руу forward + WC3-ийн хариу GAMEINFO-г барих
  // (listener-ээр localhost руу илгээвэл loop үүснэ)
  state.sender = dgram.createSocket('udp4');
  state.sender.on('error', (e) => console.error('[GameRelay:Host] sender:', e.message));

  // WC3 SEARCHGAME-д хариулж GAMEINFO илгээхэд sender-ээр барьж,
  // listener (port 6112) ашиглан тоглогчид руу forward хийнэ
  state.sender.on('message', (msg, rinfo) => {
    if (!state.running) return;
    if (!msg.length || msg[0] !== W3_HEADER) return;
    if (msg[1] !== W3_GAMEINFO) return;
    for (const ip of state.ips) {
      try {
        state.listener.send(msg, 0, msg.length, WC3_PORT, ip);
      } catch {}
    }
  });

  // Listener — port 6112 дээр WC3 broadcast capture + GAMEINFO forward
  state.listener = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  state.listener.on('error', (e) => {
    console.error('[GameRelay:Host] listener:', e.message);
  });

  state.listener.on('message', (msg, rinfo) => {
    if (!state.running) return;
    if (!msg.length || msg[0] !== W3_HEADER) return;

    if (state.ips.includes(rinfo.address)) {
      // Тоглогчоос ирсэн packet — SEARCHGAME бол WC3 руу forward хийх
      if (msg.length >= 2 && msg[1] === W3_SEARCHGAME) {
        try {
          state.sender.send(msg, 0, msg.length, WC3_PORT, '127.0.0.1');
        } catch {}
      }
      return;
    }

    // Локал WC3-ийн broadcast — тоглогч бүр рүү PORT 6112-оос forward
    // ЧУХАЛ: listener (port 6112) ашиглана — WC3 зөвхөн :6112 source port хүлээн авна
    for (const ip of state.ips) {
      try {
        state.listener.send(msg, 0, msg.length, WC3_PORT, ip);
      } catch {}
    }
  });

  state.listener.bind(WC3_PORT, '0.0.0.0', () => {
    try { state.listener.setBroadcast(true); } catch {}
    console.log(`[GameRelay:Host] Эхэллээ — ${ips.length} тоглогчид (port 6112 → 6112)`);
  });

  _hostRelay = state;
}

function stopHost() {
  if (!_hostRelay) return;
  _hostRelay.running = false;
  try { _hostRelay.listener?.close(); } catch {}
  try { _hostRelay.sender?.close(); } catch {}
  _hostRelay = null;
  console.log('[GameRelay:Host] Зогслоо');
}

function addHostPlayerIp(ip) {
  if (_hostRelay && ip && !_hostRelay.ips.includes(ip)) {
    _hostRelay.ips.push(ip);
    console.log(`[GameRelay:Host] +${ip} (нийт: ${_hostRelay.ips.length})`);
  }
}

// ═══════════════════════════════════════════════════════════
// PLAYER MODE — Game Finder (SEARCHGAME → WC3 шууд хүлээн авна)
//
// Port 6112-г WC3-д үлдээнэ (bind зөрчилгүй).
// Host relay GAMEINFO-г port 6112-оос илгээдэг тул WC3 шууд хүлээн авна.
// Finder зөвхөн SEARCHGAME илгээж host WC3-г trigger хийнэ.
// ═══════════════════════════════════════════════════════════
function startFinder(hostIp) {
  stopFinder();
  stopBotBridge();   // өмнөх non-ZT оролдлогын 6112 socket үлдэж GAMEINFO булаахаас сэргийлнэ (симметр cleanup)
  if (!hostIp) {
    console.log('[GameRelay:Finder] Host IP байхгүй');
    return;
  }

  const state = {
    hostIp,
    running: true,
    socket: null,
    timer: null,
    foundVersion: null,
  };

  // Socket — SEARCHGAME илгээх + GAMEINFO хүлээн авах (random port, version detect-д ашиглана)
  state.socket = dgram.createSocket('udp4');
  state.socket.on('error', (e) => console.error('[GameRelay:Finder] socket:', e.message));

  state.socket.on('message', (msg, rinfo) => {
    if (!state.running) return;
    if (!msg.length || msg[0] !== W3_HEADER) return;
    if (msg[1] === W3_GAMEINFO && !state.foundVersion) {
      // Хувилбар илрүүлэх (зөвхөн нэг удаа)
      if (msg.length >= 12) {
        try {
          const product = msg.toString('ascii', 4, 8);
          const version = msg.readUInt32LE(8);
          if (SEARCH_VERSIONS.some(v => v.product === product && v.version === version)) {
            state.foundVersion = { product, version };
          }
        } catch {}
      }
      if (!state.foundVersion) state.foundVersion = SEARCH_VERSIONS[0];
      console.log(`[GameRelay:Finder] WC3 хувилбар: ${state.foundVersion.product} v${state.foundVersion.version}`);
    }
  });

  // SEARCHGAME илгээх — host WC3-г GAMEINFO broadcast хийхэд trigger хийнэ
  // Host relay GAMEINFO-г port 6112-оос тоглогч руу forward хийдэг →
  // WC3 port 6112 дээр шууд хүлээн авна (source port 6112 учир WC3 зөвшөөрнө)
  function sendSearch() {
    if (!state.running) return;
    try {
      if (state.foundVersion) {
        const pkt = makeSearchPacket(state.foundVersion.product, state.foundVersion.version);
        state.socket.send(pkt, 0, pkt.length, WC3_PORT, state.hostIp);
      } else {
        for (const v of SEARCH_VERSIONS) {
          const pkt = makeSearchPacket(v.product, v.version);
          state.socket.send(pkt, 0, pkt.length, WC3_PORT, state.hostIp);
        }
      }
    } catch {}
    state.timer = setTimeout(sendSearch, state.foundVersion ? 5000 : 1500);
  }

  sendSearch();
  console.log(`[GameRelay:Finder] Эхэллээ — host: ${hostIp} (WC3 port 6112 шууд хүлээн авна)`);
  _finder = state;
}

function stopFinder() {
  if (!_finder) return;
  _finder.running = false;
  if (_finder.timer) clearTimeout(_finder.timer);
  try { _finder.socket?.close(); } catch {}
  _finder = null;
  console.log('[GameRelay:Finder] Зогслоо');
}

// ═══════════════════════════════════════════════════════════
// Бүгдийг зогсоох
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// BOT BRIDGE — RGC/GProxy маяг: серверийн ботын тоглоомыг локал WC3-д LAN тоглоом шиг харуулна
//   1) TCP proxy 127.0.0.1:<localPort> → бот IP:port (WC3 локал руу холбогдоно)
//   2) Ботын W3GS_GAMEINFO пакетыг (port-ыг localPort болгож) 127.0.0.1:6112 руу 2 сек тутам илгээнэ
// GProxy++-тэй адил энгийн (bind хийгээгүй) UDP socket ашиглана — 6112-ыг ЭЗЛЭХГҮЙ, тэгэхгүй бол WC3 өөрөө
// 6112-ыг bind хийж чадахгүй, LAN жагсаалт хоосон харагдана.
// ═══════════════════════════════════════════════════════════
let _bot = null;
let _onBotJoin = null;   // (wc3Name) => void — WC3 ботын lobby-д орохдоо илгээсэн W3GS_REQJOIN-ийн нэр
function setBotJoinListener(fn) { _onBotJoin = typeof fn === 'function' ? fn : null; }

// W3GS_REQJOIN (0x1E): F7 1E len(2) hostcounter(4) entrykey(4) ?(1) listenport(2) peerkey(4) name\0 …
// WC3-ийн бодит LAN нэр энд байдаг → GHost++-ийн тоглогчийн нэртэй яг ижил (дүн тааруулах, owner/!start).
function parseReqJoinName(buf) {
  if (!buf || buf.length < 21 || buf[0] !== W3_HEADER || buf[1] !== 0x1E) return null;
  const end = buf.indexOf(0, 19);
  if (end <= 19) return null;
  const raw = buf.subarray(19, end);
  let name = raw.toString('utf8');
  if (name.includes('\uFFFD')) name = raw.toString('latin1');
  name = name.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return name || null;
}

function startBotBridge({ hostIp, hostPort, gameInfoB64, localPort }) {
  stopBotBridge();
  stopHost(); stopFinder();   // ZeroTier relay UDP 6112-ыг эзэлж болзошгүй — ботын замд хэрэггүй
  if (!hostIp || !hostPort || !gameInfoB64) throw new Error('Ботын мэдээлэл дутуу');
  const pkt = Buffer.from(String(gameInfoB64), 'base64');
  if (pkt.length < 24 || pkt[0] !== W3_HEADER || pkt[1] !== W3_GAMEINFO) throw new Error('GAMEINFO пакет буруу');
  const lp = Number(localPort) || 6113;
  const state = { hostIp, hostPort: Number(hostPort), localPort: lp, running: true, server: null, udp: null, timer: null, conns: new Set() };

  // 1) TCP proxy
  state.server = net.createServer((client) => {
    const up = net.connect(state.hostPort, state.hostIp);
    state.conns.add(client);
    const done = () => { state.conns.delete(client); try { client.destroy(); } catch {} try { up.destroy(); } catch {} };
    client.setNoDelay(true); up.setNoDelay(true);
    let first = true;
    client.on('data', (d) => {
      if (!first) return;
      first = false;
      const name = parseReqJoinName(d);
      if (!name) return;
      console.log(`[BotBridge] WC3 REQJOIN нэр: ${name}`);
      try { _onBotJoin?.(name); } catch {}
    });
    client.pipe(up); up.pipe(client);
    client.on('error', done); up.on('error', done); client.on('close', done); up.on('close', done);
    console.log(`[BotBridge] WC3 → ${state.hostIp}:${state.hostPort}`);
  });
  state.server.on('error', (e) => console.error('[BotBridge] tcp:', e.message));
  state.server.listen(lp, '127.0.0.1');

  // 2) GAMEINFO → локал WC3 (GProxy маяг). WC3 зөвхөн ЭХ ПОРТ 6112-оос ирсэн GAMEINFO-г LAN
  //    жагсаалтад хүлээж авдаг. Иймд 0.0.0.0:6112-т reuseAddr-ээр bind хийж (WC3-тай ЗЭРЭГЦЭН —
  //    Windows дээр SO_REUSEADDR-ээр боломжтой) зөвхөн 127.0.0.1:6112 руу илгээнэ → эх IP 127.0.0.1,
  //    эх порт 6112 → WC3 хүлээж аваад port талбар (=localPort) руу буюу 127.0.0.1:localPort (TCP тунел)
  //    руу холбогдоно → тунел ботын нийтийн IP руу дамжуулна. ZeroTier огт шаардлагагүй.
  const local = Buffer.from(pkt);
  local.writeUInt16LE(lp, local.length - 2);   // GAMEINFO-ийн port талбарыг локал proxy порт болгоно
  let sentCount = 0;
  const beginSend = (sock, how) => {
    state.udp = sock;
    const tick = () => {
      if (!state.running) return;
      const b = state.packet || local;
      try { sock.send(b, 0, b.length, WC3_PORT, '127.0.0.1'); } catch (e) { if (sentCount < 3) bblog('send алдаа: ' + e.message); }
      sentCount += 1;
      if (sentCount === 3 || sentCount % 30 === 0) bblog(`GAMEINFO → 127.0.0.1:6112 x${sentCount} (эх порт ${how})`);
      state.timer = setTimeout(tick, 2000);
    };
    tick();
    bblog(`Эхэллээ — bot ${hostIp}:${hostPort}, TCP тунел 127.0.0.1:${lp}, эх порт=${how}`);
  };
  // 0.0.0.0:6112-т reuseAddr-ээр bind (WC3-тай зэрэгцэн) → бүтэхгүй бол unbound (эх порт 6112 биш, сүүлчийн арга)
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let bound = false;
  sock.on('error', (e) => {
    if (bound) { bblog('udp алдаа: ' + e.message); return; }
    bblog(`bind 0.0.0.0:6112 амжилтгүй: ${e.message} → unbound fallback`);
    try { sock.close(); } catch {}
    const ub = dgram.createSocket('udp4');
    ub.on('error', (er) => bblog('udp(unbound) алдаа: ' + er.message));
    ub.bind(() => beginSend(ub, 'OS(unbound)'));
  });
  sock.bind(WC3_PORT, '0.0.0.0', () => { bound = true; beginSend(sock, '6112'); });
  _bot = state;
  return { localPort: lp };
}

// Ботын GAMEINFO шинэчлэгдэхэд (lobby-д хүн орж/гарахад) дахин эхлүүлэлгүй пакетыг солино
function updateBotBridge({ gameInfoB64 }) {
  if (!_bot || !gameInfoB64) return false;
  const pkt = Buffer.from(String(gameInfoB64), 'base64');
  if (pkt.length < 24 || pkt[0] !== W3_HEADER || pkt[1] !== W3_GAMEINFO) return false;
  pkt.writeUInt16LE(_bot.localPort, pkt.length - 2);
  _bot.packet = pkt;
  return true;
}

function stopBotBridge() {
  if (!_bot) return;
  const s = _bot;
  _bot = null;
  s.running = false;
  clearTimeout(s.timer);
  try { s.udp?.close(); } catch {}
  try { s.server?.close(); } catch {}
  s.conns.forEach((c) => { try { c.destroy(); } catch {} });
  console.log('[BotBridge] Зогслоо');
}

function stopAll() {
  stopBotBridge();
  stopHost();
  stopFinder();
}

function isRunning() {
  return !!_hostRelay || !!_finder;
}

module.exports = {
  startBotBridge,
  stopBotBridge,
  updateBotBridge,
  setBotJoinListener,
  parseReqJoinName,
  startHost, stopHost, addHostPlayerIp,
  startFinder, stopFinder,
  stopAll, isRunning,
};
