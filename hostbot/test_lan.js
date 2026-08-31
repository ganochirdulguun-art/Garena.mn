'use strict';
// Фаз 2 интеграцийн тест (WC3-гүй): клиентийн startLanHost/startLanJoin-ийн TCP relay зам,
// GAMEINFO capture, handshake-ууд зөв ажиллаж байгааг relay-ээр батална.
const cp = require('child_process');
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const relay = require(path.join(__dirname, '..', 'client', 'src', 'services', 'gameRelay.js'));

const RP = 7080;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (n, ok) => { if (ok) { pass++; console.log('  PASS ' + n); } else { fail++; console.log('  FAIL ' + n); } };

// Хуурмаг GAMEINFO пакет (capture/validate шалгалтад хангалттай: len>=24, F7 30 header)
function fakeGameInfo() {
  const b = Buffer.alloc(40);
  b[0] = 0xF7; b[1] = 0x30; b.writeUInt16LE(40, 2);
  b.write('GMN-TEST', 20, 'ascii');
  b.writeUInt16LE(6112, 38);   // порт талбар (сүүлийн 2 байт)
  return b;
}

// Relay руу түүхий joiner холбогдож нэг мессеж илгээгээд хариу авах
function rawJoin(host, port, game, payload) {
  return new Promise((resolve) => {
    const s = net.connect(port, host, () => { s.write(JSON.stringify({ t: 'joiner', game }) + '\n'); setTimeout(() => s.write(payload), 100); });
    let got = Buffer.alloc(0);
    const to = setTimeout(() => { s.destroy(); resolve(got.toString()); }, 3500);
    s.on('data', (d) => { got = Buffer.concat([got, d]); if (got.toString().includes('HOSTECHO:')) { clearTimeout(to); s.destroy(); resolve(got.toString()); } });
    s.on('error', () => { clearTimeout(to); resolve(''); });
  });
}

// Хуурмаг хост: relay-д register хийж, newjoiner дээр hostdata нээж ECHO:-той эргүүлнэ
function fakeHostOnRelay(host, port, game) {
  const ctl = net.connect(port, host, () => ctl.write(JSON.stringify({ t: 'register', game, key: 'test', name: 'FakeHost' }) + '\n'));
  let cbuf = Buffer.alloc(0);
  ctl.on('data', (d) => {
    cbuf = Buffer.concat([cbuf, d]); let nl;
    while ((nl = cbuf.indexOf(0x0a)) !== -1) {
      const line = cbuf.slice(0, nl).toString('utf8').trim(); cbuf = cbuf.slice(nl + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'newjoiner') {
        const hd = net.connect(port, host, () => hd.write(JSON.stringify({ t: 'hostdata', game, session: m.session }) + '\n'));
        hd.on('data', (c) => { try { hd.write(Buffer.concat([Buffer.from('ECHO:'), c])); } catch {} });
        hd.on('error', () => {});
      }
    }
  });
  ctl.on('error', () => {});
  return ctl;
}

function tcpSendRecv(host, port, payload) {
  return new Promise((resolve) => {
    const s = net.connect(port, host, () => setTimeout(() => s.write(payload), 100));
    let got = Buffer.alloc(0);
    const to = setTimeout(() => { s.destroy(); resolve(got.toString()); }, 3500);
    s.on('data', (d) => { got = Buffer.concat([got, d]); if (got.toString().includes('ECHO:')) { clearTimeout(to); s.destroy(); resolve(got.toString()); } });
    s.on('error', () => { clearTimeout(to); resolve(''); });
  });
}

async function main() {
  const relayProc = cp.spawn(process.execPath, [path.join(__dirname, 'relay.js')],
    { env: { ...process.env, RELAY_PORT: String(RP), RELAY_KEY: 'test', PUBLIC_IP: '127.0.0.1' }, stdio: 'ignore' });
  await sleep(900);

  // ═══ Тест A: ХОСТ тал (GAMEINFO capture + control register + hostdata splice) ═══
  console.log('=== Тест A: startLanHost ===');
  const GI = fakeGameInfo();
  const hostUdp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  hostUdp.on('message', (msg, rinfo) => { if (msg.length >= 2 && msg[0] === 0xF7 && msg[1] === 0x2F) { try { hostUdp.send(GI, 0, GI.length, rinfo.port, rinfo.address); } catch {} } });
  await new Promise((r) => hostUdp.bind(6112, '0.0.0.0', r));   // хуурмаг WC3 host UDP
  const hostTcp = net.createServer((s) => { s.on('data', (d) => { try { s.write(Buffer.concat([Buffer.from('HOSTECHO:'), d])); } catch {} }); s.on('error', () => {}); });
  await new Promise((r) => hostTcp.listen(6112, '127.0.0.1', r));   // хуурмаг WC3 host game socket

  let capturedGI = null;
  relay.startLanHost({ relayIp: '127.0.0.1', relayPort: RP, game: 'g1', relayKey: 'test', wc3Name: 'Host', onGameInfo: (b64) => { capturedGI = b64; } });
  await sleep(2200);
  check('GAMEINFO probe-оор баригдав', !!capturedGI);

  const echoA = await rawJoin('127.0.0.1', RP, 'g1', 'PING-A');
  check('joiner→relay→host→локал WC3 splice: "' + echoA.slice(0, 30) + '"', echoA.includes('HOSTECHO:PING-A'));

  relay.stopLanHost();
  await new Promise((r) => hostUdp.close(r));
  await new Promise((r) => hostTcp.close(r));
  await sleep(600);

  // ═══ Тест B: JOINER тал (TCP proxy dials relay + joiner handshake + pipe) ═══
  console.log('=== Тест B: startLanJoin ===');
  fakeHostOnRelay('127.0.0.1', RP, 'g2');
  await sleep(400);
  relay.startLanJoin({ relayIp: '127.0.0.1', relayPort: RP, game: 'g2', gameInfoB64: GI.toString('base64'), localPort: 6250 });
  await sleep(500);
  const echoB = await tcpSendRecv('127.0.0.1', 6250, 'PING-B');   // хуурмаг WC3 → join proxy
  check('WC3→join proxy→relay→host echo: "' + echoB.slice(0, 30) + '"', echoB.includes('ECHO:PING-B'));
  relay.stopLanJoin();

  await sleep(300);
  try { relayProc.kill(); } catch {}
  console.log('=== ДҮН: ' + pass + ' PASS, ' + fail + ' FAIL ===');
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(2); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(3); }, 20000);
