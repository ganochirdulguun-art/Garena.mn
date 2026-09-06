// ── Relay capture → тоглолтын дүн (Алхам 3, 2026-09-02) ──
// DATACOM relay нь тоглогч-хостын WC3 тоглоомын урсгалыг бичиж (capture), дуусмагц hostbot/reportGame.js
// w3gsStats-аар задлаад энд POST хийнэ. Бот-хост ч, клиентийн replay ч ХЭРЭГГҮЙ: сервер өөрөө тоглогч
// бүрийн K/D/A/creep/denie/neutral/gold/hero/item/ward, ялагч, сүлжээний тайланг (хэн гацаасан/унасан) авна.
// Эзний дүрэм: 💎 зөвхөн RANKED өрөөний ХҮЧИНТЭЙ тоглолт (≥3v3, ≥12 мин, ялагч мэдэгдсэн); энгийн өрөө XP л.
const express = require('express');
const crypto = require('crypto');
const { recordGameResult } = require('../services/results');
const playtime = require('../services/playtime');
const lanhost = require('./lanhost');

let db;
try { db = require('../config/db'); } catch { db = null; }

const REPORT_KEY = process.env.RELAY_REPORT_KEY || '';
const RANKED = {
  MIN_GAME_SEC: 12 * 60,   // skill pick 2–5 мин + 10 мин -ff хүртэл
  MIN_PER_TEAM: 3,         // 3v3-аас дээш; 1v1, 2v2 💎 үгүй
  MAX_PLAYERS: 10,
};

function keyOk(req) {
  const k = String(req.headers['x-relay-key'] || '');
  if (!REPORT_KEY || !k || k.length !== REPORT_KEY.length) return false;
  return crypto.timingSafeEqual(Buffer.from(k), Buffer.from(REPORT_KEY));
}

const norm = (s) => String(s || '').trim().toLowerCase();

// Ranked хүчинтэй эсэх — цэвэр функц (tests/relaystats.test.js)
function rankedValidity({ gameTimeSec, winnerTeam, players }) {
  if (![1, 2].includes(Number(winnerTeam))) return { valid: false, reason: 'no-winner' };
  if (Number(gameTimeSec || 0) < RANKED.MIN_GAME_SEC) return { valid: false, reason: 'too-short' };
  const t1 = players.filter((p) => p.team === 1 && p.user_id).length;
  const t2 = players.filter((p) => p.team === 2 && p.user_id).length;
  if (t1 < RANKED.MIN_PER_TEAM || t2 < RANKED.MIN_PER_TEAM) return { valid: false, reason: 'team-size' };
  if (players.length > RANKED.MAX_PLAYERS) return { valid: false, reason: 'too-many' };
  return { valid: true, reason: null };
}

// Relay-ийн тоглогчдыг платформын хэрэглэгчтэй холбоно: хост (token→host_user_id), joiner (lan_game_players
// WC3 нэр — v2.7.8 клиент бүртгүүлдэг). Таараагүй нэрийг recordGameResult users.wc3_name/username-ээр үзнэ.
function resolvePlayers(players, { hostUserId, hostWc3Name, joiners }) {
  const byName = new Map();
  for (const j of joiners || []) if (j.wc3_name) byName.set(norm(j.wc3_name), j.user_id);
  if (hostWc3Name && hostUserId) byName.set(norm(hostWc3Name), hostUserId);
  const used = new Set();
  return players.map((p) => {
    let uid = null;
    const n = norm(p.name);
    if (n && byName.has(n) && !used.has(String(byName.get(n)))) uid = byName.get(n);
    // Хост = pid 1 (тоглоом үүсгэгч) — нэр нь бүртгэлгүй бол хостын id-ээр
    if (!uid && p.pid === 1 && hostUserId && !used.has(String(hostUserId))) uid = hostUserId;
    if (uid) used.add(String(uid));
    return {
      user_id: uid || undefined, name: p.name || null, team: Number(p.team) === 1 ? 1 : 2,
      kills: p.kills, deaths: p.deaths, assists: p.assists, hero: p.hero || null,
      creep_kills: p.creepKills, creep_denies: p.creepDenies, neutral_kills: p.neutralKills, gold: p.gold, wards: p.wards,
      left_at_sec: p.left_at_sec ?? null,
    };
  });
}

function netReportOf(body) {
  return {
    game_time_sec: body.game_time_sec, dota_clock: body.dota_clock || null,
    lag: (body.lag || []).map((l) => ({ pid: l.pid, name: l.name, lag_screens: l.lagScreens, total_lag_sec: l.totalLagSec })),
    leaves: (body.leaves || []).map((l) => ({ pid: l.pid, name: l.name, at_sec: Math.round((l.atMs || 0) / 1000) })),
    bytes: body.bytes, bad_bytes: body.bad_bytes, started_at: body.started_at, ended_at: body.ended_at,
  };
}

