// ── Гишүүнчлэл (Bronze / Silver / Gold), нэрийн эффект, Diamond 💎, QPay захиалга + webhook ──
// Төлбөр: QPay (хэрэглэгчийн өөрийн "QPay Админ" dashboard) ЭСВЭЛ Diamond (Silver 800 💎, Gold 1500 💎).
// Diamond: 10 тоглолтын бонус · хэрэглэгч хоорондын шилжүүлэг · QPay-аар багц авах · эзэн/админы олголт.
// Эзэн (ADMIN_DISCORD_IDS / OWNER_USER_IDS) = unlimited 💎: шилжүүлэхэд, гишүүнчлэл авахад хасагдахгүй.
// Env: QPAY_API_BASE, QPAY_API_KEY, QPAY_WEBHOOK_SECRET, SERVER_URL.
const express = require('express');
const authMW = require('../middleware/auth');
const { perUser } = require('../middleware/ratelimit');
const adminMW = require('../middleware/admin');
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

// QPay-аар авах Diamond багцууд (Silver 800 💎 = 20,000₮ → ~25₮/💎; том багц бага зэрэг хямд)
const DIAMOND_PACKS = [
  { key: 'd200', diamonds: 200, price: 5000 },
  { key: 'd500', diamonds: 500, price: 12000 },
  { key: 'd1000', diamonds: 1000, price: 23000 },
  { key: 'd2000', diamonds: 2000, price: 44000 },
];
// Хэрэглэгч хоорондын шилжүүлгийн хязгаар (спам/алдаанаас хамгаална)
const TRANSFER = { MIN: 1, MAX: 50000, PER_HOUR: 30 };
const transferLog = new Map();   // userId -> [timestamps]

let _io = null;
function setIO(io) { _io = io; }
function notifyUser(userId, event, payload) {
  if (_io && userId !== undefined && userId !== null) _io.to(`user:${String(userId)}`).emit(event, payload);
}

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
    'SELECT id, username, membership, membership_until, name_effect, diamonds, xp, level, block_games, block_wins FROM users WHERE id = $1',
    [userId]
  );
  return r.rows[0] || null;
}
async function tierOf(userId) {
  if (!await dbOk()) return 'bronze';
  try { return effectiveTier(await getUserRow(userId)); } catch { return 'bronze'; }
}
function fmt(n) { return Number(n || 0).toLocaleString('en-US'); }
function isOwner(req) { return adminMW.isOwnerUser(req.user); }
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

