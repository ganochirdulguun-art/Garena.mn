// ── Шинэ хэрэглэгчийн урамшуулал: анх бүртгүүлэхэд +WELCOME_DIAMONDS 💎 + платформын DM ──
// Эзний шийдвэр (2026-09-04): зөвхөн энэ мөчөөс хойш ШИНЭЭР бүртгүүлсэн хэрэглэгчид (имэйл/Discord аль ч зам),
// нэг хэрэглэгчид нэг л удаа (дэвтрийн ref = welcome:v1). Өмнөх хэрэглэгчдэд буцаан олгохгүй.
// DM илгээгч = "Garena.mn" системийн хэрэглэгч (нэвтрэх боломжгүй, email system@garena.mn) — DM жагсаалтад харагдана.
const { addDiamonds, notifyUser, withTx } = require('../routes/membership');

let db;
try { db = require('../config/db'); } catch { db = null; }

const AMOUNT = Math.max(0, parseInt(process.env.WELCOME_DIAMONDS || '350', 10) || 0);
const REF = 'welcome:v1';
const MESSAGE = process.env.WELCOME_MESSAGE
  || 'Garena.mn платформ-д тавтай морил. Танд шинэ хэрэглэгчийн урамшуулал болгож 350 Diamond бэлэг болгон илгээв';
const SYSTEM_EMAIL = 'system@garena.mn';
const SYSTEM_NAME = 'Garena.mn';
let systemUserId = null;

async function systemUser(client) {
  if (systemUserId) return systemUserId;
  const q = client || db;
  const r = await q.query('SELECT id FROM users WHERE LOWER(email) = $1', [SYSTEM_EMAIL]);
  if (r.rows[0]) { systemUserId = r.rows[0].id; return systemUserId; }
  const ins = await q.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, NULL) ON CONFLICT (email) DO NOTHING RETURNING id',
    [SYSTEM_NAME, SYSTEM_EMAIL]
  );
  systemUserId = ins.rows[0]?.id || (await q.query('SELECT id FROM users WHERE LOWER(email) = $1', [SYSTEM_EMAIL])).rows[0]?.id || null;
  return systemUserId;
}

/** Урамшуулал олгоно. Буцаана: { granted, amount, balance } — аль хэдийн авсан/идэвхгүй бол granted=false. */
async function grantWelcome(userId, { username } = {}) {
  if (!db || !AMOUNT || !userId) return { granted: false, reason: !AMOUNT ? 'disabled' : 'no-db' };
  const out = await withTx(async (client) => {
    const dup = await client.query('SELECT 1 FROM diamond_transactions WHERE user_id = $1 AND ref = $2', [userId, REF]);
    if (dup.rows[0]) return { granted: false, reason: 'already' };
    const balance = await addDiamonds(client, userId, AMOUNT, 'welcome', REF, `Шинэ хэрэглэгчийн урамшуулал +${AMOUNT} 💎`);
    let dmId = null;
    try {
      const sys = await systemUser(client);
      if (sys) {
        const m = await client.query('INSERT INTO messages (sender_id, receiver_id, text) VALUES ($1, $2, $3) RETURNING id', [sys, userId, MESSAGE]);
        dmId = m.rows[0]?.id || null;
      }
    } catch (e) { console.warn('[Welcome] DM:', e.message); }
    return { granted: true, amount: AMOUNT, balance, dmId };
  });
  if (out.granted) {
    notifyUser(userId, 'diamonds:received', { from_username: SYSTEM_NAME, amount: AMOUNT, note: 'Шинэ хэрэглэгчийн урамшуулал', diamonds: out.balance, reason: 'welcome' });
    if (out.dmId && systemUserId) {   // нэвтэрсэн бол DM шууд (live) харагдана; үгүй бол DM жагсаалтаас уншина
      notifyUser(userId, 'private:message', { fromUsername: SYSTEM_NAME, fromUserId: String(systemUserId), text: MESSAGE, time: new Date().toISOString(), id: out.dmId });
    }
    console.log(`[Welcome] +${AMOUNT} 💎 → user #${userId}${username ? ' (' + username + ')' : ''}${out.dmId ? ' · DM #' + out.dmId : ''}`);
  }
  return out;
}

/** Бүртгэлийн замаас дуудна — алдаа гарвал бүртгэлийг зогсоохгүй (fire-and-forget). */
function grantWelcomeSafe(userId, meta) {
  grantWelcome(userId, meta).catch((e) => console.error('[Welcome] grant:', e.message));
}

module.exports = { grantWelcome, grantWelcomeSafe, systemUser, AMOUNT, REF, MESSAGE, SYSTEM_EMAIL, SYSTEM_NAME };
