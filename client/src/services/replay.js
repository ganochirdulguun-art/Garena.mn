const chokidar = require('chokidar');
const path = require('path');
const os = require('os');
const fs = require('fs');
const W3GReplay = require('w3gjs');
const apiService = require('./api');

let watcher = null;
let currentRoomId = null;
let resultCallback = null;
let roomMembers = []; // [{id, name}] — өрөөний гишүүд (user_id + username)
let processedReplays = new Set(); // аль хэдийн parse хийсэн файлуудыг давтахгүй
const extraReplayDirs = new Set();  // 1.26a: <WC3>\replay (game:launch үед нэмэгдэнэ)

// WC3 1.26a replay хавтас нэмэх (Documents биш, тоглоомын хавтас дотор).
// Watcher аль хэдийн ажиллаж байвал хавтсыг нэмнэ; өрөөнд байгаа ч watcher эхлээгүй
// (Documents хавтас байхгүй байсан) бол одоо эхлүүлнэ.
function addReplayDir(dir) {
  if (!dir || extraReplayDirs.has(dir)) return;
  extraReplayDirs.add(dir);
  console.log(`[Replay] хавтас нэмэгдлээ: ${dir}`);
  if (watcher) {
    try { watcher.add(toGlob(dir)); } catch {}
  } else if (currentRoomId) {
    startWatcher(currentRoomId);
  }
}

function toGlob(dir) {
  return `${String(dir).replace(/\\/g, '/')}/**/*.w3g`;
}

// WC3 replays хавтас автоматаар олох (Documents — 1.27+; 1.26a нь <WC3>\replay ашиглана)
function getReplayPath() {
  if (process.env.WC3_REPLAYS_PATH) return process.env.WC3_REPLAYS_PATH;
  return path.join(os.homedir(), 'Documents', 'Warcraft III', 'Replays');
}

function candidateDirs() {
  const dirs = [
    getReplayPath(),
    ...extraReplayDirs,
    'C:/Program Files (x86)/Warcraft 3/replay',
    'C:/Program Files (x86)/Warcraft III/replay',
    'C:/Warcraft III/replay',
    'C:/Warcraft 3/replay',
  ];
  return [...new Set(dirs.filter(Boolean).map((d) => String(d)))];
}

// Өрөөний гишүүдийг тохируулах (player matching-д ашиглана)
function setMembers(members) {
  roomMembers = (members || []).map(m => ({
    id: m.id !== undefined ? String(m.id) : null,
    name: m.name !== undefined ? m.name : String(m),
  }));
  console.log(`[Replay] Өрөөний гишүүд шинэчлэгдлээ: ${roomMembers.map(m => m.name).join(', ')}`);
}

// Replay тоглогчийн нэрийг platform user-тай тааруулах
function matchPlayerToMember(playerName) {
  if (!roomMembers.length) return null;
  const pLower = String(playerName || '').toLowerCase().trim();
  if (!pLower) return null;

  // 1. Яг таарч байвал
  const exact = roomMembers.find(m => String(m.name || '').toLowerCase() === pLower);
  if (exact) return exact;

  // 2. Нэг нь нөгөөгөө агуулж байвал (WC3 нэр ≠ platform нэр байж болно)
  const partial = roomMembers.find(m => {
    const n = String(m.name || '').toLowerCase();
    return n.length >= 3 && (pLower.includes(n) || n.includes(pLower));
  });
  if (partial) return partial;

  return null;
}

