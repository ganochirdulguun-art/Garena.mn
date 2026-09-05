#!/usr/bin/env node
/**
 * 📡 Радарын өгөгдөл — relay capture (W3GS урсгал) → hero-гийн хөдөлгөөний дохио + kill/death (2026-09-06).
 *
 * WC3 lockstep сүлжээгээр байрлал явуулдаггүй, зөвхөн ТУШААЛ (0x11 цэг рүү, 0x12/0x13 unit рүү: targetX/Y)
 * явдаг → тоглогч бүрийн hero-д өгсөн тушаалын зорилтуудыг (63–85/мин) авч, клиент хөдөлгөөний хурдаар
 * симуляцилна. Hero = 0x19 (select subgroup) дахь unit type код — тоглогчийн хамгийн олон тушаал өгсөн төрөл.
 * Kill/death = DotA-ийн dr.x gamecache "Data:Hero<killerColour>" = victimColour (тоглолтын явцад, яг цагтай).
 * Ашиглалт: node radarExtract.js <capture.w3gs> [--json]   (reportGame.js энэ модулийг require хийнэ)
 */
'use strict';
const fs = require('fs');
const path = require('path');

function loadActionParser() {
  const cands = ['w3gjs/dist/lib/parsers/ActionParser.js',
    path.join(__dirname, '..', 'client', 'node_modules', 'w3gjs', 'dist', 'lib', 'parsers', 'ActionParser.js')];
  for (const c of cands) { try { const m = require(c); return m.default || m; } catch {} }
  const main = require.resolve('w3gjs');
  const root = main.slice(0, main.lastIndexOf(`${path.sep}dist${path.sep}`) + 1);
  const m = require(path.join(root, 'dist', 'lib', 'parsers', 'ActionParser.js'));
  return m.default || m;
}

const typeCode = (b) => Buffer.from(b).reverse().toString('latin1');   // WC3 type id — little-endian 4 байт
const isHeroCode = (c) => /^[HEOUN][0-9A-Za-z]{3}$/.test(c) && c !== 'ncop';
const MIN_GAP_MS = 400;   // ижил hero-д 0.4с дотор давхардсан тушаалыг нэгтгэнэ (хэмжээ)
const KEEP_EVENT = /^(Hero|Tower|Rax|Roshan|Aegis|Throne|GameStart|RuneUse|Courier|Level)/;

function extractRadar(buf) {
  const AP = loadActionParser(); const ap = new AP();
  const names = {}, lastSel = {}, orders = {}, typeCount = {}, events = [], slots = [];
  let t = 0, i = 0;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xF7) { i++; continue; }
    const id = buf[i + 1], len = buf.readUInt16LE(i + 2);
    if (len < 4 || i + len > buf.length) break;
    const p = buf.subarray(i, i + len);
    try {
      if (id === 0x06) { const e = p.indexOf(0, 9); names[p[8]] = p.subarray(9, e < 0 ? p.length : e).toString('utf8'); }
      else if (id === 0x09 || id === 0x04) {
        const n = p[6]; slots.length = 0;
        for (let k = 0; k < n; k++) { const b = 7 + k * 9; if (b + 9 <= p.length) slots.push({ pid: p[b], team: p[b + 4], colour: p[b + 5] }); }
      } else if (id === 0x0C || id === 0x48) {
        if (id === 0x0C) t += p.readUInt16LE(4);
        let off = 8;
        while (off + 3 <= p.length) {
          const pid = p[off], alen = p.readUInt16LE(off + 1); const ab = p.subarray(off + 3, off + 3 + alen);
          if (ab.length !== alen) break;
          let acts = []; const ol = console.log; console.log = () => {};
          try { acts = ap.parse(Buffer.from(ab)) || []; } catch {} finally { console.log = ol; }
          for (const a of acts) {
            if (a.id === 0x19) lastSel[pid] = typeCode(a.itemId);
            else if ((a.id === 0x11 || a.id === 0x12 || a.id === 0x13) && Number.isFinite(a.targetX) && lastSel[pid]) {
              const c = lastSel[pid];
              (typeCount[pid] = typeCount[pid] || {})[c] = (typeCount[pid][c] || 0) + 1;
              (orders[pid] = orders[pid] || []).push({ t, c, x: a.targetX, y: a.targetY });
            } else if (a.id === 0x6b && a.filename === 'dr.x' && a.missionKey === 'Data') {
              events.push({ t, key: String(a.key), v: a.value >>> 0 });
            }
          }
          off += 3 + alen;
        }
      }
    } catch { /* тасархай пакет — алгасна */ }
    i += len;
  }
  // Тоглогч бүрийн hero = хамгийн олон тушаал өгсөн hero төрлийн код
  const heroes = {};
  for (const [pid, m] of Object.entries(typeCount)) {
    const best = Object.entries(m).filter(([c]) => isHeroCode(c)).sort((a, b) => b[1] - a[1])[0] || Object.entries(m).sort((a, b) => b[1] - a[1])[0];
    if (best) heroes[pid] = { type: best[0], orders: best[1] };
  }
  const paths = {};
  for (const [pid, arr] of Object.entries(orders)) {
    const h = heroes[pid]; if (!h) continue;
    const out = []; let lastT = -1e9;
    for (const o of arr) { if (o.c !== h.type) continue; if (o.t - lastT < MIN_GAP_MS) continue; out.push([o.t, Math.round(o.x), Math.round(o.y)]); lastT = o.t; }
    paths[pid] = out;
  }
  const colourOf = {}; for (const s of slots) if (s.pid > 0) colourOf[s.pid] = s.colour;
  const kills = events.filter((e) => /^Hero\d+$/.test(e.key)).map((e) => ({ t: e.t, killer: Number(e.key.slice(4)), victim: e.v }));
  const players = Object.keys(paths).map((pid) => {
    const s = slots.find((x) => String(x.pid) === String(pid)) || {};
    return { pid: Number(pid), colour: s.colour ?? null, team: s.team === 1 ? 2 : 1, name: names[pid] || null, hero: heroes[pid]?.type || null, hero_orders: heroes[pid]?.orders || 0 };
  });
  return { game_time_sec: Math.round(t / 1000), players, colourOf, paths, kills, events: events.filter((e) => KEEP_EVENT.test(e.key)).slice(0, 2000) };
}

module.exports = { extractRadar };

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('Хэрэглээ: node radarExtract.js <capture.w3gs> [--json]'); process.exit(2); }
  const r = extractRadar(fs.readFileSync(f));
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r)); return; }
  console.log(`${r.game_time_sec}с · тоглогч ${r.players.length} · kill ${r.kills.length} · цэг ${Object.values(r.paths).reduce((n, a) => n + a.length, 0)}`);
  for (const p of r.players) console.log(`  pid ${p.pid} ${p.name || '?'} team${p.team} colour${p.colour} hero=${p.hero} (${p.hero_orders} тушаал, ${r.paths[p.pid].length} цэг)`);
}
