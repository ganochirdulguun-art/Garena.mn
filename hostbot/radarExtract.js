#!/usr/bin/env node
/**
 * 📡 Радарын өгөгдөл — relay capture (W3GS урсгал) → hero-гийн хөдөлгөөний дохио + kill/death (2026-09-06).
 *
 * WC3 lockstep сүлжээгээр байрлал явуулдаггүй, зөвхөн ТУШААЛ (0x11 цэг рүү, 0x12/0x13 unit рүү: targetX/Y)
 * явдаг → тоглогч бүрийн hero-д өгсөн тушаалын зорилтуудыг (63–85/мин) авч, клиент хөдөлгөөний хурдаар
 * симуляцилна. Hero = 0x19 (select subgroup) дахь unit type код — тоглогчийн хамгийн олон тушаал өгсөн төрөл.
 * Kill/death = DotA-ийн dr.x gamecache "Data:Hero<killerColour>" = victimColour (тоглолтын явцад, яг цагтай).
 *
 * УРСГАЛТ (live, 2026-09-06): createRadarStream() → feed(chunk) хэсэгчлэн (capture файл ургах тусам) →
 * snapshot(sinceMs) — sinceMs-ээс хойшхи цэг/kill/event-ийг л буцаана (delta). extractRadar(buf) = бүтнээр.
 * Ашиглалт: node radarExtract.js <capture.w3gs> [--json]   (reportGame.js, radarLive.js энэ модулийг require хийнэ)
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

function createRadarStream() {
  const AP = loadActionParser(); const ap = new AP();
  const st = { names: {}, lastSel: {}, orders: {}, typeCount: {}, events: [], slots: [], t: 0, rest: Buffer.alloc(0), bytes: 0, packets: 0 };

  function packet(p) {
    const id = p[1];
    try {
      if (id === 0x06) { const e = p.indexOf(0, 9); st.names[p[8]] = p.subarray(9, e < 0 ? p.length : e).toString('utf8'); }
      else if (id === 0x09 || id === 0x04) {
        const n = p[6]; st.slots.length = 0;
        for (let k = 0; k < n; k++) { const b = 7 + k * 9; if (b + 9 <= p.length) st.slots.push({ pid: p[b], team: p[b + 4], colour: p[b + 5] }); }
      } else if (id === 0x0C || id === 0x48) {
        if (id === 0x0C) st.t += p.readUInt16LE(4);
        let off = 8;
        while (off + 3 <= p.length) {
          const pid = p[off], alen = p.readUInt16LE(off + 1); const ab = p.subarray(off + 3, off + 3 + alen);
          if (ab.length !== alen) break;
          let acts = []; const ol = console.log; console.log = () => {};
          try { acts = ap.parse(Buffer.from(ab)) || []; } catch {} finally { console.log = ol; }
          for (const a of acts) {
            if (a.id === 0x19) st.lastSel[pid] = typeCode(a.itemId);
            else if ((a.id === 0x11 || a.id === 0x12 || a.id === 0x13) && Number.isFinite(a.targetX) && st.lastSel[pid]) {
              const c = st.lastSel[pid];
              (st.typeCount[pid] = st.typeCount[pid] || {})[c] = (st.typeCount[pid][c] || 0) + 1;
              (st.orders[pid] = st.orders[pid] || []).push({ t: st.t, c, x: a.targetX, y: a.targetY });
            } else if (a.id === 0x6b && a.filename === 'dr.x' && a.missionKey === 'Data') {
              st.events.push({ t: st.t, key: String(a.key), v: a.value >>> 0 });
            }
          }
          off += 3 + alen;
        }
      }
    } catch { /* тасархай пакет — алгасна */ }
  }

  // Шинэ байт нэмнэ — пакетийн зааг дунд тасарсан үлдэгдлийг (rest) дараагийн feed-тэй залгана
  function feed(chunk) {
    if (!chunk || !chunk.length) return;
    const buf = st.rest.length ? Buffer.concat([st.rest, chunk]) : chunk;
    st.bytes += chunk.length;
    let i = 0;
    while (i + 4 <= buf.length) {
      if (buf[i] !== 0xF7) { i++; continue; }
      const len = buf.readUInt16LE(i + 2);
      if (len < 4) { i++; continue; }
      if (i + len > buf.length) break;          // бүтэн ирээгүй — дараагийн chunk-ийг хүлээнэ
      packet(buf.subarray(i, i + len)); st.packets++;
      i += len;
    }
    st.rest = Buffer.from(buf.subarray(i));
  }

  // sinceMs ≥ 0 бол зөвхөн t > sinceMs цэг/kill/event (delta); players/colourOf/game_time үргэлж бүтэн
  function snapshot(sinceMs = -1) {
    const heroes = {};
    for (const [pid, m] of Object.entries(st.typeCount)) {
      const best = Object.entries(m).filter(([c]) => isHeroCode(c)).sort((a, b) => b[1] - a[1])[0] || Object.entries(m).sort((a, b) => b[1] - a[1])[0];
      if (best) heroes[pid] = { type: best[0], orders: best[1] };
    }
    const paths = {};
    for (const [pid, arr] of Object.entries(st.orders)) {
      const h = heroes[pid]; if (!h) continue;
      const out = []; let lastT = -1e9;
      for (const o of arr) {
        if (o.c !== h.type) continue; if (o.t - lastT < MIN_GAP_MS) continue;
        lastT = o.t; if (o.t > sinceMs) out.push([o.t, Math.round(o.x), Math.round(o.y)]);
      }
      paths[pid] = out;
    }
    const colourOf = {}; for (const s of st.slots) if (s.pid > 0) colourOf[s.pid] = s.colour;
    const ev = st.events.filter((e) => e.t > sinceMs);
    const kills = ev.filter((e) => /^Hero\d+$/.test(e.key)).map((e) => ({ t: e.t, killer: Number(e.key.slice(4)), victim: e.v }));
    const players = Object.keys(paths).map((pid) => {
      const s = st.slots.find((x) => String(x.pid) === String(pid)) || {};
      return { pid: Number(pid), colour: s.colour ?? null, team: s.team === 1 ? 2 : 1, name: st.names[pid] || null, hero: heroes[pid]?.type || null, hero_orders: heroes[pid]?.orders || 0 };
    });
    return { game_time_sec: Math.round(st.t / 1000), game_time_ms: st.t, players, colourOf, paths, kills, events: ev.filter((e) => KEEP_EVENT.test(e.key)).slice(0, 2000) };
  }

  return { feed, snapshot, get gameTimeMs() { return st.t; }, get bytes() { return st.bytes; }, get packets() { return st.packets; } };
}

function extractRadar(buf) {
  const s = createRadarStream(); s.feed(buf);
  const r = s.snapshot(-1); delete r.game_time_ms;
  return r;
}

module.exports = { extractRadar, createRadarStream };

if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error('Хэрэглээ: node radarExtract.js <capture.w3gs> [--json]'); process.exit(2); }
  const r = extractRadar(fs.readFileSync(f));
  if (process.argv.includes('--json')) { console.log(JSON.stringify(r)); return; }
  console.log(`${r.game_time_sec}с · тоглогч ${r.players.length} · kill ${r.kills.length} · цэг ${Object.values(r.paths).reduce((n, a) => n + a.length, 0)}`);
  for (const p of r.players) console.log(`  pid ${p.pid} ${p.name || '?'} team${p.team} colour${p.colour} hero=${p.hero} (${p.hero_orders} тушаал, ${r.paths[p.pid].length} цэг)`);
}
