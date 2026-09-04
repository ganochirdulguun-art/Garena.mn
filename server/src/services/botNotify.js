// GarenaSystem бот руу дохио (X-API-Key) — TIERBOT_STATS_URL-ийн base + path. Алдаа гарвал зөвхөн warn (fire-and-forget).
const axios = require('axios');
const { tierBotHelpers: h } = require('../routes/stats');

function botBase() {
  try {
    const u = h.tierBotSourceUrl(null);
    if (u) return u.replace(/\/api\/export\/ranking.*$/i, '');
  } catch { /* тохируулаагүй */ }
  return null;
}

async function notifyBot(path, payload, { timeout = 8000 } = {}) {
  const base = botBase();
  if (!base) return null;
  try {
    const { data } = await axios.post(`${base}${path}`, payload, { headers: h.tierBotHeaders(), timeout });
    return data;
  } catch (e) {
    console.warn(`[BotNotify] ${path}:`, e.message);
    return null;
  }
}

/** Discord-оор нэвтэрсэн/бүртгүүлсэн/холбосон → бот "Garena хэрэглэгч" role-ийг шууд олгоно. */
function notifyDiscordUser(discordId, username, event) {
  if (!discordId) return;
  notifyBot('/api/garena/role', { discord_id: String(discordId), username: String(username || ''), event: String(event || 'login') })
    .then((r) => { if (r && r.ok === false) console.warn('[BotNotify] role:', r.error || r); })
    .catch(() => {});
}

module.exports = { notifyBot, notifyDiscordUser, botBase };