// Replay watcher эхлүүлэх
function startWatcher(roomId) {
  stopWatcher(true);
  currentRoomId = roomId;
  processedReplays.clear();

  // Байгаа хавтсуудыг л хянана. Documents\Warcraft III\Replays 1.26a-д байдаггүй тул
  // ганц хавтас шалгаад буцдаг байсан — тэгвэл 1.26a тоглогчдын replay хэзээ ч уншигддаггүй байсан.
  const dirs = candidateDirs().filter((d) => { try { return fs.existsSync(d); } catch { return false; } });
  if (!dirs.length) {
    console.warn(`[Replay] Replay хавтас олдсонгүй (${getReplayPath()} …) — WC3 нээгдэхэд <WC3>\\replay нэмэгдэнэ`);
    return;
  }
  console.log(`[Replay] Хавтас хянаж байна: ${dirs.join(' | ')}`);

  watcher = chokidar.watch(dirs.map(toGlob), {
    ignoreInitial: true,
    awaitWriteFinish: {
      stabilityThreshold: 3000,
      pollInterval: 500,
    },
  });

  watcher.on('add', async (filePath) => {
    // Давтагдсан файл шалгах
    const normalized = path.resolve(filePath);
    if (processedReplays.has(normalized)) return;
    processedReplays.add(normalized);

    console.log(`[Replay] Шинэ replay олдлоо: ${filePath}`);
    await parseReplay(filePath);
  });

  watcher.on('error', (err) => {
    console.error('[Replay] Watcher алдаа:', err);
  });
}

// W3G LeaveGame блок (0x17): reason/result хослолоор хожил/хожигдол тодорхойлно (w3g_format.txt).
//   reason 0x01 (remote): result 0x07 left, 0x08 lost, 0x09 won, 0x0A draw
//   reason 0x0C (local):  result 0x07 lost, 0x08 won, 0x09 draw, 0x0B left
function leaveOutcome(block) {
  const reason = Number(block.reason);
  const result = Number(block.result);
  if (reason === 0x01) {
    if (result === 0x08) return 'lost';
    if (result === 0x09) return 'won';
    if (result === 0x0A) return 'draw';
    return 'left';
  }
  if (reason === 0x0C || reason === 0x0E) {
    if (result === 0x07) return 'lost';
    if (result === 0x08) return 'won';
    if (result === 0x09) return 'draw';
    return 'left';
  }
  return 'left';
}

// Replay файл parse хийх
async function parseReplay(filePath) {
  try {
    const parser = new W3GReplay();
    // LeaveGame блокуудыг цуглуулна (w3gjs 2.x 'gamedatablock' event; байхгүй бол алгасна)
    const leaves = [];
    let elapsedMs = 0;
    try {
      parser.on('gamedatablock', (block) => {
        if (block && block.id === 0x1f) elapsedMs += Number(block.timeIncrement || 0);
        if (block && block.id === 0x17) leaves.push({ playerId: Number(block.playerId), outcome: leaveOutcome(block), at: elapsedMs });
      });
    } catch {}
    const replay = await parser.parse(filePath);

    const durationMs = Number(replay.duration || 0);
    const duration = Math.round(durationMs / 60000);
    const rawPlayers = (replay.players || []).filter((p) => p && p.name);
    const leaveById = new Map(leaves.map((l) => [l.playerId, l]));

    const players = rawPlayers.map((p) => {
      const matched = matchPlayerToMember(p.name);
      const lv = leaveById.get(Number(p.id));
      const leftAtSec = lv ? Math.round(lv.at / 1000) : null;
      return {
        name: p.name,
        // w3gjs teamid 0-based (0 = Sentinel/баг 1, 1 = Scourge/баг 2) → сервер 1|2 шаарддаг
        team: Number(p.teamid) + 1,
        race: p.race || null,
        apm: p.apm || 0,
        user_id: matched ? Number(matched.id) : null,
        discord_id: null,
        left_at_sec: leftAtSec,
        // 10 минутаас өмнө (тоглолт дуусахаас 1+ мин өмнө) гарсан = leaver; сервер дахин шалгана
        is_leaver: !!(lv && lv.outcome === 'left' && leftAtSec != null && leftAtSec < 600 && leftAtSec < durationMs / 1000 - 60),
      };
    });

    // Хожсон багийг тодорхойлох
    const winnerTeam = getWinnerTeam(rawPlayers, leaves);
    if (winnerTeam === null) {
      console.warn('[Replay] Хожсон баг тодорхойлж чадсангүй, үр дүн илгээхгүй');
      if (resultCallback) resultCallback({ error: 'Хожсон баг тодорхойлж чадсангүй', players });
      return;
    }

    const matchedCount = players.filter(p => p.user_id).length;
    console.log(`[Replay] ${players.length} тоглогчдоос ${matchedCount} тааруулсан`);

    const result = {
      room_id: currentRoomId,
      winner_team: winnerTeam,
      duration_minutes: duration,
      replay_path: filePath,
      players,
    };

    console.log('[Replay] Тоглоомын үр дүн:', JSON.stringify(result, null, 2));

    // Серверт илгээх
    try {
      const serverRes = await apiService.postGameResult(result);
      console.log('[Replay] Серверт амжилттай илгээлээ:', serverRes?.message);
      result.saved = true;
      result.duplicate = !!serverRes?.duplicate;
    } catch (err) {
      console.error('[Replay] Серверт илгээх алдаа:', err.response?.data?.error || err.message);
      result.saved = false;
      result.saveError = err.response?.data?.error || err.message;
    }

    // Renderer-т мэдэгдэх
    if (resultCallback) resultCallback(result);
  } catch (err) {
    console.error('[Replay] Parse алдаа:', err.message);
  }
}

