#!/usr/bin/env node
/**
 * Relay capture → платформ сервер (Алхам 3, 2026-09-02).
 * relay.js тоглоом дуусмагц энэ скриптийг ТУСДАА процессоор дуудна:
 *   node reportGame.js <capture.w3gs> [--dry]
 * 1) capture + <file>.meta.json (joiner нэрс, primary session) → w3gsStats.summarizeCapture
 * 2) payload: тоглогч бүрийн K/D/A/creep/denie/neutral/gold/hero/item/ward + ялагч + lag/унасан
 * 3) POST ${RELAY_REPORT_URL}/relay/game-stats (x-relay-key: RELAY_REPORT_KEY), 3 оролдлого
 * Лог: <file>.report.log. --dry эсвэл URL байхгүй бол payload-ыг л хэвлэнэ.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { summarizeCapture } = require('./w3gsStats');

const URL_BASE = String(process.env.RELAY_REPORT_URL || '').replace(/\/$/, '');
const KEY = process.env.RELAY_REPORT_KEY || '';

function buildPayload(file) {
  const buf = fs.readFileSync(file);
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(file + '.meta.json', 'utf8')); } catch {}
  const r = summarizeCapture(buf);
  const primaryName = (meta.joiners && meta.primarySid != null) ? meta.joiners[String(meta.primarySid)] || null : null;
  const leaveByPid = {};
  for (const l of r.leaves || []) if (leaveByPid[l.pid] == null) leaveByPid[l.pid] = Math.round((l.atMs || 0) / 1000);
  const players = r.stats.players.filter((p) => p.active).map((p) => ({
    colour: p.colour, dotaId: p.dotaId, pid: p.pid, isJoiner: !!p.isJoiner,
    // capture-д joiner-ийн өөрийн нэр байдаггүй → meta (REQJOIN) нэрээр нөхнө
    name: (p.isJoiner && !(r.names || {})[p.pid]) ? primaryName : (p.name || null),
    team: p.team === 'sentinel' ? 1 : 2,
    kills: p.kills, deaths: p.deaths, assists: p.assists,
    creepKills: p.creepKills, creepDenies: p.creepDenies, neutralKills: p.neutralKills, gold: p.gold,
    hero: p.hero, items: (p.items || []).filter(Boolean), wards: p.wards || 0, itemPurchases: p.itemPurchases || {},
    left_at_sec: p.pid != null && leaveByPid[p.pid] != null ? leaveByPid[p.pid] : null,
  }));
  const gameToken = meta.game || path.basename(file).split('-')[0];
  return {
    game_token: gameToken,
    winner: r.stats.winner || null,
    winner_team: r.stats.winner === 'sentinel' ? 1 : r.stats.winner === 'scourge' ? 2 : null,
    game_time_sec: r.gameTimeSec, dota_clock: { m: r.stats.meta.m ?? null, s: r.stats.meta.s ?? null },
    players,
    names: r.names, own_pid: r.ownPid, joiners: meta.joiners || {}, primary_sid: meta.primarySid ?? null,
    lag: r.lag, leaves: r.leaves, packets: r.packets, bytes: r.bytes, bad_bytes: r.badBytes,
    started_at: meta.startedAt || null, ended_at: meta.endedAt || null,
  };
}

async function post(payload) {
  const url = `${URL_BASE}/relay/game-stats`;
  const delays = [0, 5000, 20000];
  let last = null;
  for (let i = 0; i < delays.length; i++) {
    if (delays[i]) await new Promise((r) => setTimeout(r, delays[i]));
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-relay-key': KEY }, body: JSON.stringify(payload) });
      const text = await res.text();
      if (res.status < 500) return { status: res.status, text };
      last = { status: res.status, text };
    } catch (e) { last = { status: 0, text: e.message }; }
  }
  return last;
}

(async () => {
  const file = process.argv[2];
  const dry = process.argv.includes('--dry');
  if (!file) { console.error('Хэрэглээ: node reportGame.js <capture.w3gs> [--dry]'); process.exit(2); }
  const logf = file + '.report.log';
  const log = (m) => { const line = `${new Date().toISOString()} ${m}`; console.log(line); try { fs.appendFileSync(logf, line + '\n'); } catch {} };
  let payload;
  try { payload = buildPayload(file); } catch (e) { log('задлал алдаа: ' + e.message); process.exit(1); }
  log(`задлав: ${payload.players.length} тоглогч, winner=${payload.winner}, ${payload.game_time_sec}с, lag=${JSON.stringify(payload.lag)}`);
  if (dry || !URL_BASE) { console.log(JSON.stringify(payload, null, 2)); return; }
  const r = await post(payload);
  log(`POST ${URL_BASE}/relay/game-stats → ${r ? r.status : '?'} ${r ? String(r.text).slice(0, 300) : ''}`);
})();
