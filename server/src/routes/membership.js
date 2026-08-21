// ── Гишүүнчлэл (Bronze / Silver / Gold), нэрийн эффект, Diamond 💎, QPay захиалга + webhook ──
// Төлбөр: QPay (хэрэглэгчийн өөрийн "QPay Админ" dashboard) ЭСВЭЛ Diamond (Silver 800 💎, Gold 1500 💎).
// Env: QPAY_API_BASE, QPAY_API_KEY, QPAY_WEBHOOK_SECRET, SERVER_URL.
const express = require('express');
const authMW = require('../middleware/auth');
const qpay = require('../services/qpay');
const { levelProgress, RULES } = require('../services/progression');

let db;
try { db = require('../config/db'); } catch { db = null; }

const TIERS = {
  bronze: {
    key: 'bronze', name: 'Bronze', price: 0, diamonds: 0, friends: 50,
    nameEffects: false, gifAvatar: false, roomBackground: false,
    perks: ['Өрөө үүсгэх, өрөөнд нэгдэх', '50 найз хүртэл'],
  },
  silver: {
    key: 'silver', name: 'Silver', price: 20000, diamonds: 800, friends: 100,
    nameEffects: true, gifAvatar: false, roomBackground: false,
    perks: ['Хөдөлгөөнт neon аватарын хүрээ', 'Нэрийн эффект (neon / солонго) — өрөө, DM, нийтийн чат', '100 найз хүртэл'],
  },
  gold: {
    key: 'gold', name: 'Gold', price: 40000, diamonds: 1500, friends: 200,
    nameEffects: true, gifAvatar: true, roomBackground: true,
    perks: ['Хөдөлгөөнт GIF аватар', 'Алтан хүрээ + нэрийн эффект', 'Өөрийн өрөөний дэвсгэр зураг', '200 найз хүртэл'],
  },
};
const NAME_EFFECTS = ['solid', 'gradient', 'neon', 'rainbow', 'toon'];
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

async function dbOk() {
  if (!db) return false;
  try { await db.query('SELECT 1'); return true; } catch { return false; }
}

