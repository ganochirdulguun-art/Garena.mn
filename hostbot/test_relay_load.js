'use strict';
// Relay-ийн ачааллын тест: node test_relay_load.js <players> [port] [seconds] [pktBytes] [pktPerSec]
// Тусдаа (бичлэггүй, report-гүй) relay инстанцын эсрэг ажиллуулна — продакшн relay-д БҮҮ ажиллуул.
// 10 тоглогчтой тоглоом бүрт: 1 хост control + 9 joiner; хос бүр хоёр чиглэлд WC3 action маягийн жижиг пакет.
// Гаралт: relay процессын CPU%, RSS, нэмэгдсэн хоцрогдол (p50/p95/p99 echo RTT).
const net = require('net');
const fs = require('fs');
const PLAYERS = Number(process.argv[2] || 100);
const PORTS = String(process.argv[3] || '7100').split(',').map(Number);   // олон порт = shard (тоглоом бүр нэг порт)
const SECS = Number(process.argv[4] || 30);
const PKT = Number(process.argv[5] || 64);
const PPS = Number(process.argv[6] || 10);
const RELAY_PIDS = String(process.env.RELAY_PID || '').split(',').filter(Boolean).map(Number);
const GAMES = Math.max(1, Math.round(PLAYERS / 10));
const JOINERS_PER_GAME = 9;
const HOST = '127.0.0.1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rtts = [];
const socks = [];
let ready = 0;

function cpuTicks(pid) { try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' '); return Number(f[11]) + Number(f[12]); } catch { return 0; } }
function rssMb(pid) { try { const m = fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/); return m ? Math.round(Number(m[1]) / 1024) : 0; } catch { return 0; } }

function startGame(g) {
  const game = `load-${process.pid}-${g}`;
  const PORT = PORTS[g % PORTS.length];
  const ctl = net.connect(PORT, HOST);
  socks.push(ctl);
  ctl.setNoDelay(true);
  ctl.on('error', () => {});
  let buf = '';
  ctl.on('connect', () => ctl.write(JSON.stringify({ t: 'register', game, name: 'load', nocap: true }) + '\n'));
  ctl.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      let m; try { m = JSON.parse(line); } catch { continue; }
      if (m.t === 'registered') { for (let j = 0; j < JOINERS_PER_GAME; j++) setTimeout(() => startJoiner(game, j === 0, PORT), j * 20); }
      else if (m.t === 'newjoiner') {
        const hd = net.connect(PORT, HOST);
        socks.push(hd); hd.setNoDelay(true); hd.on('error', () => {});
        hd.on('connect', () => { hd.write(JSON.stringify({ t: 'hostdata', game, session: m.session }) + '\n'); });
        hd.on('data', (x) => { hd.write(x); });   // хост тал: ирсэн бүхнийг буцаана (echo) — хост→joiner урсгал
      }
    }
  });
}
function startJoiner(game, probe, PORT) {
  const s = net.connect(PORT, HOST);
  socks.push(s); s.setNoDelay(true); s.on('error', () => {});
  s.on('connect', () => {
    s.write(JSON.stringify({ t: 'joiner', game }) + '\n');
    ready++;
    const payload = Buffer.alloc(PKT, 7);
    const pending = new Map();
    let seq = 0;
    if (probe) s.on('data', (d) => { const k = d.readUInt32LE(0); const t0 = pending.get(k); if (t0) { rtts.push(Number(process.hrtime.bigint() - t0) / 1e6); pending.delete(k); } });
    const iv = setInterval(() => {
      if (s.destroyed) return clearInterval(iv);
      const p = Buffer.from(payload); const k = seq++; p.writeUInt32LE(k, 0);
      if (probe) pending.set(k, process.hrtime.bigint());
      s.write(p);
    }, 1000 / PPS);
    iv.unref?.();
  });
}

(async () => {
  for (let g = 0; g < GAMES; g++) { startGame(g); if (g % 20 === 19) await sleep(50); }
  await sleep(4000);
  const t0 = RELAY_PIDS.map(cpuTicks); const w0 = Date.now(); rtts.length = 0;
  await sleep(SECS * 1000);
  const t1 = RELAY_PIDS.map(cpuTicks); const dt = (Date.now() - w0) / 1000;
  const cpu = RELAY_PIDS.map((_, i) => Math.round(((t1[i] - t0[i]) / 100) / dt * 100));   // процесс бүрийн CPU% (100 tick/с)
  const s = rtts.slice().sort((a, b) => a - b); const q = (p) => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(2) : null;
  console.log(JSON.stringify({ players: GAMES * 10, games: GAMES, joinersConnected: ready, pkt: PKT, pps: PPS, relayCpuPct: cpu, relayRssMb: RELAY_PIDS.map(rssMb), rttMs: { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: s.length ? s[s.length - 1].toFixed(2) : null } }));
  for (const x of socks) { try { x.destroy(); } catch {} }
  setTimeout(() => process.exit(0), 500);
})();
