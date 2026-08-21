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

// WC3 1.26a replay хавтас нэмэх (Documents биш, тоглоомын хавтас дотор)
function addReplayDir(dir) {
  if (dir && !extraReplayDirs.has(dir)) {
    extraReplayDirs.add(dir);
    console.log(`[Replay] хавтас нэмэгдлээ: ${dir}`);
    if (watcher) { try { watcher.add(`${dir.replace(/\\/g, '/')}/**/*.w3g`); } catch {} }
  }
}

// WC3 replays хавтас автоматаар олох
function getReplayPath() {
  if (process.env.WC3_REPLAYS_PATH) return process.env.WC3_REPLAYS_PATH;

  const username = os.userInfo().username;
  return path.join(
    'C:\\Users',
    username,
    'Documents',
    'Warcraft III',
    'Replays'
  );
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
  const pLower = playerName.toLowerCase().trim();

  // 1. Яг таарч байвал
  const exact = roomMembers.find(m => m.name.toLowerCase() === pLower);
  if (exact) return exact;

  // 2. Нэг нь нөгөөгөө агуулж байвал (WC3 нэр ≠ platform нэр байж болно)
  const partial = roomMembers.find(m =>
    pLower.includes(m.name.toLowerCase()) || m.name.toLowerCase().includes(pLower)
  );
  if (partial) return partial;

  return null;
}

// Replay watcher эхлүүлэх
function startWatcher(roomId) {
  stopWatcher();
  currentRoomId = roomId;
  processedReplays.clear();

  const replayDir = getReplayPath();

  // Хавтас байгаа эсэхийг шалгах
  if (!fs.existsSync(replayDir)) {
    console.warn(`[Replay] Хавтас олдсонгүй: ${replayDir}`);
    return;
  }

  console.log(`[Replay] Хавтас хянаж байна: ${replayDir}`);

  const dirs = [replayDir, ...extraReplayDirs, 'C:/Program Files (x86)/Warcraft 3/replay', 'C:/Program Files (x86)/Warcraft III/replay', 'C:/Warcraft III/replay'];
  const globs = [...new Set(dirs.filter(Boolean).map((d) => `${String(d).replace(/\\/g, '/')}/**/*.w3g`))];
  watcher = chokidar.watch(globs, {
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

// Replay файл parse хийх
async function parseReplay(filePath) {
  try {
    const parser = new W3GReplay();
    const replay = await parser.parse(filePath);

    const duration = Math.round(replay.duration / 60000);
    const players = replay.players.map((p) => {
      const matched = matchPlayerToMember(p.name);
      return {
        name: p.name,
        team: p.teamid,
        race: p.race || null,
        apm: p.apm || 0,
        user_id: matched ? Number(matched.id) : null,
        discord_id: null,
      };
    });

    // Хожсон багийг тодорхойлох
    const winnerTeam = getWinnerTeam(replay);
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

// Хожсон багийг тодорхойлох
function getWinnerTeam(replay) {
  const players = replay.players || [];

  // 1. w3gjs winner талбар шууд байвал ашиглах
  const winner = players.find(p => p.won === true);
  if (winner) return winner.teamid;

  // 2. 'lost' шалтгаанаар гарсан тоглогчдыг олох
  const losers = players.filter(p =>
    p.leaving?.reason === 'lost' ||
    p.leaving?.reason === 'disconnected'
  );
  if (losers.length > 0) {
    // Хамгийн олон тоглогч гарсан баг хожигдсон
    const teamCount = {};
    for (const p of losers) {
      teamCount[p.teamid] = (teamCount[p.teamid] || 0) + 1;
    }
    const losingTeam = Object.entries(teamCount)
      .sort((a, b) => b[1] - a[1])[0][0];
    return Number(losingTeam) === 1 ? 2 : 1;
  }

  // 3. Default — тодорхойлж чадахгүй үед null буцаах
  return null;
}

// Replay watcher зогсоох
function stopWatcher() {
  if (watcher) {
    watcher.close();
    watcher = null;
    currentRoomId = null;
    roomMembers = [];
    console.log('[Replay] Watcher зогслоо');
  }
}

// Үр дүн гарахад дуудагдах callback тохируулах
function onResult(cb) {
  resultCallback = cb;
}

module.exports = { startWatcher, stopWatcher, onResult, setMembers, addReplayDir };
