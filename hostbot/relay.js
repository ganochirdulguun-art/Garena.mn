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
  MAX_HANDSHAKE: 8192,
};

const hosts = new Map();   // gameId -> { control, name, sessions: Map<sid,{joiner,leftover,timer}> }
let sidCounter = 1;
let joinerCount = 0;

function log(...a) { console.log(new Date().toISOString(), '[relay]', ...a); }

// Socket-оос эхний newline хүртэлх JSON-ыг уншаад {msg, leftover}-ыг буцаана.
function readHandshake(sock, cb) {
  let buf = Buffer.alloc(0);
  const onData = (d) => {
    buf = Buffer.concat([buf, d]);
    const nl = buf.indexOf(0x0a);
    if (nl === -1) {
      if (buf.length > CFG.MAX_HANDSHAKE) { try { sock.destroy(); } catch {} }
      return;
    }
    sock.removeListener('data', onData);
    const line = buf.slice(0, nl).toString('utf8').trim();
    const leftover = buf.slice(nl + 1);
    let msg = null;
    try { msg = JSON.parse(line); } catch { try { sock.destroy(); } catch {} return; }
    cb(msg, leftover);
  };
  sock.on('data', onData);
  sock.on('error', () => {});
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
