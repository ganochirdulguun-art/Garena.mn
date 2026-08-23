// ── Бот хостын ops: мониторинг (B4) + үйл явдлын лог (C2) ──────────────────────
// Ботууд 20 сек тутамд /bot/heartbeat илгээдэг; 90 сек чимээгүй бол offline гэж үзнэ.
// Offline/online шилжилт, ажил failed/cancelled болох бүрт Discord webhook (env OPS_DISCORD_WEBHOOK)
// руу мэдэгдэл явуулж, сүүлийн 300 үйл явдлыг санах ойд хадгална (админ самбар харуулна).
const axios = require('axios');

const STALE_MS = 90 * 1000;
const CHECK_MS = 30 * 1000;
const MAX_EVENTS = 300;
const WEBHOOK = String(process.env.OPS_DISCORD_WEBHOOK || '').trim();

const events = [];                 // [{ at, level, kind, text, bot?, job_id? }]
const alerted = new Map();         // bot name -> true while offline alert is active
let lastWebhookAt = 0;
let webhookFails = 0;

function record(level, kind, text, extra = {}) {
  const ev = { at: new Date().toISOString(), level, kind, text, ...extra };
  events.unshift(ev);
  if (events.length > MAX_EVENTS) events.length = MAX_EVENTS;
  console.log(`[BotOps] ${level.toUpperCase()} ${kind}: ${text}`);
  return ev;
}

async function notify(text) {
  if (!WEBHOOK) return false;
  // Discord webhook: 1 мсж/сек-ээс илүү явуулахгүй (rate limit), 5 удаа дараалан унавал 10 мин амрана
  const now = Date.now();
  if (webhookFails >= 5 && now - lastWebhookAt < 10 * 60 * 1000) return false;
  lastWebhookAt = now;
  try {
    await axios.post(WEBHOOK, { content: String(text).slice(0, 1900), username: 'Garena.mn ops' }, { timeout: 8000 });
    webhookFails = 0;
    return true;
  } catch (e) {
    webhookFails += 1;
    console.warn('[BotOps] Discord webhook алдаа:', e.message);
    return false;
  }
}

// level: info | warn | error — warn/error нь Discord руу очно
async function alert(level, kind, text, extra) {
  record(level, kind, text, extra);
  if (level !== 'info') await notify(`${level === 'error' ? '🔴' : '⚠️'} ${text}`);
}

// routes/bot.js-ийн bots Map-ыг (name -> {last_seen, games, max_games, version}) хянана
function start(getBots) {
  const tick = async () => {
    const now = Date.now();
    for (const [name, b] of getBots()) {
      const offline = now - b.last_seen > STALE_MS;
      if (offline && !alerted.get(name)) {
        alerted.set(name, true);
        await alert('error', 'bot_offline', `Бот "${name}" OFFLINE — сүүлийн heartbeat ${Math.round((now - b.last_seen) / 1000)} сек өмнө (v${b.version || '?'}, ${b.games}/${b.max_games} тоглолт)`, { bot: name });
      } else if (!offline && alerted.get(name)) {
        alerted.set(name, false);
        record('info', 'bot_online', `Бот "${name}" дахин ONLINE`, { bot: name });
        await notify(`🟢 Бот "${name}" дахин ONLINE`);
      }
    }
  };
  setInterval(tick, CHECK_MS).unref?.();
  if (WEBHOOK) console.log('[BotOps] Discord мэдэгдэл идэвхтэй');
  else console.log('[BotOps] OPS_DISCORD_WEBHOOK тохируулаагүй — зөвхөн админ самбарын лог');
}

function recentEvents(limit = 100) { return events.slice(0, limit); }
function configured() { return !!WEBHOOK; }

module.exports = { start, alert, record, notify, recentEvents, configured, STALE_MS };
