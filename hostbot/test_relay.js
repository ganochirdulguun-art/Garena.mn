'use strict';
// Локал тест: relay-ээр joiner→host→(echo)→joiner байт эргэлт бүтэж байгааг батлана.
// Ажиллуулахаас өмнө: RELAY_PORT=7000 RELAY_KEY=test PUBLIC_IP=127.0.0.1 node relay.js
const net = require('net');
const PORT = Number(process.env.RELAY_PORT || 7000);
const HOST = process.env.RELAY_HOST || '127.0.0.1';
const KEY = process.env.RELAY_KEY || 'test';
const GAME = 'game-test-token-abc123';

function sendLine(sock, obj) { sock.write(JSON.stringify(obj) + '\n'); }
function readLine(sock, cb) {
  let buf = Buffer.alloc(0);
  const on = (d) => {
    buf = Buffer.concat([buf, d]);
    const nl = buf.indexOf(0x0a);
    if (nl === -1) return;
    sock.removeListener('data', on);
    const line = buf.slice(0, nl).toString('utf8').trim();
    const rest = buf.slice(nl + 1);
    cb(JSON.parse(line), rest);
  };
  sock.on('data', on);
}

let passed = 0, failed = 0;
function check(name, ok) { if (ok) { passed++; console.log('  PASS ' + name); } else { failed++; console.log('  FAIL ' + name); } }

// ---- ХОСТ: control холболт + newjoiner дээр hostdata нээж ECHO хийнэ ----
function startHost(done) {
  const ctl = net.connect(PORT, HOST, () => sendLine(ctl, { t: 'register', game: GAME, key: KEY, name: 'HostBot' }));
  readLine(ctl, (msg) => {
    check('host registered хүлээж авав', msg.t === 'registered' && msg.game === GAME);
    done();
    // control дараагийн мессежүүд (newjoiner)-ыг сонсоно
    let cbuf = Buffer.alloc(0);
    ctl.on('data', (d) => {
      cbuf = Buffer.concat([cbuf, d]);
      let nl;
      while ((nl = cbuf.indexOf(0x0a)) !== -1) {
        const line = cbuf.slice(0, nl).toString('utf8').trim();
        cbuf = cbuf.slice(nl + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.t === 'newjoiner') {
          // hostdata холболт нээж, ирсэн бүх байтыг "ECHO:"-той эргүүлнэ (WC3 хостын эмуляц)
          const hd = net.connect(PORT, HOST, () => sendLine(hd, { t: 'hostdata', game: GAME, session: m.session }));
          hd.on('data', (chunk) => { try { hd.write(Buffer.concat([Buffer.from('ECHO:'), chunk])); } catch {} });
          hd.on('error', () => {});
        }
      }
    });
  });
  ctl.on('error', (e) => { console.log('host ctl алдаа', e.message); });
}

// ---- JOINER: joiner холболт нээж PING илгээгээд ECHO хүлээнэ ----
function startJoiner(idx, cb) {
  const j = net.connect(PORT, HOST, () => {
    sendLine(j, { t: 'joiner', game: GAME });
    // handshake-ийн дараа шууд WC3 байт (энд PING) илгээнэ
    setTimeout(() => j.write('PING-' + idx), 100);
  });
  let got = Buffer.alloc(0);
  const timer = setTimeout(() => { check('joiner ' + idx + ' echo хүлээж авав', false); j.destroy(); cb(); }, 4000);
  j.on('data', (d) => {
    got = Buffer.concat([got, d]);
    if (got.toString().includes('ECHO:PING-' + idx)) {
      clearTimeout(timer);
      check('joiner ' + idx + ' echo зөв: "' + got.toString() + '"', true);
      j.destroy(); cb();
    }
  });
  j.on('error', (e) => { console.log('joiner алдаа', e.message); });
}

console.log('=== Relay локал тест эхэллээ (PORT=' + PORT + ') ===');
startHost(() => {
  // хост бүртгэгдсэний дараа 2 joiner зэрэг оруулж multiplex шалгана
  let remaining = 2;
  const fin = () => { if (--remaining === 0) {
    console.log('=== ДҮН: ' + passed + ' PASS, ' + failed + ' FAIL ===');
    process.exit(failed === 0 ? 0 : 1);
  }};
  startJoiner(1, fin);
  setTimeout(() => startJoiner(2, fin), 300);
});
setTimeout(() => { console.log('TIMEOUT'); process.exit(2); }, 10000);
