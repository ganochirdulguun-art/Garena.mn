// ══════════════════════════════════════════════════════════════
// «Хэрэглэгчдийн хүсэж буй тоглоомууд» (2026-10-01) — эрх эзэмшигчээс зөвшөөрөл хүсэж буй тоглоомуудад санал.
// Худал «удахгүй» амлахгүй: зөвхөн хэдэн хүн хүсэж байгааг цуглуулна (эрх эзэмшигчид илгээх нотолгоо).
//  • GET  /wishes        — { counts: {key: n}, mine: [key] }
//  • POST /wishes/:key   — санал өгөх/буцаах (toggle)
// ══════════════════════════════════════════════════════════════
const express = require('express');
const auth = require('../middleware/auth');

let db;
try { db = require('../config/db'); } catch { db = null; }
const router = express.Router();
const KEYS = ['umk3', 'ctr', 'goldeneye'];

async function dbOk() { if (!db) return false; try { await db.query('SELECT 1'); return true; } catch { return false; } }
async function ensureTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS game_wishes (
      user_id INTEGER NOT NULL,
      game_key VARCHAR(32) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (user_id, game_key)
    )`);
  } catch (e) { console.error('[Migration] game_wishes:', e.message); }
}

async function summary(userId) {
  const counts = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const c = await db.query('SELECT game_key, COUNT(*)::int AS n FROM game_wishes GROUP BY game_key');
  for (const r of c.rows) if (r.game_key in counts) counts[r.game_key] = Number(r.n) || 0;
  const m = await db.query('SELECT game_key FROM game_wishes WHERE user_id = $1', [userId]);
  return { counts, mine: m.rows.map((r) => r.game_key).filter((k) => KEYS.includes(k)) };
}

router.get('/', auth, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try { return res.json(await summary(req.user.id)); }
  catch (e) { console.error('[wishes] get', e.message); return res.status(500).json({ error: 'Server error' }); }
});

router.post('/:key', auth, async (req, res) => {
  const key = String(req.params.key || '');
  if (!KEYS.includes(key)) return res.status(404).json({ error: 'Тоглоом олдсонгүй' });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const del = await db.query('DELETE FROM game_wishes WHERE user_id = $1 AND game_key = $2', [req.user.id, key]);
    if (!del.rowCount) await db.query('INSERT INTO game_wishes (user_id, game_key) VALUES ($1, $2) ON CONFLICT DO NOTHING', [req.user.id, key]);
    return res.json({ ok: true, wished: !del.rowCount, ...(await summary(req.user.id)) });
  } catch (e) { console.error('[wishes] toggle', e.message); return res.status(500).json({ error: 'Server error' }); }
});

module.exports = { router, ensureTables, KEYS };