// Хэрэглэгч олох: тоон id ЭСВЭЛ яг таарах нэр (case-insensitive). Нэр олон хүнд таарвал ambiguous.
async function findUser(ref, client = db) {
  const s = String(ref ?? '').trim();
  if (!s) return { user: null };
  if (/^\d{1,12}$/.test(s)) {
    const r = await client.query('SELECT id, username, diamonds FROM users WHERE id = $1', [parseInt(s, 10)]);
    return { user: r.rows[0] || null };
  }
  const r = await client.query('SELECT id, username, diamonds FROM users WHERE LOWER(username) = LOWER($1) ORDER BY id LIMIT 3', [s.slice(0, 64)]);
  if (r.rows.length > 1) return { user: null, ambiguous: r.rows.map((u) => ({ id: u.id, username: u.username })) };
  return { user: r.rows[0] || null };
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

async function addDiamonds(client, userId, amount, type, ref, note) {
  const r = await client.query(
    'UPDATE users SET diamonds = GREATEST(0, COALESCE(diamonds, 0) + $1) WHERE id = $2 RETURNING diamonds',
    [amount, userId]
  );
  if (!r.rows[0]) throw new Error('user-not-found');
  await client.query(
    'INSERT INTO diamond_transactions (user_id, amount, type, ref, note) VALUES ($1, $2, $3, $4, $5)',
    [userId, amount, type, ref, note]
  );
  return r.rows[0].diamonds;
}

async function findOrder(invoiceId) {
  const r = await db.query('SELECT * FROM payment_orders WHERE invoice_id = $1', [String(invoiceId)]);
  return r.rows[0] || null;
}

// Төлөгдсөн QPay захиалгыг биелүүлэх (idempotent): гишүүнчлэл ЭСВЭЛ Diamond багц
async function settleOrder(order, via) {
  return withTx(async (client) => {
    const upd = await client.query(
      `UPDATE payment_orders SET status = 'PAID', paid_at = NOW() WHERE id = $1 AND status <> 'PAID' RETURNING *`,
      [order.id]
    );
    if (!upd.rows[0]) return false;
    const o = upd.rows[0];
    if (o.kind === 'diamonds') {
      const n = Number(o.diamonds || 0);
      const balance = await addDiamonds(client, o.user_id, n, 'purchase', `qpay:${o.invoice_id}`, `${fmt(n)} 💎 багц — QPay ${fmt(o.amount)}₮`);
      console.log(`[QPay] order #${o.id} (${n} 💎, ${o.amount}₮) төлөгдлөө — ${via}`);
      notifyUser(o.user_id, 'diamonds:updated', { diamonds: balance, delta: n, reason: 'purchase' });
      return true;
    }
    const until = await activateMembership(client, o.user_id, o.tier, o.months || 1);
    console.log(`[QPay] order #${o.id} (${o.tier} ${o.months}сар, ${o.amount}₮) төлөгдлөө — ${via}; ${until.toISOString().slice(0, 10)} хүртэл`);
    notifyUser(o.user_id, 'membership:updated', { tier: o.tier, membership_until: until });
    return true;
  });
}

// Захиалгын төлөв — webhook алдагдсан ч poll хийхэд төлөгдсөн бол биелүүлнэ
async function orderStatus(req, res) {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const order = await findOrder(req.params.id);
  if (!order || String(order.user_id) !== String(req.user.id)) return res.status(404).json({ error: 'Захиалга олдсонгүй' });
  if (order.status === 'PAID') return res.json({ status: 'PAID', paid: true, kind: order.kind });
  if (order.status === 'CANCELLED') return res.json({ status: 'CANCELLED', paid: false, kind: order.kind });
  let st;
  try { st = await qpay.checkInvoice(order.invoice_id); } catch (e) {
    console.warn('[QPay] check алдаа:', e.message);
    return res.json({ status: order.status, paid: false, kind: order.kind });
  }
  if (st.paid) { await settleOrder(order, 'poll'); return res.json({ status: 'PAID', paid: true, kind: order.kind }); }
  if (st.status === 'CANCELLED') {
    await db.query(`UPDATE payment_orders SET status = 'CANCELLED' WHERE id = $1 AND status = 'OPEN'`, [order.id]);
  }
  return res.json({ status: st.status || 'OPEN', paid: false, kind: order.kind });
}

function invoiceResponse(inv, extra) {
  return {
    invoice_id: String(inv.invoice_id || inv.id || ''), paid: false, ...extra,
    qr_image: inv.qr_image || null, qr_text: inv.qr_text || null,
    short_url: inv.qPay_shortUrl || inv.short_url || inv.qpay_shortUrl || null,
    urls: Array.isArray(inv.urls) ? inv.urls : [],
  };
}

// ── /membership ───────────────────────────────────────────
const router = express.Router();

router.get('/plans', (_req, res) => {
  res.json({
    tiers: TIERS, name_effects: NAME_EFFECTS, currency: '₮', period_days: 30,
    payments_enabled: qpay.configured(), diamond_rules: RULES, diamond_packs: DIAMOND_PACKS, transfer: TRANSFER,
  });
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
      diamonds: row.diamonds || 0, unlimited_diamonds: isOwner(req), ...levelProgress(row.xp || 0),
      block_games: row.block_games || 0, block_wins: row.block_wins || 0,
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
router.post('/order', authMW, perUser('order', 10, 60 * 60 * 1000, 'Захиалга хэт олон — 1 цагийн дараа дахин оролдоно уу.'), async (req, res) => {
  const tier = String(req.body?.tier || '').toLowerCase();
  const months = Math.min(12, Math.max(1, parseInt(req.body?.months, 10) || 1));
  const payWith = req.body?.pay_with === 'diamonds' ? 'diamonds' : 'qpay';
  if (!TIERS[tier] || tier === 'bronze') return res.status(400).json({ error: 'Silver эсвэл Gold сонгоно уу' });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const userId = req.user.id;
  const unlimited = isOwner(req);

  try {
    if (payWith === 'diamonds') {
      const cost = TIERS[tier].diamonds * months;
      const result = await withTx(async (client) => {
        let balance = null;
        if (!unlimited) {
          const upd = await client.query(
            'UPDATE users SET diamonds = diamonds - $1 WHERE id = $2 AND diamonds >= $1 RETURNING diamonds',
            [cost, userId]
          );
          if (!upd.rows[0]) return null;
          balance = upd.rows[0].diamonds;
        }
        const until = await activateMembership(client, userId, tier, months);
        const ref = `dia:${Date.now().toString(36)}-${userId}`;
        await client.query(
          `INSERT INTO payment_orders (user_id, kind, tier, months, amount, currency, invoice_id, status, paid_at) VALUES ($1,'membership',$2,$3,$4,'DIAMOND',$5,'PAID',NOW())`,
          [userId, tier, months, unlimited ? 0 : cost, ref]
        );
        await client.query(
          `INSERT INTO diamond_transactions (user_id, amount, type, ref, note) VALUES ($1, $2, 'membership', $3, $4)`,
          [userId, unlimited ? 0 : -cost, ref, `${TIERS[tier].name} ${months} сар (${unlimited ? 'эзэн — unlimited 💎' : fmt(cost) + ' 💎'}), ${until.toISOString().slice(0, 10)} хүртэл`]
        );
        return { diamonds: balance, until };
      });
      if (!result) {
        const row = await getUserRow(userId);
        return res.status(402).json({
          error: `Diamond хүрэлцэхгүй байна (${fmt(row?.diamonds)} 💎 / ${fmt(cost)} 💎). 10 тоглолтоос 5-д нь хожвол +${RULES.BLOCK_BONUS_DIAMONDS} 💎, эсвэл QPay-аар 💎 багц авна.`,
          code: 'INSUFFICIENT_DIAMONDS',
        });
      }
      notifyUser(userId, 'membership:updated', { tier, membership_until: result.until });
      return res.json({ paid: true, tier, months, cost: unlimited ? 0 : cost, membership_until: result.until, diamonds: result.diamonds });
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
    return res.status(201).json(invoiceResponse(inv, { kind: 'membership', tier, months, amount }));
  } catch (e) {
    console.error('[membership/order]', e.message);
    return res.status(502).json({ error: 'Захиалга үүсгэж чадсангүй. Дараа дахин оролдоно уу.' });
  }
});

router.get('/order/:id', authMW, orderStatus);

// ── /diamonds ──────────────────────────────────────────────
const diamondsRouter = express.Router();

diamondsRouter.get('/packs', (_req, res) => {
  res.json({ packs: DIAMOND_PACKS, payments_enabled: qpay.configured(), transfer: TRANSFER });
});

diamondsRouter.get('/me', authMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const row = await getUserRow(req.user.id);
    return res.json({
      diamonds: row?.diamonds || 0, unlimited: isOwner(req), ...levelProgress(row?.xp || 0),
      block_games: row?.block_games || 0, block_wins: row?.block_wins || 0, rules: RULES,
      packs: DIAMOND_PACKS, transfer: TRANSFER, payments_enabled: qpay.configured(),
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
      'SELECT id, amount, type, ref, note, created_at FROM diamond_transactions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 50',
      [req.user.id]
    );
    return res.json(r.rows);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// Хэрэглэгч хоорондын шилжүүлэг: { to: <user id | username>, amount, note? }
// Эзэн unlimited: хасагдахгүй (шинээр үүснэ). Бусад: үлдэгдэл хүрэлцэх ёстой (атомар UPDATE … WHERE diamonds >= amount).
diamondsRouter.post('/transfer', authMW, async (req, res) => {
  const amount = parseInt(req.body?.amount, 10);
  const note = String(req.body?.note || '').trim().slice(0, 140);
  const toRef = req.body?.to ?? req.body?.to_user_id ?? req.body?.to_username;
  if (!Number.isInteger(amount) || amount < TRANSFER.MIN || amount > TRANSFER.MAX) {
    return res.status(400).json({ error: `Дүн ${TRANSFER.MIN}–${fmt(TRANSFER.MAX)} 💎 хооронд бүхэл тоо байна` });
  }
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const fromId = req.user.id;
  const unlimited = isOwner(req);

  // Цагийн хязгаар (эзэнд ч хамаарна — санамсаргүй давталтаас хамгаална)
  const now = Date.now();
  const recent = (transferLog.get(String(fromId)) || []).filter((t) => now - t < 3600 * 1000);
  if (recent.length >= TRANSFER.PER_HOUR) return res.status(429).json({ error: `Цагт ${TRANSFER.PER_HOUR} шилжүүлгийн хязгаар хүрсэн — түр хүлээнэ үү` });

  try {
    const found = await findUser(toRef);
    if (found.ambiguous) return res.status(409).json({ error: 'Энэ нэртэй хэд хэдэн хэрэглэгч байна — ID-гаар нь сонгоно уу', code: 'AMBIGUOUS', candidates: found.ambiguous });
    const to = found.user;
    if (!to) return res.status(404).json({ error: 'Хүлээн авагч олдсонгүй' });
    if (String(to.id) === String(fromId)) return res.status(400).json({ error: 'Өөртөө шилжүүлэх боломжгүй' });

    const ref = `tx:${now.toString(36)}-${fromId}-${to.id}`;
    const out = await withTx(async (client) => {
      let senderBalance = null;
      if (!unlimited) {
        const upd = await client.query(
          'UPDATE users SET diamonds = diamonds - $1 WHERE id = $2 AND COALESCE(diamonds, 0) >= $1 RETURNING diamonds',
          [amount, fromId]
        );
        if (!upd.rows[0]) return null;
        senderBalance = upd.rows[0].diamonds;
      }
      await client.query(
        'INSERT INTO diamond_transactions (user_id, amount, type, ref, note) VALUES ($1, $2, $3, $4, $5)',
        [fromId, unlimited ? 0 : -amount, 'transfer_out', ref, `→ ${to.username} (#${to.id})${unlimited ? ' · эзэн (unlimited)' : ''}${note ? ' — ' + note : ''}`]
      );
      const receiverBalance = await addDiamonds(client, to.id, amount, 'transfer_in', ref, `← ${req.user.username} (#${fromId})${note ? ' — ' + note : ''}`);
      return { senderBalance, receiverBalance };
    });
    if (!out) {
      const row = await getUserRow(fromId);
      return res.status(402).json({ error: `Diamond хүрэлцэхгүй байна (${fmt(row?.diamonds)} 💎 / ${fmt(amount)} 💎)`, code: 'INSUFFICIENT_DIAMONDS' });
    }
    recent.push(now);
    transferLog.set(String(fromId), recent);
    console.log(`[Diamonds] ${req.user.username}#${fromId} → ${to.username}#${to.id}: ${amount} 💎${unlimited ? ' (owner mint)' : ''}`);
    notifyUser(to.id, 'diamonds:received', {
      from_user_id: fromId, from_username: req.user.username, amount, note, diamonds: out.receiverBalance,
    });
    notifyUser(fromId, 'diamonds:updated', { diamonds: out.senderBalance, delta: unlimited ? 0 : -amount, reason: 'transfer_out' });
    return res.json({ ok: true, to: { id: to.id, username: to.username }, amount, diamonds: out.senderBalance, unlimited });
  } catch (e) {
    console.error('[diamonds/transfer]', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

// QPay-аар Diamond багц авах: { pack: 'd500' }
diamondsRouter.post('/buy', authMW, perUser('order', 10, 60 * 60 * 1000, 'Захиалга хэт олон — 1 цагийн дараа дахин оролдоно уу.'), async (req, res) => {
  const pack = DIAMOND_PACKS.find((p) => p.key === String(req.body?.pack || ''));
  if (!pack) return res.status(400).json({ error: 'Багц сонгоно уу', packs: DIAMOND_PACKS });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  if (!qpay.configured()) return res.status(503).json({ error: 'QPay төлбөр хараахан идэвхжээгүй байна (админ тохируулна)', code: 'PAYMENTS_DISABLED' });
  const userId = req.user.id;
  try {
    const senderNo = `garena-dia-${userId}-${Date.now().toString(36)}`.slice(0, 64);
    const inv = await qpay.createInvoice({ amount: pack.price, description: `Garena.mn ${pack.diamonds} Diamond 💎`, senderInvoiceNo: senderNo });
    const invoiceId = String(inv.invoice_id || inv.id || '');
    if (!invoiceId) throw new Error('invoice_id ирсэнгүй');
    await db.query(
      `INSERT INTO payment_orders (user_id, kind, tier, months, amount, currency, invoice_id, status, diamonds) VALUES ($1,'diamonds',NULL,0,$2,'MNT',$3,'OPEN',$4)`,
      [userId, pack.price, invoiceId, pack.diamonds]
    );
    return res.status(201).json(invoiceResponse(inv, { kind: 'diamonds', pack: pack.key, diamonds: pack.diamonds, amount: pack.price }));
  } catch (e) {
    console.error('[diamonds/buy]', e.message);
    return res.status(502).json({ error: 'Захиалга үүсгэж чадсангүй. Дараа дахин оролдоно уу.' });
  }
});

diamondsRouter.get('/order/:id', authMW, orderStatus);

// ── /admin/api (adminMW) — 💎 олгох, гишүүнчлэл өгөх, дэвтэр ──────────
// Олголт (mint) ба гишүүнчлэл үнэгүй өгөх = зөвхөн ЭЗЭН (env админ / OWNER_USER_IDS). Дэвтэр = бүх админ.
const adminRouter = express.Router();
function ownerOnly(req, res, next) {
  if (!req.isOwner) return res.status(403).json({ error: 'Зөвхөн платформын эзэн (ADMIN_DISCORD_IDS / OWNER_USER_IDS) олгоно' });
  next();
}

// ── 📊 Тайлан (C3): сарын QPay орлого, гишүүнчлэл, 💎 гүйлгээ; CSV архив (QPay гэрээ §5.5.9 — 12 сар) ──
adminRouter.get('/reports/summary', adminMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const months = Math.min(24, Math.max(1, Number(req.query.months) || 6));
  try {
    const orders = await db.query(
      `SELECT to_char(date_trunc('month', COALESCE(paid_at, created_at)), 'YYYY-MM') AS month,
              COUNT(*) FILTER (WHERE status = 'PAID' AND currency = 'MNT') AS qpay_orders,
              COALESCE(SUM(amount) FILTER (WHERE status = 'PAID' AND currency = 'MNT'), 0) AS qpay_mnt,
              COUNT(*) FILTER (WHERE status = 'PAID' AND kind = 'membership' AND tier = 'silver') AS silver,
              COUNT(*) FILTER (WHERE status = 'PAID' AND kind = 'membership' AND tier = 'gold') AS gold,
              COALESCE(SUM(diamonds) FILTER (WHERE status = 'PAID' AND kind = 'diamonds'), 0) AS diamonds_sold,
              COUNT(*) FILTER (WHERE status <> 'PAID') AS unpaid
         FROM payment_orders
        WHERE COALESCE(paid_at, created_at) >= date_trunc('month', NOW()) - ($1 || ' months')::interval
        GROUP BY 1 ORDER BY 1 DESC`, [String(months - 1)]);
    const dia = await db.query(
      `SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
              COALESCE(SUM(amount) FILTER (WHERE type = 'block_bonus'), 0) AS bonus,
              COALESCE(SUM(amount) FILTER (WHERE type = 'purchase'), 0) AS purchased,
              COALESCE(-SUM(amount) FILTER (WHERE type = 'membership'), 0) AS spent_membership,
              COALESCE(SUM(amount) FILTER (WHERE type = 'transfer_in'), 0) AS transferred,
              COALESCE(SUM(amount) FILTER (WHERE type = 'admin_grant'), 0) AS granted
         FROM diamond_transactions
        WHERE created_at >= date_trunc('month', NOW()) - ($1 || ' months')::interval
        GROUP BY 1 ORDER BY 1 DESC`, [String(months - 1)]);
    const active = await db.query(
      `SELECT membership, COUNT(*) AS n FROM users WHERE membership IN ('silver','gold') AND (membership_until IS NULL OR membership_until > NOW()) GROUP BY membership`);
    const totals = await db.query(
      `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'PAID' AND currency = 'MNT'), 0) AS qpay_mnt_all,
              COUNT(*) FILTER (WHERE status = 'PAID') AS paid_all,
              (SELECT COALESCE(SUM(diamonds), 0) FROM users) AS diamonds_in_circulation
         FROM payment_orders`);
    const byMonth = new Map();
    for (const r of orders.rows) byMonth.set(r.month, { month: r.month, qpay_orders: +r.qpay_orders, qpay_mnt: +r.qpay_mnt, silver: +r.silver, gold: +r.gold, diamonds_sold: +r.diamonds_sold, unpaid: +r.unpaid });
    for (const r of dia.rows) byMonth.set(r.month, { ...(byMonth.get(r.month) || { month: r.month, qpay_orders: 0, qpay_mnt: 0, silver: 0, gold: 0, diamonds_sold: 0, unpaid: 0 }), dia_bonus: +r.bonus, dia_purchased: +r.purchased, dia_spent_membership: +r.spent_membership, dia_transferred: +r.transferred, dia_granted: +r.granted });
    const rows = [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : -1));
    const activeMap = Object.fromEntries(active.rows.map((r) => [r.membership, +r.n]));
    res.json({ months, rows, active: { silver: activeMap.silver || 0, gold: activeMap.gold || 0 }, totals: { qpay_mnt_all: +totals.rows[0].qpay_mnt_all, paid_all: +totals.rows[0].paid_all, diamonds_in_circulation: +totals.rows[0].diamonds_in_circulation } });
  } catch (e) { console.error('[reports/summary]', e); res.status(500).json({ error: 'Server error' }); }
});

// CSV архив: захиалгууд (QPay нэхэмжлэх + 💎 төлбөр) — ?from=YYYY-MM-DD&to=YYYY-MM-DD (default сүүлийн 12 сар)
adminRouter.get('/reports/orders.csv', adminMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? req.query.from : null;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? req.query.to : null;
  try {
    const r = await db.query(
      `SELECT o.id, o.created_at, o.paid_at, o.status, o.kind, o.tier, o.months, o.amount, o.currency, o.diamonds, o.invoice_id,
              u.id AS user_id, u.username, u.discord_id
         FROM payment_orders o LEFT JOIN users u ON u.id = o.user_id
        WHERE o.created_at >= COALESCE($1::date, NOW() - INTERVAL '12 months') AND o.created_at < COALESCE($2::date + INTERVAL '1 day', NOW() + INTERVAL '1 day')
        ORDER BY o.id`, [from, to]);
    const esc = (v) => { const t = v == null ? '' : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const head = ['id', 'created_at', 'paid_at', 'status', 'kind', 'tier', 'months', 'amount', 'currency', 'diamonds', 'invoice_id', 'user_id', 'username', 'discord_id'];
    const lines = [head.join(',')].concat(r.rows.map((row) => head.map((k) => esc(row[k] instanceof Date ? row[k].toISOString() : row[k])).join(',')));
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="garena-orders-${from || 'last12m'}-${to || 'now'}.csv"`);
    res.send('\ufeff' + lines.join('\n'));
  } catch (e) { console.error('[reports/orders.csv]', e); res.status(500).json({ error: 'Server error' }); }
});

adminRouter.get('/diamonds/summary', adminMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const circ = await db.query('SELECT COALESCE(SUM(diamonds), 0)::bigint AS diamonds, COUNT(*) FILTER (WHERE COALESCE(diamonds,0) > 0)::int AS holders FROM users');
    const orders = await db.query(`SELECT kind, currency, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::bigint AS amount FROM payment_orders WHERE status = 'PAID' GROUP BY kind, currency`);
    const members = await db.query(`SELECT membership, COUNT(*)::int AS n FROM users WHERE membership IN ('silver','gold') AND membership_until > NOW() GROUP BY membership`);
    const tx = await db.query(`SELECT type, COUNT(*)::int AS n, COALESCE(SUM(amount), 0)::bigint AS amount FROM diamond_transactions GROUP BY type`);
    return res.json({
      is_owner: !!req.isOwner,
      diamonds_in_circulation: Number(circ.rows[0].diamonds), holders: circ.rows[0].holders,
      paid_orders: orders.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
      active_members: members.rows, transactions: tx.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
      packs: DIAMOND_PACKS, tiers: TIERS,
    });
  } catch (e) { console.error('[admin/diamonds/summary]', e.message); return res.status(500).json({ error: 'Server error' }); }
});

adminRouter.get('/diamonds/ledger', adminMW, async (req, res) => {
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const userRef = String(req.query.user || '').trim();
  try {
    const params = [limit];
    let where = '';
    if (userRef) {
      if (/^\d{1,12}$/.test(userRef)) { params.push(parseInt(userRef, 10)); where = `WHERE t.user_id = $${params.length}`; }
      else { params.push(`%${userRef}%`); where = `WHERE u.username ILIKE $${params.length}`; }
    }
    const r = await db.query(
      `SELECT t.id, t.user_id, u.username, t.amount, t.type, t.ref, t.note, t.created_at
       FROM diamond_transactions t LEFT JOIN users u ON u.id = t.user_id ${where}
       ORDER BY t.created_at DESC, t.id DESC LIMIT $1`, params
    );
    return res.json({ rows: r.rows });
  } catch (e) { console.error('[admin/diamonds/ledger]', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// { user: <id|username>, amount: ±N, note }  — дансны гүйлгээгээр зарсан 💎, ажилтанд олгох, алдаа засах
adminRouter.post('/diamonds/grant', adminMW, ownerOnly, async (req, res) => {
  const amount = parseInt(req.body?.amount, 10);
  const note = String(req.body?.note || '').trim().slice(0, 200);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 1000000) return res.status(400).json({ error: 'Дүн буруу (±1…1,000,000)' });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const found = await findUser(req.body?.user);
    if (found.ambiguous) return res.status(409).json({ error: 'Нэр олон хүнд таарч байна — ID ашиглана уу', candidates: found.ambiguous });
    if (!found.user) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    const u = found.user;
    const by = req.user.username || req.user.discord_id || req.user.id;
    const balance = await withTx((client) => addDiamonds(client, u.id, amount, 'admin_grant', `admin:${req.user.id}`, `${amount > 0 ? 'Олголт' : 'Хасалт'} — ${by}${note ? ': ' + note : ''}`));
    console.log(`[Diamonds] admin ${by} → ${u.username}#${u.id}: ${amount > 0 ? '+' : ''}${amount} 💎 (${note || '-'})`);
    notifyUser(u.id, amount > 0 ? 'diamonds:received' : 'diamonds:updated', { from_username: 'Garena.mn', amount, note, diamonds: balance, reason: 'admin_grant' });
    return res.json({ ok: true, user: { id: u.id, username: u.username }, amount, diamonds: balance });
  } catch (e) { console.error('[admin/diamonds/grant]', e.message); return res.status(500).json({ error: 'Server error' }); }
});

// { user: <id|username>, tier: silver|gold|bronze, months: 1..24, note } — ажилтанд үнэгүй GOLD гэх мэт
adminRouter.post('/membership/grant', adminMW, ownerOnly, async (req, res) => {
  const tier = String(req.body?.tier || '').toLowerCase();
  const months = Math.min(24, Math.max(1, parseInt(req.body?.months, 10) || 1));
  const note = String(req.body?.note || '').trim().slice(0, 200);
  if (!TIERS[tier]) return res.status(400).json({ error: 'tier: bronze | silver | gold' });
  if (!await dbOk()) return res.status(503).json({ error: 'Service temporarily unavailable' });
  try {
    const found = await findUser(req.body?.user);
    if (found.ambiguous) return res.status(409).json({ error: 'Нэр олон хүнд таарч байна — ID ашиглана уу', candidates: found.ambiguous });
    if (!found.user) return res.status(404).json({ error: 'Хэрэглэгч олдсонгүй' });
    const u = found.user;
    const by = req.user.username || req.user.discord_id || req.user.id;
    const until = await withTx(async (client) => {
      if (tier === 'bronze') {
        await client.query(`UPDATE users SET membership = 'bronze', membership_until = NULL WHERE id = $1`, [u.id]);
        return null;
      }
      const u2 = await activateMembership(client, u.id, tier, months);
      await client.query(
        `INSERT INTO payment_orders (user_id, kind, tier, months, amount, currency, invoice_id, status, paid_at) VALUES ($1,'membership',$2,$3,0,'GRANT',$4,'PAID',NOW())`,
        [u.id, tier, months, `grant:${Date.now().toString(36)}-${u.id}`]
      );
      return u2;
    });
    console.log(`[Membership] admin ${by} → ${u.username}#${u.id}: ${tier} ${months} сар (${note || '-'})`);
    notifyUser(u.id, 'membership:updated', { tier, membership_until: until, granted_by: 'Garena.mn', note });
    return res.json({ ok: true, user: { id: u.id, username: u.username }, tier, months, membership_until: until });
  } catch (e) { console.error('[admin/membership/grant]', e.message); return res.status(500).json({ error: 'Server error' }); }
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

module.exports = {
  router, diamondsRouter, adminRouter, qpayWebhook, setIO,
  tierOf, perksOf, effectiveTier, publicFx, TIERS, NAME_EFFECTS, DIAMOND_PACKS, TRANSFER,
};
