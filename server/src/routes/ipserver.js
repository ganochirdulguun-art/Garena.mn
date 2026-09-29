// ══════════════════════════════════════════════════════════════
// IP-ээр холбогддог тоглоомын сервер (2026-09-30, Ш1): Counter-Strike 1.6, Quake III.
// Хост өөрийн PC дээр listen сервер нээж, Tailscale mesh IP-ээ (100.64/10) өрөөнд зарлана;
// өрөөний бусад гишүүд нэг товчоор `+connect IP:PORT`-оор нэгдэнэ. Зөвхөн өрөөний гишүүд харна.
// WC3-ийн LAN relay-ээс (lanhost.js) тусдаа — эдгээр тоглоомд relay/бичлэг/XP хараахан алга.
// ══════════════════════════════════════════════════════════════
const express = require('express');
const auth = require('../middleware/auth');

let roomRoutes = null;
try { roomRoutes = require('./rooms'); } catch { roomRoutes = null; }

const router = express.Router();
let _io = null;
function setIO(io) { _io = io; }
function emitRoom(roomId, event, payload) { if (_io && roomId) _io.to(String(roomId)).emit(event, payload); }

const KINDS = { cs16: { label: 'Counter-Strike 1.6', port: 27015 }, q3: { label: 'Quake III Arena', port: 27960 } };
const servers = new Map();   // roomId -> { host_user_id, host_username, kind, ip, port, map, created_at }

function isMeshIp(ip) {
  const p = String(ip || '').split('.').map(Number);
  return p.length === 4 && p[0] === 100 && p[1] >= 64 && p[1] <= 127 && p.every((x) => Number.isInteger(x) && x >= 0 && x <= 255);
}
async function inRoom(userId, roomId) {
  try { return !!(roomRoutes && await roomRoutes.isUserInRoom(userId, roomId)); } catch { return false; }
}
function pub(s) { return s ? { ...s, label: KINDS[s.kind]?.label || s.kind } : null; }

router.get('/:id/ipserver', auth, async (req, res) => {
  if (!await inRoom(req.user.id, req.params.id)) return res.status(403).json({ error: 'Өрөөний гишүүн биш' });
  const s = servers.get(String(req.params.id)) || null;
  // Хост өрөөнөөс гарсан бол хуучирсан сервер — цэвэрлэнэ
  if (s && !await inRoom(s.host_user_id, req.params.id)) { servers.delete(String(req.params.id)); return res.json({ server: null }); }
  return res.json({ server: pub(s) });
});

router.post('/:id/ipserver', auth, async (req, res) => {
  const roomId = String(req.params.id);
  if (!await inRoom(req.user.id, roomId)) return res.status(403).json({ error: 'Өрөөний гишүүн биш' });
  const kind = String(req.body?.kind || '');
  if (!KINDS[kind]) return res.status(400).json({ error: 'Дэмжигдээгүй тоглоом' });
  const ip = String(req.body?.ip || '');
  if (!isMeshIp(ip)) return res.status(400).json({ error: 'Mesh IP (100.64.x.x) шаардлагатай — Тохиргоо → Апп → Mesh холбогдсон байх ёстой', code: 'MESH_REQUIRED' });
  const port = Number(req.body?.port || KINDS[kind].port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return res.status(400).json({ error: 'Буруу порт' });
  const cur = servers.get(roomId);
  if (cur && String(cur.host_user_id) !== String(req.user.id) && await inRoom(cur.host_user_id, roomId)) {
    return res.status(409).json({ error: 'Энэ өрөөнд өөр тоглогч сервер нээсэн байна', server: pub(cur) });
  }
  const map = String(req.body?.map || '').replace(/[^\w.-]/g, '').slice(0, 40);
  const s = { host_user_id: String(req.user.id), host_username: req.user.username || 'Хост', kind, ip, port, map, created_at: new Date().toISOString() };
  servers.set(roomId, s);
  emitRoom(roomId, 'room:ipserver', pub(s));
  return res.json({ server: pub(s) });
});

router.delete('/:id/ipserver', auth, async (req, res) => {
  const roomId = String(req.params.id);
  const cur = servers.get(roomId);
  if (!cur) return res.json({ ok: true });
  if (String(cur.host_user_id) !== String(req.user.id)) return res.status(403).json({ error: 'Зөвхөн сервер нээсэн хүн хаана' });
  servers.delete(roomId);
  emitRoom(roomId, 'room:ipserver_gone', { room_id: roomId });
  return res.json({ ok: true });
});

function clearRoom(roomId) { servers.delete(String(roomId)); }
module.exports = { router, setIO, clearRoom, isMeshIp, KINDS, _servers: servers };