// Хугацаа дууссан гишүүнчлэл автоматаар Bronze болно
function effectiveTier(row) {
  const t = String(row?.membership || 'bronze').toLowerCase();
  if (!TIERS[t] || t === 'bronze') return 'bronze';
  const until = row?.membership_until ? new Date(row.membership_until).getTime() : 0;
  return until > Date.now() ? t : 'bronze';
}
function perksOf(tier) { return TIERS[tier] || TIERS.bronze; }
function publicFx(row) {
  const tier = effectiveTier(row);
  const fx = perksOf(tier).nameEffects ? String(row?.name_effect || 'solid') : 'solid';
  return { tier, name_effect: NAME_EFFECTS.includes(fx) ? fx : 'solid' };
}
async function getUserRow(userId, client = db) {
  const r = await client.query(
    'SELECT id, membership, membership_until, name_effect, diamonds, xp, level, block_games, block_wins FROM users WHERE id = $1',
    [userId]
  );
  return r.rows[0] || null;
}
async function tierOf(userId) {
  if (!await dbOk()) return 'bronze';
  try { return effectiveTier(await getUserRow(userId)); } catch { return 'bronze'; }
}
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
async function withTx(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// Гишүүнчлэл идэвхжүүлэх: ижил түвшин бол үлдсэн хугацаан дээр нэмнэ, өөр түвшин бол одооноос эхэлнэ
async function activateMembership(client, userId, tier, months) {
  const cur = await getUserRow(userId, client);
  const now = Date.now();
  const sameTier = cur && effectiveTier(cur) === tier;
  const base = sameTier && cur.membership_until ? Math.max(now, new Date(cur.membership_until).getTime()) : now;
  const until = new Date(base + months * MONTH_MS);
  await client.query('UPDATE users SET membership = $1, membership_until = $2 WHERE id = $3', [tier, until, userId]);
  return until;
}

async function findOrder(invoiceId) {
  const r = await db.query('SELECT * FROM payment_orders WHERE invoice_id = $1', [String(invoiceId)]);
  return r.rows[0] || null;
}

// Төлөгдсөн QPay захиалгыг биелүүлэх (idempotent)
async function settleOrder(order, via) {
  return withTx(async (client) => {
    const upd = await client.query(
      `UPDATE payment_orders SET status = 'PAID', paid_at = NOW() WHERE id = $1 AND status <> 'PAID' RETURNING *`,
      [order.id]
    );
    if (!upd.rows[0]) return false;
    const until = await activateMembership(client, order.user_id, order.tier, order.months || 1);
    console.log(`[QPay] order #${order.id} (${order.tier} ${order.months}сар, ${order.amount}₮) төлөгдлөө — ${via}; ${until.toISOString().slice(0, 10)} хүртэл`);
    return true;
  });
}

// Захиалгын төлөв — webhook алдагдсан ч poll хийхэд төлөгдсөн бол биелүүлнэ
async function orderStatus(req, res) {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const order = await findOrder(req.params.id);
  if (!order || String(order.user_id) !== String(req.user.id)) return res.status(404).json({ error: 'Захиалга олдсонгүй' });
  if (order.status === 'PAID') return res.json({ status: 'PAID', paid: true });
  if (order.status === 'CANCELLED') return res.json({ status: 'CANCELLED', paid: false });
  let st;
  try { st = await qpay.checkInvoice(order.invoice_id); } catch (e) {
    console.warn('[QPay] check алдаа:', e.message);
    return res.json({ status: order.status, paid: false });
  }
  if (st.paid) { await settleOrder(order, 'poll'); return res.json({ status: 'PAID', paid: true }); }
  if (st.status === 'CANCELLED') {
    await db.query(`UPDATE payment_orders SET status = 'CANCELLED' WHERE id = $1 AND status = 'OPEN'`, [order.id]);
  }
  return res.json({ status: st.status || 'OPEN', paid: false });
}

// ── /membership ───────────────────────────────────────────
const router = express.Router();

router.get('/plans', (_req, res) => {
  res.json({ tiers: TIERS, name_effects: NAME_EFFECTS, currency: '₮', period_days: 30, payments_enabled: qpay.configured(), diamond_rules: RULES });
});

router.get('/me', authMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const row = await getUserRow(req.user.id);
    if (!row) return res.status(404).json({ error: 'User not found' });
    const tier = effectiveTier(row);
    return res.json({
      tier, membership_until: row.membership_until, name_effect: publicFx(row).name_effect,
      perks: perksOf(tier), payments_enabled: qpay.configured(),
      diamonds: row.diamonds || 0, ...levelProgress(row.xp || 0), block_games: row.block_games || 0, block_wins: row.block_wins || 0,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/name-effect', authMW, async (req, res) => {
  const effect = String(req.body?.effect || 'solid');
  if (!NAME_EFFECTS.includes(effect)) return res.status(400).json({ error: 'Буруу эффект' });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const tier = effectiveTier(await getUserRow(req.user.id));
    if (effect !== 'solid' && !perksOf(tier).nameEffects) {
      return res.status(403).json({ error: 'Нэрийн эффект зөвхөн Silver / Gold гишүүдэд нээлттэй', code: 'TIER_REQUIRED' });
    }
    await db.query('UPDATE users SET name_effect = $1 WHERE id = $2', [effect, req.user.id]);
    return res.json({ ok: true, name_effect: effect, tier });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Бусдад харагдах мэдээлэл (түвшин + нэрийн эффект + level)
router.get('/public', async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 200);
  if (!ids.length || !await dbOk()) return res.json([]);
  try {
    const r = await db.query(
      'SELECT id, membership, membership_until, name_effect, level FROM users WHERE id = ANY($1::int[])',
      [ids]
    );
    return res.json(r.rows.map((row) => ({ id: row.id, level: row.level || 1, ...publicFx(row) })));
  } catch (e) {
    console.error(e);
    return res.json([]);
  }
});

// Гишүүнчлэл авах: { tier: 'silver'|'gold', months: 1..12, pay_with: 'qpay'|'diamonds' }
router.post('/order', authMW, async (req, res) => {
  const tier = String(req.body?.tier || '').toLowerCase();
  const months = Math.min(12, Math.max(1, parseInt(req.body?.months, 10) || 1));
  const payWith = req.body?.pay_with === 'diamonds' ? 'diamonds' : 'qpay';
  if (!TIERS[tier] || tier === 'bronze') return res.status(400).json({ error: 'Silver эсвэл Gold сонгоно уу' });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const userId = req.user.id;

  try {
    if (payWith === 'diamonds') {
      const cost = TIERS[tier].diamonds * months;
      const result = await withTx(async (client) => {
        const upd = await client.query(
          'UPDATE users SET diamonds = diamonds - $1 WHERE id = $2 AND diamonds >= $1 RETURNING diamonds',
          [cost, userId]
        );
        if (!upd.rows[0]) return null;
        const until = await activateMembership(client, userId, tier, months);
        const ref = `dia:${Date.now().toString(36)}-${userId}`;
        await client.query(
          `INSERT INTO payment_orders (user_id, kind, tier, months, amount, currency, invoice_id, status, paid_at) VALUES ($1,'membership',$2,$3,$4,'DIAMOND',$5,'PAID',NOW())`,
          [userId, tier, months, cost, ref]
        );
        await client.query(
          `INSERT INTO diamond_transactions (user_id, amount, type, ref, note) VALUES ($1, $2, 'membership', $3, $4)`,
          [userId, -cost, ref, `${TIERS[tier].name} ${months} сар (💎), ${until.toISOString().slice(0, 10)} хүртэл`]
        );
        return { diamonds: upd.rows[0].diamonds, until };
      });
      if (!result) {
        const row = await getUserRow(userId);
        return res.status(402).json({
          error: `Diamond хүрэлцэхгүй байна (${fmt(row?.diamonds)} 💎 / ${fmt(cost)} 💎). 10 тоглолтоос 5-д нь хожвол +${RULES.BLOCK_BONUS_DIAMONDS} 💎.`,
          code: 'INSUFFICIENT_DIAMONDS',
        });
      }
      return res.json({ paid: true, tier, months, cost, membership_until: result.until, diamonds: result.diamonds });
    }

    if (!qpay.configured()) {
      return res.status(503).json({ error: 'QPay төлбөр хараахан идэвхжээгүй байна (админ тохируулна)', code: 'PAYMENTS_DISABLED' });
    }
    const amount = TIERS[tier].price * months;
    const senderNo = `garena-mem-${userId}-${Date.now().toString(36)}`.slice(0, 64);
    const inv = await qpay.createInvoice({
      amount,
      description: `Garena.mn ${TIERS[tier].name} гишүүнчлэл ${months} сар`,
      senderInvoiceNo: senderNo,
    });
    const invoiceId = String(inv.invoice_id || inv.id || '');
    if (!invoiceId) throw new Error('invoice_id ирсэнгүй');
    await db.query(
      `INSERT INTO payment_orders (user_id, kind, tier, months, amount, currency, invoice_id, status) VALUES ($1,'membership',$2,$3,$4,'MNT',$5,'OPEN')`,
      [userId, tier, months, amount, invoiceId]
    );
    return res.status(201).json({
      invoice_id: invoiceId, kind: 'membership', tier, months, amount, paid: false,
      qr_image: inv.qr_image || null, qr_text: inv.qr_text || null,
      short_url: inv.qPay_shortUrl || inv.short_url || inv.qpay_shortUrl || null,
      urls: Array.isArray(inv.urls) ? inv.urls : [],
    });
  } catch (e) {
    console.error('[membership/order]', e.message);
    return res.status(502).json({ error: 'Захиалга үүсгэж чадсангүй. Дараа дахин оролдоно уу.' });
  }
});

router.get('/order/:id', authMW, orderStatus);

// ── /diamonds ──────────────────────────────────────────────
const diamondsRouter = express.Router();

diamondsRouter.get('/me', authMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const row = await getUserRow(req.user.id);
    return res.json({
      diamonds: row?.diamonds || 0, ...levelProgress(row?.xp || 0),
      block_games: row?.block_games || 0, block_wins: row?.block_wins || 0, rules: RULES,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

diamondsRouter.get('/transactions', authMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const r = await db.query(
      'SELECT id, amount, type, ref, note, created_at FROM diamond_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ── POST /qpay/webhook — dashboard-аас "payment.paid" ──────
// Webhook = дохио, API = эрх мэдэл: нууц таараагүй ч API-аар дахин шалгаад л биелүүлнэ (TierBot-тэй ижил).
async function qpayWebhook(req, res) {
  const body = req.body || {};
  const invoiceId = body.invoice_id || body.invoiceId || body.id;
  const auth = qpay.verifyWebhook(req);
  if (!auth.ok) console.warn(`[QPay] webhook auth ${auth.reason} (invoice ${invoiceId || '?'}) — API-аар баталгаажуулна`);
  if (!invoiceId) return res.status(400).json({ error: 'invoice_id required' });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const order = await findOrder(invoiceId);
    if (!order) return res.json({ ok: false, reason: 'unknown invoice' });   // өөр системийн (TierSystem) нэхэмжлэх байж болно
    if (order.status === 'PAID') return res.json({ ok: true, already: true });
    let st;
    try { st = await qpay.checkInvoice(order.invoice_id); } catch (e) {
      console.warn('[QPay] webhook → check алдаа:', e.message);
      return res.status(502).json({ error: 'check failed' });
    }
    if (!st.paid) return res.json({ ok: false, reason: 'not paid yet' });
    await settleOrder(order, auth.ok ? 'webhook' : 'webhook (auth mismatch, API verified)');
    return res.json({ ok: true });
  } catch (e) {
    console.error('[QPay] webhook', e);
    return res.status(500).json({ error: 'Server error' });
  }
}

module.exports = { router, diamondsRouter, qpayWebhook, tierOf, perksOf, effectiveTier, publicFx, TIERS, NAME_EFFECTS };
