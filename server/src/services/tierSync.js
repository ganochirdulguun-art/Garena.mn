// ── TierSystem → Garena.mn автомат tier/rating sync (D3) ────────────────────────
// Env: TIERBOT_STATS_URL = https://tiersystem-production.up.railway.app/api/export/ranking
//      TIERBOT_API_KEY   = TierSystem-ийн RANKING_API_KEY-тэй ижил (X-API-Key)
//      TIERBOT_SYNC_MINUTES (default 10; 0 = унтраах)
// Зөвхөн Discord ID-аар таарсан хэрэглэгчдийн tierbot_tier/rating/rank + wins/losses шинэчилнэ;
// шинэ хэрэглэгч үүсгэхгүй, username дарж бичихгүй (гараар /stats/tierbot/sync бол хуучин зан үйл хэвээр).
const axios = require('axios');
const { tierBotHelpers: h } = require('../routes/stats');

let db;
try { db = require('../config/db'); } catch { db = null; }

const state = { last_run: null, last_ok: null, last_error: null, last_stats: null, running: false };

async function runOnce(reason = 'timer') {
  if (state.running) return state;
  const url = (() => { try { return h.tierBotSourceUrl(null); } catch { return null; } })();
  if (!url || !db) return state;
  state.running = true;
  state.last_run = new Date().toISOString();
  try {
    await h.ensureTierBotColumns();
    const { data } = await axios.get(url, { headers: h.tierBotHeaders(), timeout: 20000, maxContentLength: 5 * 1024 * 1024 });
    const rows = h.extractTierBotRows(data);
    const stats = { rows: rows.length, updated: 0, skipped: 0 };
    for (const [index, row] of rows.entries()) {
      const player = h.normalizeTierBotPlayer(row, index);
      if (!player || !player.discord_id) { stats.skipped++; continue; }
      const outcome = await h.upsertTierBotPlayer(player, { updateOnly: true });
      stats[outcome === 'updated' ? 'updated' : 'skipped']++;
    }
    state.last_ok = new Date().toISOString();
    state.last_error = null;
    state.last_stats = stats;
    console.log(`[TierSync] ${reason}: ${stats.updated} шинэчлэгдэв, ${stats.skipped} алгассан (${rows.length} мөр)`);
  } catch (e) {
    state.last_error = e.message;
    console.warn('[TierSync] алдаа:', e.message);
  } finally {
    state.running = false;
  }
  return state;
}

function start() {
  const minutes = Number(process.env.TIERBOT_SYNC_MINUTES ?? 10);
  if (!process.env.TIERBOT_STATS_URL || !(minutes > 0)) { console.log('[TierSync] TIERBOT_STATS_URL тохируулаагүй — автомат sync унтраалттай'); return; }
  setTimeout(() => runOnce('startup'), 15000).unref?.();
  setInterval(() => runOnce('timer'), minutes * 60 * 1000).unref?.();
  console.log(`[TierSync] ${minutes} мин тутамд ${process.env.TIERBOT_STATS_URL}`);
}

module.exports = { start, runOnce, state };