// Хожсон багийг (1 | 2) тодорхойлох
function getWinnerTeam(players, leaves) {
  const teamOf = (p) => Number(p.teamid) + 1;
  const byId = new Map(players.map((p) => [Number(p.id), p]));

  // 1. w3gjs-ийн хувилбараас хамаарч `won` талбар байж болно
  const winner = players.find(p => p.won === true);
  if (winner) return teamOf(winner);

  // 2. LeaveGame блок: "won"/"lost" дүнтэй тоглогч
  for (const l of leaves || []) {
    const p = byId.get(l.playerId);
    if (!p) continue;
    if (l.outcome === 'won') return teamOf(p);
    if (l.outcome === 'lost') return teamOf(p) === 1 ? 2 : 1;
  }

  // 3. Хуучин бүтэц: p.leaving.reason === 'lost'
  const losers = players.filter(p => p.leaving?.reason === 'lost');
  if (losers.length > 0) {
    const teamCount = {};
    for (const p of losers) teamCount[teamOf(p)] = (teamCount[teamOf(p)] || 0) + 1;
    const losingTeam = Number(Object.entries(teamCount).sort((a, b) => b[1] - a[1])[0][0]);
    return losingTeam === 1 ? 2 : 1;
  }

  // 4. Сүүлчийн арга: нэг баг бүхэлдээ тоглолт дуусахаас өмнө гарсан бол нөгөө нь ялагч
  if (leaves && leaves.length && players.length >= 2) {
    const lastLeave = Math.max(...leaves.map((l) => l.at));
    const leftEarly = new Set(leaves.filter((l) => l.at < lastLeave - 30000).map((l) => l.playerId));
    const teams = [1, 2].map((t) => players.filter((p) => teamOf(p) === t));
    if (teams[0].length && teams[0].every((p) => leftEarly.has(Number(p.id))) && !teams[1].every((p) => leftEarly.has(Number(p.id)))) return 2;
    if (teams[1].length && teams[1].every((p) => leftEarly.has(Number(p.id))) && !teams[0].every((p) => leftEarly.has(Number(p.id)))) return 1;
  }

  return null;
}

// Replay watcher зогсоох (keepRoom=true → дараагийн startWatcher-т зориулж currentRoomId хадгална)
function stopWatcher(keepRoom = false) {
  if (watcher) {
    watcher.close();
    watcher = null;
    console.log('[Replay] Watcher зогслоо');
  }
  if (!keepRoom) {
    currentRoomId = null;
    roomMembers = [];
  }
}

// Үр дүн гарахад дуудагдах callback тохируулах
function onResult(cb) {
  resultCallback = cb;
}

module.exports = { startWatcher, stopWatcher, onResult, setMembers, addReplayDir, getWinnerTeam, leaveOutcome };
