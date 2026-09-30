'use strict';
// Бодит (алсын) relay-ээр бүтэн LAN замыг шалгах: node hostbot/test_remote_relay.js <ip> [port]
// Хуурамч WC3 (UDP/TCP 6112) → startLanHost (relay-д бүртгүүлнэ) → joiner relay-ээр холбогдож echo авна; RTT хэмжинэ.
const net = require('net');
const dgram = require('dgram');
const path = require('path');
const relay = require(path.join(__dirname, '..', 'client', 'src', 'services', 'gameRelay.js'));
const IP = process.argv[2]; const PORT = Number(process.argv[3] || 7000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAME = 'probe-' + Date.now().toString(36);

function gi() { const b = Buffer.alloc(40); b[0] = 0xF7; b[1] = 0x30; b.writeUInt16LE(40, 2); b.write('GMN-PROBE', 20, 'ascii'); b.writeUInt16LE(6112, 38); return b; }
async function main() {
  const GI = gi();
  const u = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  u.on('message', (m, r) => { if (m[0] === 0xF7 && m[1] === 0x2F) u.send(GI, r.port, r.address); });
  await new Promise((r) => u.bind(6112, '0.0.0.0', r));
  const t = net.createServer((s) => { s.on('data', (d) => s.write(d)); s.on('error', () => {}); });
  await new Promise((r) => t.listen(6112, '127.0.0.1', r));
  relay.startLanHost({ relayIp: IP, relayPort: PORT, game: GAME, relayKey: '', wc3Name: 'probe', onGameInfo: () => {} });
  await sleep(2500);
  const rtts = [];
  const s = net.connect(PORT, IP);
  await new Promise((r, j) => { s.once('connect', r); s.once('error', j); });
  s.write(JSON.stringify({ t: 'joiner', game: GAME }) + '\n');
  await sleep(600);
  let buf = '';
  s.on('data', (d) => { buf += d.toString(); });
  for (let i = 0; i < 10; i++) {
    const tok = `P${i};`; const t0 = Date.now(); s.write(tok);
    while (!buf.includes(tok)) { await sleep(1); if (Date.now() - t0 > 3000) break; }
    rtts.push(buf.includes(tok) ? Date.now() - t0 : null);
    await sleep(100);
  }
  s.destroy(); relay.stopLanHost(); u.close(); t.close();
  const ok = rtts.filter((x) => x != null);
  console.log(JSON.stringify({ relay: `${IP}:${PORT}`, echoed: `${ok.length}/10`, rtt_ms: ok, min: Math.min(...ok), avg: Math.round(ok.reduce((a, b) => a + b, 0) / (ok.length || 1)) }));
  process.exit(ok.length === 10 ? 0 : 1);
}
main().catch((e) => { console.error('FAIL', e.message); process.exit(2); });
setTimeout(() => { console.log('TIMEOUT'); process.exit(3); }, 30000);
