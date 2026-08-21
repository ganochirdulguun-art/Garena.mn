// ── QPay төлбөр — хэрэглэгчийн өөрийн "QPay Админ" dashboard-оор дамжуулна ──
// (qpay-dashboard/server.py: POST/GET/DELETE /api/v1/invoices, x-api-key; webhook x-webhook-secret + x-webhook-signature)
// Env: QPAY_API_BASE (жиш. https://qpay-dashboard-production-2ceb.up.railway.app), QPAY_API_KEY, QPAY_WEBHOOK_SECRET
const crypto = require('crypto');

const BASE = String(process.env.QPAY_API_BASE || '').replace(/\/+$/, '');
const KEY = process.env.QPAY_API_KEY || '';
const WEBHOOK_SECRET = String(process.env.QPAY_WEBHOOK_SECRET || '').replace(/[^\x21-\x7e]/g, ''); // зөвхөн ASCII

function configured() { return Boolean(BASE && KEY); }

async function request(method, urlPath, body) {
  const axios = require('axios');
  const { data } = await axios({
    method,
    url: `${BASE}${urlPath}`,
    data: body,
    headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' },
    timeout: 15000,
  });
  return data;
}

// → { invoice_id, qr_image (base64 png), qr_text, qPay_shortUrl, urls[] }
async function createInvoice({ amount, description, senderInvoiceNo }) {
  if (!configured()) throw new Error('QPay not configured');
  return request('post', '/api/v1/invoices', {
    amount: Math.round(amount),
    invoice_description: String(description || 'Garena.mn').slice(0, 255),
    sender_invoice_no: String(senderInvoiceNo || '').slice(0, 64),
  });
}

// Аль ч хэлбэрийн хариунаас paid/status-ийг ойлгоно (dashboard: {status, payment_status, paid}; QPay v2: {rows:[{payment_status}]})
function normalizeState(data) {
  let paid = false;
  let status = 'OPEN';
  const walk = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 4) return;
    if (o.paid === true) paid = true;
    for (const k of ['status', 'payment_status', 'invoice_status']) {
      const v = String(o[k] || '').toUpperCase();
      if (v === 'PAID') { paid = true; status = 'PAID'; }
      else if (v === 'CANCELLED' || v === 'CANCELED' || v === 'EXPIRED') { if (status !== 'PAID') status = 'CANCELLED'; }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(data);
  if (paid) status = 'PAID';
  return { paid, status };
}

async function checkInvoice(invoiceId) {
  if (!configured()) throw new Error('QPay not configured');
  const data = await request('get', `/api/v1/invoices/${encodeURIComponent(invoiceId)}`);
  return normalizeState(data);
}

async function cancelInvoice(invoiceId) {
  if (!configured()) return;
  try { await request('delete', `/api/v1/invoices/${encodeURIComponent(invoiceId)}`); } catch {}
}

function safeEqual(a, b) {
  const A = Buffer.from(String(a));
  const B = Buffer.from(String(b));
  return A.length === B.length && crypto.timingSafeEqual(A, B);
}

// Webhook: x-webhook-secret (plain) ЭСВЭЛ x-webhook-signature (HMAC-SHA256 hex of raw body)
function verifyWebhook(req) {
  if (!WEBHOOK_SECRET) return { ok: false, reason: 'QPAY_WEBHOOK_SECRET тохируулаагүй' };
  const secret = req.get('x-webhook-secret');
  if (secret && safeEqual(secret, WEBHOOK_SECRET)) return { ok: true };
  const sig = req.get('x-webhook-signature');
  if (sig && req.rawBody) {
    const h = crypto.createHmac('sha256', WEBHOOK_SECRET).update(req.rawBody).digest('hex');
    if (safeEqual(h, sig)) return { ok: true };
  }
  return { ok: false, reason: 'secret/signature таарахгүй' };
}

module.exports = { configured, createInvoice, checkInvoice, cancelInvoice, verifyWebhook, normalizeState };
