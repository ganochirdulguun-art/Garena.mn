// ── Mesh (Tailscale/Headscale) — клиентийг mesh сүлжээнд автоматаар нэгдүүлэх (2026-09-27, Ш2) ──
// POST /mesh/authkey  (JWT) → Headscale-ээс НЭГ УДААГИЙН preauth түлхүүр (1 ц) + login_server + hostname.
// POST /mesh/report   (JWT) → клиент өөрийн mesh IP/төлөвөө мэдэгдэнэ (санах ой; Ш3-д announce-ийн баталгаажуулалтад).
// GET  /mesh/status   (JWT) → өөрийн бүртгэл.
// env: HEADSCALE_URL (https://…:8443), HEADSCALE_API_KEY, HEADSCALE_USER_ID (default "1" = players).
// ⚠️ Headscale-ийн API түлхүүр клиентэд ХЭЗЭЭ Ч очихгүй — зөвхөн энэ сервер preauth үүсгэнэ.
const express = require('express');
const authMiddleware = require('../middleware/auth');

const router = express.Router();
const HS_URL = (process.env.HEADSCALE_URL || '').replace(/\/+$/, '');
const HS_KEY = process.env.HEADSCALE_API_KEY || '';
const HS_USER = process.env.HEADSCALE_USER_ID || '1';
const AUTHKEY_TTL_MS = 60 * 60 * 1000;
const AUTHKEY_COOLDOWN_MS = 2 * 60 * 1000;   // нэг хэрэглэгч 2 мин тутам 1 түлхүүр (алдаатай давталтаас хамгаална)

// 2026-10-01 (эзэн): bot1-ийн үеийнх шиг бүх тоглолт зөвхөн УБ relay-ээр — MESH_DISABLED=1 бол mesh бүхэлдээ унтарна
// (клиент /config-оос login_server авахгүй → Tailscale-д нэгдэхгүй, шинэ түлхүүр олгохгүй, өрөөнд ⚡ тэмдэг гарахгүй).
function meshDisabled() { return /^(1|true|yes)$/i.test(String(process.env.MESH_DISABLED || '')); }
function meshConfigured() { return !meshDisabled() && !!(HS_URL && HS_KEY); }

// userId → { ip, state, version, at, hostname }
const meshByUser = new Map();
const lastKeyAt = new Map();

function meshOf(userId) { return meshByUser.get(String(userId)) || null; }
// Өрөөний жагсаалтын «⚡ шууд» тэмдэг: сүүлийн 2 цагт mesh IP мэдэгдсэн (клиент 30 мин тутам report хийдэг)
const MESH_FRESH_MS = 2 * 60 * 60 * 1000;
function hasMesh(userId) { const r = meshOf(userId); return !!(r && r.ip && Date.now() - r.at < MESH_FRESH_MS); }
function noteMeshIp(userId, ip) {
  if (!userId || !isMeshIp(ip)) return;
  const uid = String(userId); const prev = meshByUser.get(uid) || {};
  meshByUser.set(uid, { ...prev, ip: String(ip), state: prev.state || 'Running', at: Date.now() });
}
function isMeshIp(ip) {
  // Tailscale CGNAT муж 100.64.0.0/10 (100.64.0.0 – 100.127.255.255)
  const p = String(ip || '').split('.').map(Number);
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
}

async function createPreauthKey(fetchImpl = fetch) {
  const expiration = new Date(Date.now() + AUTHKEY_TTL_MS).toISOString();
  const r = await fetchImpl(`${HS_URL}/api/v1/preauthkey`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${HS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: HS_USER, reusable: false, ephemeral: false, expiration }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`headscale ${r.status}`);
  const data = await r.json();
  const key = data?.preAuthKey?.key;
  if (!key) throw new Error('headscale: key алга');
  return { key, expiration };
}

router.post('/authkey', authMiddleware, async (req, res) => {
  if (!meshConfigured()) return res.status(503).json({ error: 'mesh тохируулаагүй' });
  const uid = String(req.user.id);
  const last = lastKeyAt.get(uid) || 0;
  if (Date.now() - last < AUTHKEY_COOLDOWN_MS) return res.status(429).json({ error: 'Түр хүлээнэ үү', retry_after_sec: Math.ceil((AUTHKEY_COOLDOWN_MS - (Date.now() - last)) / 1000) });
  try {
    const { key, expiration } = await createPreauthKey(router._fetch);
    lastKeyAt.set(uid, Date.now());
    return res.json({ login_server: HS_URL, auth_key: key, expires_at: expiration, hostname: `garena-${uid}` });
  } catch (e) {
    console.error('[Mesh] authkey:', e.message);
    return res.status(502).json({ error: 'Mesh серверээс түлхүүр авч чадсангүй' });
  }
});

router.post('/report', authMiddleware, (req, res) => {
  const { mesh_ip, state, version, hostname } = req.body || {};
  const uid = String(req.user.id);
  const ip = isMeshIp(mesh_ip) ? String(mesh_ip) : null;
  const rec = { ip, state: String(state || '').slice(0, 32), version: String(version || '').slice(0, 32), hostname: String(hostname || '').slice(0, 64), at: Date.now() };
  meshByUser.set(uid, rec);
  return res.json({ ok: true, mesh_ip: ip });
});

router.get('/status', authMiddleware, (req, res) => {
  return res.json({ configured: meshConfigured(), login_server: HS_URL || null, me: meshOf(req.user.id) });
});

router._fetch = undefined;   // тест: mock fetch тавьж болно
module.exports = { router, meshOf, hasMesh, noteMeshIp, isMeshIp, meshConfigured, meshDisabled, loginServer: () => (meshDisabled() ? null : HS_URL || null) };
