#!/usr/bin/env node
/**
 * 📡 Радар LIVE daemon (2026-09-06) — relay-ийн ургаж буй capture файлуудыг ТУСДАА процессоор уншиж,
 * 5 с тутамд delta-г платформ сервер рүү POST /relay/radar/live илгээнэ. Сервер өөрөө саатлыг (эзэн 0 с,
 * бусад 120 с) хэрэгжүүлнэ — энд ямар ч саатал байхгүй, зөвхөн "юу болж байна"-г дамжуулна.
 *
 * ЗАРЧИМ (гацалтгүй): relay.js процесс, socket, LAN замд ОГТ хүрэхгүй — зөвхөн диск дээрх файлыг read-only
 * уншина; systemd Nice=15 (relay-ээс доогуур эрэмбэ). Файл бүрийг offset-оос цааш л уншина (O(шинэ байт)).
 * Идэвхтэй файл = сүүлийн ACTIVE_MS дотор өөрчлөгдсөн .w3gs; дууссан = .meta.json гарсан ЭСВЭЛ END_IDLE_MS зогссон
 * (meta.json заримдаа гардаггүй — relay restart).
 * Env: RELAY_CAPTURE_DIR, RELAY_REPORT_URL, RELAY_REPORT_KEY (report.env + capture.conf-той ижил).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { createRadarStream } = require('./radarExtract');

const CAP_DIR = process.env.RELAY_CAPTURE_DIR || '/opt/hostbot/captures';
const URL_BASE = String(process.env.RELAY_REPORT_URL || '').replace(/\/$/, '');
const KEY = process.env.RELAY_REPORT_KEY || '';
const TICK_MS = Number(process.env.RADAR_LIVE_TICK_MS || 5000);
const ACTIVE_MS = Number(process.env.RADAR_LIVE_ACTIVE_MS || 90 * 1000);
const END_IDLE_MS = Number(process.env.RADAR_LIVE_END_IDLE_MS || 150 * 1000);
const MIN_BYTES = 8 * 1024;          // lobby-гийн хэдэн байт — тоглоом эхлээгүй
const log = (m) => console.log(`${new Date().toISOString()} ${m}`);

const games = new Map();   // file → { token, startedAt, offset, stream, lastSentT, full, fails }
const done = new Map();    // file → хаасан цаг — дууссан файлыг (mtime шинэхэн ч) дахин нээхгүй (1 цаг санана)

function tokenOf(file) { const b = path.basename(file, '.w3gs'); const i = b.lastIndexOf('-'); return { token: i > 0 ? b.slice(0, i) : b, startedAt: i > 0 ? Number(b.slice(i + 1)) || null : null }; }

function readNew(file, g) {
  const st = fs.statSync(file);
  if (st.size <= g.offset) return 0;
  const fd = fs.openSync(file, 'r');
  try {
    const len = st.size - g.offset; const buf = Buffer.allocUnsafe(len);
    let got = 0; while (got < len) { const n = fs.readSync(fd, buf, got, len - got, g.offset + got); if (n <= 0) break; got += n; }
    g.offset += got; g.stream.feed(got === len ? buf : buf.subarray(0, got));
    return got;
  } finally { fs.closeSync(fd); }
}

async function post(body) {
  if (!URL_BASE) return { status: 0, text: 'RELAY_REPORT_URL алга' };
  try {
    const res = await fetch(`${URL_BASE}/relay/radar/live`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-key': KEY }, body: JSON.stringify(body) });
    return { status: res.status, text: await res.text() };
  } catch (e) { return { status: 0, text: e.message }; }
}

async function send(g, ended) {
  const since = g.full ? -1 : g.lastSentT;
  const snap = g.stream.snapshot(since);
  const body = { game_token: g.token, started_at: g.startedAt, from_ms: g.full ? 0 : g.lastSentT, ended: !!ended, ...snap };
  const pts = Object.values(snap.paths).reduce((n, a) => n + a.length, 0);
  const r = await post(body);
  if (r.status === 409) { g.full = true; g.fails = 0; log(`${g.token.slice(0, 8)} сервер бүтнээр хүсэв → дараагийн tick-д бүтэн`); return; }
  if (r.status !== 200) { g.fails++; if (g.fails <= 3 || g.fails % 12 === 0) log(`${g.token.slice(0, 8)} POST ${r.status} ${String(r.text).slice(0, 120)} (fail ${g.fails})`); return; }
  g.full = false; g.fails = 0; g.lastSentT = snap.game_time_ms;
  if (pts || ended) log(`${g.token.slice(0, 8)} t=${snap.game_time_sec}с тоглогч=${snap.players.length} +цэг=${pts} +kill=${snap.kills.length}${ended ? ' ДУУСАВ' : ''}`);
}

let busy = false;
async function tick() {
  if (busy) return; busy = true;
  try {
    const now = Date.now();
    let files = [];
    try { files = fs.readdirSync(CAP_DIR).filter((f) => f.endsWith('.w3gs')).map((f) => path.join(CAP_DIR, f)); } catch (e) { log('readdir: ' + e.message); return; }
    for (const file of files) {
      let st; try { st = fs.statSync(file); } catch { continue; }
      if (done.has(file)) { if (now - done.get(file) > 3600e3) done.delete(file); continue; }
      let g = games.get(file);
      const fresh = now - st.mtimeMs < ACTIVE_MS;
      if (!g) {
        if (!fresh || st.size < MIN_BYTES) continue;
        if (fs.existsSync(file + '.meta.json')) { done.set(file, now); continue; }   // аль хэдийн дууссан (reportGame явсан)
        const { token, startedAt } = tokenOf(file);
        g = { token, startedAt: startedAt || Math.round(st.birthtimeMs || st.mtimeMs), offset: 0, stream: createRadarStream(), lastSentT: -1, full: true, fails: 0 };
        games.set(file, g); log(`${token.slice(0, 8)} шинэ capture (${st.size} байт)`);
      }
      try { readNew(file, g); } catch (e) { log(`${g.token.slice(0, 8)} унших: ${e.message}`); continue; }
      const ended = fs.existsSync(file + '.meta.json') || now - st.mtimeMs > END_IDLE_MS;
      if (g.stream.gameTimeMs > g.lastSentT || g.full || ended) await send(g, ended);
      if (ended) { games.delete(file); done.set(file, now); log(`${g.token.slice(0, 8)} хаав (t=${Math.round(g.stream.gameTimeMs / 1000)}с, ${g.offset} байт)`); }
    }
  } catch (e) { log('tick: ' + e.message); }
  finally { busy = false; }
}

log(`radarLive эхлэв dir=${CAP_DIR} url=${URL_BASE || '(алга)'} tick=${TICK_MS}мс`);
setInterval(tick, TICK_MS);
tick();