const router = express.Router();

router.post('/game-stats', async (req, res) => {
  if (!keyOk(req)) return res.status(401).json({ error: 'relay key' });
  const b = req.body || {};
  const token = String(b.game_token || '').slice(0, 64);
  if (!token || !Array.isArray(b.players)) return res.status(400).json({ error: 'game_token/players дутуу' });
  const game = await lanhost.findGameByToken(token);
  if (!game) return res.status(404).json({ error: 'game_token олдсонгүй (өрөө?)' });
  const winnerTeam = [1, 2].includes(Number(b.winner_team)) ? Number(b.winner_team) : null;
  const net = netReportOf(b);
  console.log(`[Relay] дүн ирлээ token=${token.slice(0, 12)} room=${game.room_id} winner=${winnerTeam} ${b.game_time_sec}с lag=${JSON.stringify(net.lag)}`);
  let joiners = [];
  let ranked = false;
  if (db) {
    try {
      const jr = await db.query('SELECT user_id, wc3_name FROM lan_game_players WHERE token = $1', [token]);
      joiners = jr.rows;
      const rr = await db.query('SELECT ranked FROM rooms WHERE id = $1', [game.room_id]);
      ranked = !!rr.rows[0]?.ranked;
    } catch (e) { console.warn('[Relay] lookup:', e.message); }
  }
  const players = resolvePlayers(b.players.slice(0, 12), { hostUserId: game.host_user_id, hostWc3Name: game.host_wc3_name, joiners });
  // ⏱ Тоглосон цагийн урамшуулал (XP + 1ц=2💎) — ялагчтай эсэхээс ҮЛ ХАМААРАН, тоглогч бүрт (services/playtime.js);
  // давхардлыг play_awards UNIQUE(token,user_id) хаана. Дүнгийн бүртгэлээс тусдаа тул алдаа гарвал дүнд нөлөөлөхгүй.
  const playAwards = await awardPlaytimeForGame(token, game, players, b.game_time_sec, ranked);
  if (!winnerTeam) return res.status(202).json({ ok: false, reason: 'no-winner', room_id: game.room_id, playtime: playAwards });
  const validity = rankedValidity({ gameTimeSec: b.game_time_sec, winnerTeam, players });
  try {
    const saved = await recordGameResult({
      roomId: game.room_id, winnerTeam, durationMinutes: Math.round(Number(b.game_time_sec || 0) / 60),
      players, source: 'relay', ranked, rankedValid: validity.valid, rankedReason: validity.reason, netReport: net,
    });
    console.log(`[Relay] ${saved.duplicate ? 'давхардал' : 'бүртгэв'} room=${game.room_id} ranked=${ranked} valid=${saved.ranked_valid} ${saved.reason || ''}`);
    return res.json({
      ok: true, recorded: !saved.duplicate, duplicate: !!saved.duplicate, result_id: saved.result?.id,
      ranked, ranked_valid: saved.ranked_valid, reason: saved.reason,
      players: (saved.players || []).map((p) => ({ user_id: p.user_id, name: p.wc3_name, is_winner: p.is_winner, xp: p.xp_earned, diamonds: p.diamonds_earned })),
    });
  } catch (e) {
    console.error('[Relay] бүртгэл алдаа:', e.message);
    return res.status(500).json({ error: e.message });
  }
});

// Тоглогч бүрт тоглосон цагийн XP/💎 олгоод socket-оор задаргааг нь мэдэгдэнэ (playtime:award)
async function awardPlaytimeForGame(token, game, players, gameTimeSec, ranked) {
  if (!db) return [];
  const out = [];
  let notifyUser = null;
  try { ({ notifyUser } = require('./membership')); } catch {}
  for (const p of players) {
    if (!p.user_id) continue;
    try {
      const a = await playtime.awardPlaytime(db, { userId: p.user_id, token, gameSeconds: gameTimeSec, leftAtSec: p.left_at_sec, ranked: !!ranked, roomId: game.room_id ?? null });
      if (a.skipped) continue;
      out.push({ user_id: p.user_id, counted_sec: a.counted_sec, xp: a.xp, diamonds: a.diamonds });
      if (notifyUser) notifyUser(p.user_id, 'playtime:award', { ...a, room_id: game.room_id ?? null });
    } catch (e) { console.warn(`[Relay] playtime user=${p.user_id}:`, e.message); }
  }
  if (out.length) console.log(`[Relay] ⏱ цагийн урамшуулал token=${token.slice(0, 12)}: ` + out.map((o) => `u${o.user_id} ${Math.round(o.counted_sec / 60)}м +${o.xp}xp${o.diamonds ? ' +' + o.diamonds + '💎' : ''}`).join(', '));
  return out;
}

module.exports = router;
module.exports.rankedValidity = rankedValidity;
module.exports.resolvePlayers = resolvePlayers;
module.exports.RANKED = RANKED;
