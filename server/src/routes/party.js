'use strict';
// ── Party (2026-10-08, эзэн: «Party чат + урих»): найзуудтайгаа баг болж ярилцаж, нэг Room-д цуглах ──
//  • Тоглогчийн нэр дээр баруун товч → «Party-д урих». Party байхгүй бол урьсан хүн удирдагч болж party үүснэ.
//  • Урилга 5 мин хүчинтэй; 🔔 болон toast-оор ирнэ; нэгдэхэд өмнөх party-гаас автоматаар гарна.
//  • Гишүүд (≤ PARTY_MAX, анхдагч 5 — WC3 багийн хэмжээ): онлайн эсэх, одоо аль Room-д байгаа (→ «Очих»), party чат.
//  • Удирдагч: гишүүн хасах, удирдлага шилжүүлэх. Удирдагч гарвал дараагийн гишүүн удирдагч болно.
//  • Санах ойд хадгална (сервер restart-д party-ууд арилна) — socket room `party:<id>`, хэрэглэгчийн бүх цонх нэгдэнэ.
const MAX = Math.max(2, Math.min(10, Number(process.env.PARTY_MAX) || 5));
const INVITE_TTL_MS = 5 * 60 * 1000;
const HISTORY_MAX = 60;

let _io = null;
let _roomOf = () => null;      // userId → { id, name } | null (одоогийн Room)
let _isOnline = () => false;   // userId → bool

const parties = new Map();     // pid → { id, leaderId, members: Map(uid → { username }), history: [], createdAt }
const userParty = new Map();   // uid → pid
const invites = new Map();     // iid → { id, pid, fromId, fromName, toId, at }
let seq = 0, iseq = 0;

function setup({ io, roomOf, isOnline } = {}) {
  if (io) _io = io;
  if (roomOf) _roomOf = roomOf;
  if (isOnline) _isOnline = isOnline;
}

const S = (v) => String(v ?? '');
const emitTo = (room, ev, data) => { try { _io?.to(room).emit(ev, data); } catch {} };
const joinSockets = (uid, pid) => { try { _io?.in(`user:${uid}`).socketsJoin(`party:${pid}`); } catch {} };
const leaveSockets = (uid, pid) => { try { _io?.in(`user:${uid}`).socketsLeave(`party:${pid}`); } catch {} };

function publicState(p) {
  if (!p) return null;
  const members = [...p.members.entries()].map(([uid, m]) => {
    const room = (() => { try { return _roomOf(uid); } catch { return null; } })();
    return { user_id: uid, username: m.username, leader: uid === p.leaderId, online: !!(() => { try { return _isOnline(uid); } catch { return false; } })(), room_id: room?.id ?? null, room_name: room?.name || '' };
  });
  return { id: p.id, leader_id: p.leaderId, max: MAX, members, history: p.history.slice(-HISTORY_MAX) };
}
function broadcast(p) { emitTo(`party:${p.id}`, 'party:state', publicState(p)); }
function sys(p, text) {
  const m = { sys: true, text, time: Date.now() };
  p.history.push(m); if (p.history.length > HISTORY_MAX) p.history.shift();
  emitTo(`party:${p.id}`, 'party:msg', m);
}

function partyOf(uid) { const pid = userParty.get(S(uid)); return pid ? parties.get(pid) || null : null; }

function create(uid, username) {
  const p = { id: `p${++seq}${Date.now().toString(36)}`, leaderId: S(uid), members: new Map([[S(uid), { username: S(username) }]]), history: [], createdAt: Date.now() };
  parties.set(p.id, p); userParty.set(S(uid), p.id); joinSockets(S(uid), p.id);
  return p;
}

function sweepInvites() { const now = Date.now(); for (const [k, v] of invites) if (now - v.at > INVITE_TTL_MS || !parties.has(v.pid)) invites.delete(k); }

/** Урих — Party байхгүй бол үүсгэнэ. */
function invite({ fromId, fromName, toId }) {
  const from = S(fromId), to = S(toId);
  if (!to || to === from) return { ok: false, error: 'Өөрийгөө урих боломжгүй' };
  if (!_isOnline(to)) return { ok: false, error: 'Тэр тоглогч одоо онлайн биш байна' };
  let p = partyOf(from);
  if (p && p.members.has(to)) return { ok: false, error: 'Аль хэдийн таны Party-д байна' };
  if (p && p.members.size >= MAX) return { ok: false, error: `Party дүүрсэн (${MAX} хүн)` };
  sweepInvites();
  if (!p) p = create(from, fromName);
  for (const v of invites.values()) if (v.pid === p.id && v.toId === to) { v.at = Date.now(); emitTo(`user:${to}`, 'party:invited', { invite_id: v.id, from_id: from, from_name: S(fromName), size: p.members.size, max: MAX }); return { ok: true, invite_id: v.id, state: publicState(p) }; }
  const inv = { id: `i${++iseq}${Date.now().toString(36)}`, pid: p.id, fromId: from, fromName: S(fromName), toId: to, at: Date.now() };
  invites.set(inv.id, inv);
  emitTo(`user:${to}`, 'party:invited', { invite_id: inv.id, from_id: from, from_name: inv.fromName, size: p.members.size, max: MAX });
  return { ok: true, invite_id: inv.id, state: publicState(p) };
}

