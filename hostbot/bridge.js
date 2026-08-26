#!/usr/bin/env node
/**
 * Garena.mn hostbot bridge — GHost++-ийг Garena.mn платформтой холбоно (RGC маягийн бот хост).
 *
 *  Платформ  ──(bot_jobs)──►  bridge.js  ──(ghost.cfg + spawn)──►  GHost++  ──(UDP GAMEINFO, sqlite stats)──►  bridge.js  ──► Платформ
 *
 *  1. 3 сек тутамд GET /bot/jobs/next — ажил авна (queued → hosting)
 *  2. Ажил бүрт тусдаа GHost++ процесс (autohost, өөр порт) асаана
 *  3. GHost++-ийн UDP 6112 GAMEINFO broadcast-ыг барьж POST /bot/jobs/:id/lobby (клиентүүд LAN-даа харна)
 *  4. Лог: "started loading" → POST started; "is over" / процесс дуусах → sqlite-ээс dotagames/dotaplayers уншиж POST result
 *
 *  Env: PLATFORM_URL, BOT_KEY, BOT_NAME, PUBLIC_IP, GHOST_DIR (ghost++ binary, ghost.cfg.template, mapcfgs/, maps/),
 *       GHOST_BIN (default ./ghost++), WAR3_PATH (War3Patch.mpq, War3x.mpq байх хавтас), BASE_PORT=6112, MAX_GAMES=2
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const dgram = require('dgram');
const Database = require('better-sqlite3');

const CFG = {
  PLATFORM_URL: (process.env.PLATFORM_URL || 'https://garenamn-production.up.railway.app').replace(/\/+$/, ''),
  BOT_KEY: process.env.BOT_KEY || '',
  BOT_NAME: process.env.BOT_NAME || 'garena-bot-1',
  PUBLIC_IP: process.env.PUBLIC_IP || '',
  ZT_HOST_IP: process.env.ZT_HOST_IP || '',   // ZeroTier IP (10.147.20.x) — тоглогчид үүгээр холбогдоно
  GHOST_DIR: path.resolve(process.env.GHOST_DIR || __dirname),
  GHOST_BIN: process.env.GHOST_BIN || './ghost++',
  WAR3_PATH: process.env.WAR3_PATH || '/opt/war3/',
  BASE_PORT: Number(process.env.BASE_PORT || 6112),
  MAX_GAMES: Number(process.env.MAX_GAMES || 2),
  POLL_MS: 3000,
  HEARTBEAT_MS: 20000,
  LOBBY_TIMEOUT_MS: 30 * 60 * 1000,
  START_PLAYERS: Number(process.env.START_PLAYERS || 10),
};
if (!CFG.BOT_KEY || !CFG.PUBLIC_IP) {
  console.error('BOT_KEY болон PUBLIC_IP env заавал хэрэгтэй');
  process.exit(1);
}

const jobs = new Map(); // jobId -> state
const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Нэг тоглоомын гэнэтийн алдаа БҮХ тоглоомыг унагахаас сэргийлнэ — процессыг амьд байлгана.
process.on('uncaughtException', (e) => log('⚠️ uncaughtException (үл тоомсорлов):', (e && e.stack) || e));
process.on('unhandledRejection', (e) => log('⚠️ unhandledRejection (үл тоомсорлов):', (e && e.stack) || e));

// GHost++ child-ыг SIGTERM → 5с дараа SIGKILL-ээр баталгаатай унтраана (зомби/порт гацахаас сэргийлнэ).
function killProc(proc) {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch {}
  setTimeout(() => { try { proc.kill('SIGKILL'); } catch {} }, 5000);
}

async function api(method, p, body, timeoutMs = 15000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(`${CFG.PLATFORM_URL}${p}`, {
      method,
      headers: { 'x-bot-key': CFG.BOT_KEY, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
  } finally { clearTimeout(timer); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${method} ${p} → HTTP ${res.status}: ${text.slice(0, 200)}`);
  return data;
}

// ── Порт хуваарилалт ─────────────────────────────────────
function allocPort() {
  const used = new Set([...jobs.values()].map((j) => j.port));
  for (let p = CFG.BASE_PORT; p < CFG.BASE_PORT + 50; p++) if (!used.has(p)) return p;
  throw new Error('порт дууссан');
}

// ── GHost++ асаах ─────────────────────────────────────────
function renderTemplate(job, port, files) {
  const tpl = fs.readFileSync(path.join(CFG.GHOST_DIR, 'ghost.cfg.template'), 'utf8');
  const mapCfg = `${job.map_key}.cfg`;
  if (!fs.existsSync(path.join(CFG.GHOST_DIR, 'mapcfgs', mapCfg))) throw new Error(`mapcfgs/${mapCfg} олдсонгүй`);
  return tpl
    .replace(/\{\{PORT\}\}/g, String(port))
    .replace(/\{\{RECONNECTPORT\}\}/g, String(6300 + (port - CFG.BASE_PORT)))
    .replace(/\{\{GAMENAME\}\}/g, job.game_name)
    .replace(/\{\{OWNER\}\}/g, job.owner_name || '')
    .replace(/\{\{MAPCFG\}\}/g, mapCfg)
    .replace(/\{\{DB\}\}/g, files.db)
    .replace(/\{\{LOG\}\}/g, files.log)
    .replace(/\{\{WAR3PATH\}\}/g, CFG.WAR3_PATH)
    .replace(/\{\{STARTPLAYERS\}\}/g, String(Math.min(CFG.START_PLAYERS, (job.map && job.map.players) || 10)));
}

async function startJob(job) {
  // WC3/GHost++ тоглоомын нэрийн дээд хязгаар = 31 тэмдэгт. autohost нь нэр дээр
  // " #<тоологч>" (4 хүртэл тэмдэгт) нэмдэг тул суурь нэрийг 27-д таслана, эс бөгөөс
  // GHost++ "next game name ... is too long" гэж autohost-ыг зогсооно.
  if (job.game_name && job.game_name.length > 27) {
    log(`[job ${job.id}] game name "${job.game_name}" хэт урт → 27 тэмдэгтэд таслав`);
    job.game_name = job.game_name.slice(0, 27).trim();
  }
  const port = allocPort();
  const runDir = path.join(CFG.GHOST_DIR, 'run');
  fs.mkdirSync(runDir, { recursive: true });
  const files = {
    cfg: path.join(runDir, `ghost-${job.id}.cfg`),
    db: path.join(runDir, `ghost-${job.id}.sqlite`),
    log: path.join(runDir, `ghost-${job.id}.log`),
  };
  for (const f of [files.db, files.log]) { try { fs.unlinkSync(f); } catch {} }
  fs.writeFileSync(files.cfg, renderTemplate(job, port, files));
  fs.writeFileSync(files.log, '');

  const proc = spawn(CFG.GHOST_BIN, [files.cfg], { cwd: CFG.GHOST_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { job, port, proc, files, lobbyPosted: false, started: false, finished: false, logPos: 0, createdAt: Date.now(), stdout: '' };
  jobs.set(job.id, state);
  log(`[job ${job.id}] GHost++ асаалаа — port ${port}, game "${job.game_name}", map ${job.map_key}`);

  proc.stdout.on('data', (d) => onLogChunk(state, d.toString()));
  proc.stderr.on('data', (d) => onLogChunk(state, d.toString()));
  proc.on('exit', (code) => {
    log(`[job ${job.id}] GHost++ дууслаа (code ${code})`);
    setTimeout(() => finalize(state, `process exit ${code}`), 1500);
  });
  proc.on('error', (e) => { log(`[job ${job.id}] spawn алдаа`, e.message); fail(state, `spawn: ${e.message}`); });
}

// GHost++ log (stdout + bot_log файл хоёулаа)
function onLogChunk(state, chunk) {
  state.stdout += chunk;
  if (state.stdout.length > 200000) state.stdout = state.stdout.slice(-100000);
  handleLogText(state, chunk);
}
function pollLogFile(state) {
  try {
    const st = fs.statSync(state.files.log);
    if (st.size > state.logPos) {
      const fd = fs.openSync(state.files.log, 'r');
      const buf = Buffer.alloc(st.size - state.logPos);
      fs.readSync(fd, buf, 0, buf.length, state.logPos);
      fs.closeSync(fd);
      state.logPos = st.size;
      handleLogText(state, buf.toString());
    }
  } catch {}
}
function handleLogText(state, text) {
  if (!state.started && /started loading with \d+ players/i.test(text)) {
    state.started = true;
    // GHost++ лог: "player [name|1.2.3.4] joined the game" — нэр ба нийтийн IP
    const players = [...text.matchAll(/\[GAME: [^\]]+\] player \[([^\]|]+)(?:\|([^\]]*))?\] joined the game/gi)].map((m) => ({ name: m[1], ip: m[2] || '' }));
    api('POST', `/bot/jobs/${state.job.id}/started`, { players }).catch((e) => log('started POST алдаа', e.message));
    log(`[job ${state.job.id}] тоглолт эхэллээ`);
  }
  if (state.started && !state.finished && /(is over|saving game data to database|deleting game)/i.test(text)) {
    setTimeout(() => finalize(state, 'log: game over'), 4000);   // sqlite бичиж дуусахыг хүлээнэ
  }
  if (!state.started && /(unable to load|map file .* doesn't exist|failed to load|error)/i.test(text) && /\[(MAP|CONFIG|GHOST)\]/.test(text)) {
    log(`[job ${state.job.id}] GHost++ алдаа:`, text.trim().slice(0, 300));
  }
}

// ── UDP: GHost++-ийн GAMEINFO broadcast барих (udp_broadcasttarget = 10.147.99.255, ZeroTier) ──
// ЧУХАЛ: WC3 зөвхөн ЭХ ПОРТ 6112-оос ирсэн GAMEINFO-г LAN жагсаалтад хүлээж авдаг. GHost нь ephemeral
// эх портоос broadcast хийдэг тул WC3 үл тоомсорлодог. Иймд энэ 6112-т bind хийсэн socket-оор ДАХИН
// broadcast хийж эх портыг 6112 болгоно → тоглоомчдын WC3 LAN-д харагдана.
const ZT_BC = (CFG.ZT_HOST_IP || '').replace(/\.\d+$/, '.255') || null;
const udp = dgram.createSocket({ type: 'udp4', reuseAddr: true });
udp.on('message', (msg, rinfo) => {
  if (msg.length < 24 || msg[0] !== 0xF7 || msg[1] !== 0x30) return;
  if (rinfo && rinfo.port === 6112) return;   // өөрийн дахин broadcast-ийн echo — алгасна (давталтаас сэргийлнэ)
  if (ZT_BC) { try { udp.send(msg, 0, msg.length, 6112, ZT_BC); } catch {} }   // эх порт 6112-оос дахин broadcast
  // F7 30 len(2) product(4) version(4) hostcounter(4) entrykey(4) gamename\0 ... port(2)
  const end = msg.indexOf(0, 20);
  if (end < 0) return;
  const gameName = msg.toString('latin1', 20, end);
  const port = msg.readUInt16LE(msg.length - 2);
  for (const state of jobs.values()) {
    if (state.finished || state.started) continue;
    // Порт = найдвартай түлхүүр. Нэрээр таарах нь 2 зэрэг тоглоомын хооронд андуурч болзошгүй тул хассан.
    if (state.port !== port) continue;
    const b64 = msg.toString('base64');
    // GAMEINFO-д секунд тутам өөрчлөгддөг uptime талбар бий → slot/тоглогчийн тоо өөрчлөгдсөн эсэхийг
    // пакетийн сүүлийн 24 байтаас (slots total/open, uptime, port) uptime-ыг хасч харьцуулна; 60с тутамд л дахин илгээнэ
    const sig = msg.subarray(0, msg.length - 24).toString('base64') + ':' + msg.subarray(msg.length - 24, msg.length - 8).toString('hex') + ':' + port;
    const now = Date.now();
    if (state.lobbyPosted && state.lastSig === sig && now - (state.lastPostAt || 0) < 60000) return;
    state.lastSig = sig;
    state.lastPostAt = now;
    state.lobbyPosted = true;
    // RGC маяг: нийтийн IP-ыг эхэнд илгээнэ → клиент GProxy тунел (public IP:port) ашиглана, ZeroTier шаардлагагүй.
    const hostIp = CFG.PUBLIC_IP || CFG.ZT_HOST_IP;
    api('POST', `/bot/jobs/${state.job.id}/lobby`, { host_ip: hostIp, host_port: state.port, gameinfo_b64: b64, game_name: gameName })
      .then(() => log(`[job ${state.job.id}] lobby мэдэгдлээ (${gameName} @ ${hostIp}:${state.port})`))
      .catch((e) => { state.lobbyPosted = false; log('lobby POST алдаа', e.message); });
    return;
  }
});
udp.on('error', (e) => {
  log('⚠️ UDP 6112 алдаа:', e.message);
  // bind амжилтгүй (EADDRINUSE) бол GAMEINFO хэзээ ч ирэхгүй → идэвхтэй тоглоом байхгүй үед
  // процессыг унтрааж systemd-ээр дахин асаана. Идэвхтэй тоглоомтой бол унагаахгүй.
  if (jobs.size === 0) { log('идэвхтэй тоглоом алга → restart-д гарч байна'); process.exit(1); }
});
udp.bind(6112, '0.0.0.0', () => { try { udp.setBroadcast(true); } catch {} log('UDP 6112 сонсож байна (GAMEINFO + эх порт 6112 re-broadcast)'); });

// ── Дүн: sqlite → платформ ───────────────────────────────
function readResult(state) {
  const db = new Database(state.files.db, { readonly: true });
  try {
    const game = db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT 1').get();
    if (!game) return null;
    const players = db.prepare('SELECT * FROM gameplayers WHERE gameid = ?').all(game.id);
    const dota = db.prepare('SELECT * FROM dotagames WHERE gameid = ?').get(game.id);
    const dotaPlayers = db.prepare('SELECT * FROM dotaplayers WHERE gameid = ?').all(game.id);
    // gameplayers.colour = WC3 slot colour (0 red … 4 yellow = Sentinel, 5 orange … 9 light blue = Scourge),
    // dotaplayers.colour = DotA-гийн тоглогчийн ID (1–5 Sentinel, 7–11 Scourge; 6/12 = багийн ID).
    // Хоёр дугаарлалт өөр тул шууд тааруулбал K/D/A нэгээр зөрнө → WC3 colour → DotA ID хөрвүүлнэ.
    const dotaIdOf = (c) => (c >= 0 && c <= 4 ? c + 1 : c >= 5 && c <= 9 ? c + 2 : c + 1);
    const byDotaId = new Map(dotaPlayers.map((p) => [Number(p.colour), p]));
    const teamOfDotaId = (id) => (id >= 1 && id <= 5 ? 1 : id >= 7 && id <= 11 ? 2 : 0);
    const durationSec = Number(game.duration || 0);
    const list = players.map((p) => {
      const colour = Number(p.colour);
      const dotaId = dotaIdOf(colour);
      const d = byDotaId.get(dotaId) || byDotaId.get(colour) || {};
      const team = teamOfDotaId(dotaId) || (Number(p.team) + 1);
      const leftAt = Number(p.left || 0);
      return {
        name: p.name, ip: String(p.ip || ''), team, kills: Number(d.kills || 0), deaths: Number(d.deaths || 0), assists: Number(d.assists || 0),
        hero: d.hero || null, left_at_sec: leftAt,
        is_leaver: leftAt > 0 && leftAt < durationSec - 60 && !/lost|won|finished|has left the game voluntarily/i.test(String(p.leftreason || '')) && leftAt < 10 * 60 ? true : false,
        leftreason: p.leftreason || '',
      };
    });
    let winner = Number(dota?.winner || 0);
    if (!winner) {
      // dota stats ирээгүй бол: "lost" гэж гарсан багийн эсрэг баг ялагч
      const lost = list.filter((p) => /lost/i.test(p.leftreason));
      if (lost.length) winner = lost[0].team === 1 ? 2 : 1;
    }
    return { winner_team: winner, duration_minutes: Math.round(durationSec / 60), players: list, gamename: game.gamename };
  } finally {
    db.close();
  }
}

async function finalize(state, why) {
  if (state.finished) return;
  state.finished = true;
  jobs.delete(state.job.id);
  killProc(state.proc);
  if (!state.started) {
    return fail(state, state.lobbyPosted ? `lobby дууссан (${why})` : `хостолж чадсангүй (${why}): ${state.stdout.slice(-400)}`);
  }
  let r;
  try {
    r = readResult(state);
  } catch (e) {
    log(`[job ${state.job.id}] sqlite унших алдаа`, e.message);
    return fail(state, `result унших: ${e.message}`);
  }
  if (!r || ![1, 2].includes(r.winner_team)) {
    return fail(state, `ялагч тодорхойгүй (${why})`);
  }
  // Дууссан тоглоомыг сүлжээний түр саатлаас болж "failed" болгохгүйн тулд 3 удаа дахин оролдоно.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await api('POST', `/bot/jobs/${state.job.id}/result`, r);
      log(`[job ${state.job.id}] дүн илгээгдлээ — winner team ${r.winner_team}, ${r.duration_minutes} мин, ${r.players.length} тоглогч`);
      return;
    } catch (e) {
      log(`[job ${state.job.id}] дүн илгээх оролдлого ${attempt}/3 бүтсэнгүй`, e.message);
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }
  await fail(state, 'дүн 3 удаа илгээж чадсангүй');
}
async function fail(state, error) {
  state.finished = true;
  jobs.delete(state.job.id);
  killProc(state.proc);
  try { await api('POST', `/bot/jobs/${state.job.id}/failed`, { error: String(error).slice(0, 500) }); } catch (e) { log('failed POST алдаа', e.message); }
  log(`[job ${state.job.id}] FAILED: ${error}`);
}

// ── Давталтууд ───────────────────────────────────────────
async function heartbeat() {
  try { await api('POST', '/bot/heartbeat', { bot: CFG.BOT_NAME, games: jobs.size, max_games: CFG.MAX_GAMES, version: 'bridge-1.0' }); }
  catch (e) { log('heartbeat алдаа', e.message); }
}
const MAX_GAME_MS = 4 * 60 * 60 * 1000;  // started тоглоом 4ц-аас удвал slot суллана (гацсан GHost)
async function poll() {
  for (const st of jobs.values()) {
    pollLogFile(st);
    if (!st.started && Date.now() - st.createdAt > CFG.LOBBY_TIMEOUT_MS) finalize(st, 'lobby timeout');
    else if (st.started && !st.finished && Date.now() - st.createdAt > MAX_GAME_MS) finalize(st, 'тоглоомын хугацаа хэтэрсэн (>4ц)');
  }
  if (jobs.size >= CFG.MAX_GAMES) return;
  try {
    const job = await api('GET', `/bot/jobs/next?bot=${encodeURIComponent(CFG.BOT_NAME)}`);
    if (job && job.id) {
      if (jobs.size >= CFG.MAX_GAMES) return;  // await-ийн дараа дахин шалгах (давхардсан poll хамгаалалт)
      try {
        await startJob(job);
      } catch (e) {
        // Job аль хэдийн "hosting" болсон тул алдвал заавал /failed илгээж, "hosting"-д гацахаас сэргийлнэ.
        log(`[job ${job.id}] startJob алдаа`, e.message);
        try { await api('POST', `/bot/jobs/${job.id}/failed`, { error: `startJob: ${String(e.message).slice(0, 300)}` }); } catch {}
      }
    }
  } catch (e) { log('poll алдаа', e.message); }
}
heartbeat();
setInterval(heartbeat, CFG.HEARTBEAT_MS);
setInterval(poll, CFG.POLL_MS);
log(`bridge эхэллээ — ${CFG.BOT_NAME} → ${CFG.PLATFORM_URL}, public ${CFG.PUBLIC_IP}, max ${CFG.MAX_GAMES} тоглолт`);
function shutdown() { for (const st of jobs.values()) { try { st.proc.kill('SIGTERM'); } catch {} } setTimeout(() => process.exit(0), 500); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);   // systemd stop нь SIGTERM илгээдэг — цэвэрхэн унтраана
