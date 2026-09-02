#!/usr/bin/env node
/**
 * W3GS сүлжээний урсгал → DotA статистик (Алхам 2 — 2026-09-02).
 *
 * Relay capture файл = хост→joiner чиглэлийн ТҮҮХИЙ W3GS пакетууд (F7 id len …). Бот-хост ч,
 * клиентийн replay ч ХЭРЭГГҮЙ — тоглогч-хостын тоглоомын урсгалыг сервер тал шууд уншина.
 *   1) пакет алхаж 0x0C/0x48 INCOMING_ACTION → command block {pid, actions} гаргана,
 *   2) w3gjs ActionParser-аар action бүрийг задалж 0x6B (gamecache = DotA "dr.x" w3mmd) түүнэ,
 *   3) dotaStats.decodeDotaStats → тоглогч бүрийн K/D/A, creep, denie, gold, neutral, item, hero,
 *   4) нэмэлт: PLAYERINFO нэрс (pid→нэр), joiner-ийн pid (SLOTINFOJOIN), тоглоомын цаг
 *      (sendInterval нийлбэр), START/STOP_LAG (ХЭН, хэдэн удаа гацаасан), PLAYERLEAVE.
 * Формат: GHost++ gameprotocol.cpp (W3GS_INCOMING_ACTION = F7 0C len sendInterval[2] crc[2] {pid,len[2],action…}).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { decodeDotaStats } = require('./dotaStats');

// w3gjs-ийн ActionParser — replay болон сүлжээний action байт ижил бүтэцтэй тул дахин ашиглана.
function loadActionParser() {
  const cands = [
    'w3gjs/dist/lib/parsers/ActionParser.js',
    path.join(__dirname, '..', 'client', 'node_modules', 'w3gjs', 'dist', 'lib', 'parsers', 'ActionParser.js'),
  ];
  for (const c of cands) { try { const m = require(c); return m.default || m; } catch {} }
  // Шинэ w3gjs "exports"-оор гүн замыг хаадаг → package-ийн main-ийг олоод АБСОЛЮТ замаар require (exports тойрно)
  try {
    const main = require.resolve('w3gjs');
    const root = main.slice(0, main.lastIndexOf(`${path.sep}dist${path.sep}`) + 1);
    const m = require(path.join(root, 'dist', 'lib', 'parsers', 'ActionParser.js'));
    return m.default || m;
  } catch {}
  throw new Error('w3gjs ActionParser олдсонгүй — hostbot дотор `npm i w3gjs` хийнэ үү');
}

function walkCommandBlocks(p, off, ap, out) {
  while (off + 3 <= p.length) {
    const pid = p[off];
    const alen = p.readUInt16LE(off + 1);
    const ab = p.subarray(off + 3, off + 3 + alen);
    if (ab.length !== alen) break;   // тасархай block — үлдсэнийг орхино
    out.actionBlocks++;
    let actions = [];
    const origLog = console.log; console.log = () => {};   // ActionParser үл мэдэх action-д console.log хийдэг — дарна
    try { actions = ap.parse(Buffer.from(ab)) || []; } catch {} finally { console.log = origLog; }
    for (const a of actions) {
      if (a && a.id === 0x6b) out.w3mmd.push({ pid, filename: a.filename, missionKey: a.missionKey, key: a.key, value: a.value });
    }
    off += 3 + alen;
  }
}

// Слотын хүснэгт (GHost CGameSlot::GetByteArray — 9 байт): pid dl status computer team colour race ctype handicap.
// colour = DotA stat-ын missionKey (Sentinel 1-5, Scourge 7-11) → pid → нэр холбоход хэрэглэнэ.
function parseSlots(p, off) {
  const n = p[off];
  const slots = [];
  for (let k = 0; k < n; k++) {
    const b = off + 1 + k * 9;
    if (b + 9 > p.length) break;
    slots.push({ pid: p[b], status: p[b + 2], team: p[b + 4], colour: p[b + 5] });
  }
  return slots;
}

function parseW3gsStream(buf) {
  const ActionParser = loadActionParser();
  const ap = new ActionParser();
  const out = { names: {}, ownPid: null, slots: [], gameTimeMs: 0, w3mmd: [], lag: {}, lagEvents: 0, leaves: [], packets: {}, bad: 0, actionBlocks: 0, bytes: buf.length };
  let i = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xF7) { out.bad++; i++; continue; }
    const id = buf[i + 1];
    const len = buf.readUInt16LE(i + 2);
    if (len < 4) { out.bad++; i++; continue; }
    if (i + len > buf.length) break;   // сүүлийн тасархай пакет (capture дундаа зогссон)
    const p = buf.subarray(i, i + len);
    out.packets[id] = (out.packets[id] || 0) + 1;
    try {
      if (id === 0x0C || id === 0x48) {
        // 0x0C: sendInterval[2] crc[2] blocks…  0x48 (том багц, тоглоомын төгсгөлийн stat dump): pad[2] crc[2] blocks…
        // — хоёулаа offset 8-аас (GHost gameprotocol.cpp; бодит capture-аар баталсан).
        if (id === 0x0C && len >= 6) out.gameTimeMs += p.readUInt16LE(4);
        if (len > 8) walkCommandBlocks(p, 8, ap, out);
      } else if (id === 0x06) {          // PLAYERINFO: counter[4] pid name\0
        const end = p.indexOf(0, 9);
        out.names[p[8]] = p.subarray(9, end < 0 ? p.length : end).toString('utf8');
      } else if (id === 0x04) {          // SLOTINFOJOIN: slotInfoSize[2] slotInfo pid …
        out.ownPid = p[6 + p.readUInt16LE(4)];
        out.slots = parseSlots(p, 6);
      } else if (id === 0x09) {          // SLOTINFO: slotInfoSize[2] slotInfo — сүүлийнх нь тоглоом эхлэхийн өмнөх эцсийн байрлал
        out.slots = parseSlots(p, 6);
      } else if (id === 0x10) {          // START_LAG: n {pid, ms[4]}
        const n = p[4];
        for (let k = 0; k < n; k++) { const pid = p[5 + k * 5]; (out.lag[pid] = out.lag[pid] || { starts: 0, ms: 0 }).starts++; }
        out.lagEvents++;
      } else if (id === 0x11) {          // STOP_LAG: pid ms[4] — WC3 хуримтлагдсан утга явуулдаг тул max авна
        const L = (out.lag[p[4]] = out.lag[p[4]] || { starts: 0, ms: 0 });
        L.ms = Math.max(L.ms, p.readUInt32LE(5));
      } else if (id === 0x07) {          // PLAYERLEAVE_OTHERS: pid reason[4]
        out.leaves.push({ pid: p[4], reason: p.readUInt32LE(5), atMs: out.gameTimeMs });
      }
    } catch { out.bad++; }
    i += len;
  }
  return out;
}

// Capture файл → бүрэн дүн (нэрс, гацалт, DotA stat).
function summarizeCapture(buf) {
  const s = parseW3gsStream(buf);
  const stats = decodeDotaStats(s.w3mmd);
  const nameOf = (pid) => s.names[pid] || (pid === s.ownPid ? `(joiner pid${pid})` : `pid${pid}`);
  // colour → pid (эцсийн слотын хүснэгт) → stat бүрийг бодит тоглогчид холбоно
  const colourToPid = {};
  for (const sl of s.slots) if (sl.pid > 0) colourToPid[sl.colour] = sl.pid;
  for (const p of stats.players) {
    p.pid = colourToPid[p.colour] ?? null;
    p.name = p.pid ? nameOf(p.pid) : null;
    p.isJoiner = p.pid != null && p.pid === s.ownPid;
    p.active = !!(p.hero || p.pid != null);   // слотод бодит тоглогч байсан бол hero сонгоогүй ч "бодит"
  }
  const lag = Object.entries(s.lag).map(([pid, L]) => ({ pid: Number(pid), name: nameOf(Number(pid)), lagScreens: L.starts, totalLagSec: Math.round(L.ms / 100) / 10 }));
  return {
    bytes: s.bytes, gameTimeSec: Math.round(s.gameTimeMs / 1000), names: s.names, ownPid: s.ownPid,
    slots: s.slots.filter((sl) => sl.pid > 0),
    packets: Object.fromEntries(Object.entries(s.packets).map(([k, v]) => ['0x' + Number(k).toString(16).padStart(2, '0'), v])),
    actionBlocks: s.actionBlocks, badBytes: s.bad, w3mmdCount: s.w3mmd.length, lagEvents: s.lagEvents, lag,
    leaves: s.leaves.map((l) => ({ ...l, name: nameOf(l.pid) })),
    stats,
  };
}

module.exports = { parseW3gsStream, summarizeCapture };

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('Хэрэглээ: node w3gsStats.js <capture.w3gs>'); process.exit(2); }
  const r = summarizeCapture(fs.readFileSync(f));
  console.log(JSON.stringify(r, null, 2));
}