function accept({ userId, username, inviteId }) {
  sweepInvites();
  const uid = S(userId); const inv = invites.get(S(inviteId));
  if (!inv || inv.toId !== uid) return { ok: false, error: 'Урилгын хугацаа дууссан эсвэл хүчингүй болсон' };
  const p = parties.get(inv.pid);
  invites.delete(inv.id);
  if (!p) return { ok: false, error: 'Party задарсан байна' };
  if (p.members.has(uid)) return { ok: true, state: publicState(p) };
  if (p.members.size >= MAX) return { ok: false, error: `Party дүүрсэн (${MAX} хүн)` };
  if (partyOf(uid)) leave({ userId: uid, reason: 'switch' });
  p.members.set(uid, { username: S(username) });
  userParty.set(uid, p.id); joinSockets(uid, p.id);
  sys(p, `🎉 ${S(username)} Party-д нэгдлээ`);
  broadcast(p);
  return { ok: true, state: publicState(p) };
}

function decline({ userId, username, inviteId }) {
  const inv = invites.get(S(inviteId));
  if (!inv || inv.toId !== S(userId)) return { ok: true };
  invites.delete(inv.id);
  emitTo(`user:${inv.fromId}`, 'party:declined', { name: S(username) });
  return { ok: true };
}

function leave({ userId, reason = 'leave' }) {
  const uid = S(userId); const p = partyOf(uid);
  if (!p) return { ok: true };
  const name = p.members.get(uid)?.username || '';
  p.members.delete(uid); userParty.delete(uid); leaveSockets(uid, p.id);
  emitTo(`user:${uid}`, 'party:state', null);
  if (!p.members.size) { parties.delete(p.id); for (const [k, v] of invites) if (v.pid === p.id) invites.delete(k); return { ok: true }; }
  if (p.leaderId === uid) { p.leaderId = p.members.keys().next().value; sys(p, `👑 ${p.members.get(p.leaderId)?.username || ''} одоо удирдагч`); }
  sys(p, reason === 'kick' ? `🚪 ${name} Party-гаас хасагдлаа` : `👋 ${name} Party-гаас гарлаа`);
  broadcast(p);
  return { ok: true };
}

function kick({ leaderId, targetId }) {
  const p = partyOf(leaderId);
  if (!p || p.leaderId !== S(leaderId)) return { ok: false, error: 'Зөвхөн удирдагч хасна' };
  if (!p.members.has(S(targetId)) || S(targetId) === S(leaderId)) return { ok: false, error: 'Гишүүн олдсонгүй' };
  emitTo(`user:${S(targetId)}`, 'party:kicked', {});
  return leave({ userId: targetId, reason: 'kick' });
}

function promote({ leaderId, targetId }) {
  const p = partyOf(leaderId);
  if (!p || p.leaderId !== S(leaderId)) return { ok: false, error: 'Зөвхөн удирдагч шилжүүлнэ' };
  if (!p.members.has(S(targetId))) return { ok: false, error: 'Гишүүн олдсонгүй' };
  p.leaderId = S(targetId);
  sys(p, `👑 ${p.members.get(p.leaderId)?.username || ''} одоо удирдагч`);
  broadcast(p);
  return { ok: true };
}

function message({ userId, username, text }) {
  const p = partyOf(userId);
  if (!p) return { ok: false, error: 'Та Party-д байхгүй байна' };
  const t = S(text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500);
  if (!t) return { ok: false, error: 'Хоосон мессеж' };
  const m = { user_id: S(userId), username: S(username), text: t, time: Date.now() };
  p.history.push(m); if (p.history.length > HISTORY_MAX) p.history.shift();
  emitTo(`party:${p.id}`, 'party:msg', m);
  return { ok: true };
}

function stateFor(userId) { return publicState(partyOf(userId)); }

/** Socket бүртгэгдэхэд (lobby:register) party-ийн өрөөнд нэгдүүлнэ — дахин холбогдсон ч party хэвээр. */
function onRegister(socket, userId) { const p = partyOf(userId); if (p) { try { socket.join(`party:${p.id}`); } catch {} } }

module.exports = { MAX, setup, invite, accept, decline, leave, kick, promote, message, stateFor, onRegister, _parties: parties, _userParty: userParty, _invites: invites };
