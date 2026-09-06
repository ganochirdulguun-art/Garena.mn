#!/usr/bin/env node
/**
 * Relay RTT daemon (2026-09-06) — relay-ийн :7000 холболт бүрийн БОДИТ TCP RTT-г (kernel `ss -tni`) 8 с тутам
 * платформ сервер рүү POST /relay/rtt илгээнэ → сервер тухайн IP-ийн тоглогчийн ping тэмдгийг relay-ийн хэмжилтээр солино.
 * Шалтгаан: аппын ping = клиентийн TCP-connect probe → PC ачаалал/стрим орж 120–160 мс "гацаж байна" мэт харагддаг
 * байхад relay талын socket RTT 20–70 мс байдаг. Kernel-ийн хэмжилт = тоглоомын пакетын бодит замын саатал.
 * ГАЦАЛТГҮЙ ЗАРЧИМ: relay.js процесс/socket-д огт хүрэхгүй — `ss` нь netlink read-only асуулга (мс-ийн хэдэн зуу дахь);
 * тусдаа процесс, Nice=15. Env: RELAY_REPORT_URL, RELAY_REPORT_KEY (report.env).
 */
'use strict';
const { execFile } = require('child_process');
const URL_BASE = String(process.env.RELAY_REPORT_URL || '').replace(/\/$/, '');
const KEY = process.env.RELAY_REPORT_KEY || '';
const TICK_MS = Number(process.env.RELAY_RTT_TICK_MS || 8000);
const ACTIVE_MS = Number(process.env.RELAY_RTT_ACTIVE_MS || 30000);   // lastsnd < 30 с = яг одоо тоглож буй
const PORT = Number(process.env.RELAY_PORT || 7000);
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

// `ss -tni state established ( sport = :7000 )` гаралт: мөр1 = хаягууд, мөр2 = "... rtt:53.3/17.2 ... retrans:0/7 ... lastsnd:89 ..."
function parseSs(out) {
  const peers = []; let cur = null;
  for (const raw of String(out).split('\n')) {
    const line = raw.trim(); if (!line) continue;
    if (!/^\s/.test(raw) && !line.startsWith('cubic') && !line.includes('rtt:')) {
      // хаягийн мөр: Recv-Q Send-Q Local Peer  (эсвэл толгой)
      const parts = line.split(/\s+/);
      const peer = parts[parts.length - 1] || '';
      const m = peer.match(/^\[?(?:::ffff:)?([0-9a-f.:]+?)\]?:(\d+)$/i);
      cur = m && !/^(Recv|Local|Peer)/.test(parts[0]) ? { ip: m[1], port: Number(m[2]) } : null;
      continue;
    }
    if (!cur) continue;
    const rtt = line.match(/\brtt:([0-9.]+)\/([0-9.]+)/), rtr = line.match(/\bretrans:(\d+)\/(\d+)/), ls = line.match(/\blastsnd:(\d+)/), lr = line.match(/\blastrcv:(\d+)/);
    if (rtt) peers.push({ ip: cur.ip, port: cur.port, rtt: Number(rtt[1]), rttvar: Number(rtt[2]), retrans: rtr ? Number(rtr[2]) : 0, lastsnd: ls ? Number(ls[1]) : null, lastrcv: lr ? Number(lr[1]) : null });
    cur = null;
  }
  return peers;
}

function ss() {
  return new Promise((resolve) => {
    execFile('ss', ['-tni', 'state', 'established', `( sport = :${PORT} )`], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out));
  });
}

let lastPosted = 0, fails = 0;
async function tick() {
  const out = await ss();
  const all = parseSs(out);
  const active = all.filter((p) => p.lastsnd != null && p.lastsnd < ACTIVE_MS);
  if (!active.length && Date.now() - lastPosted < 60000) return;   // идэвхтэй холболтгүй бол минутад нэг л мэдэгдэнэ (сервер хуучныг цэвэрлэнэ)
  if (!URL_BASE) return;
  try {
    const res = await fetch(`${URL_BASE}/relay/rtt`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-key': KEY }, body: JSON.stringify({ at: Date.now(), peers: active }) });
    if (res.status !== 200) { if (++fails <= 3 || fails % 20 === 0) log(`POST ${res.status} ${(await res.text()).slice(0, 100)} (fail ${fails})`); return; }
    fails = 0; lastPosted = Date.now();
    if (active.length) log(`${active.length} идэвхтэй: ` + active.map((p) => `${p.ip} ${Math.round(p.rtt)}мс${p.retrans ? ' rt' + p.retrans : ''}`).join(', '));
  } catch (e) { if (++fails <= 3) log('POST алдаа: ' + e.message); }
}

module.exports = { parseSs };
if (require.main === module) { log(`relayRtt эхлэв port=${PORT} tick=${TICK_MS}мс url=${URL_BASE || '(алга)'}`); setInterval(tick, TICK_MS); tick(); }
