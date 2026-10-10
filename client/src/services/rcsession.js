'use strict';
// ── Garena.mn reconnect (GProxy++ маяг, 2026-10-10, эзэн: «сүлжээний тасралтад reconnect хий») ──
// Нэг тоглоомын холболт = session, 2 хөлтэй: A = joiner тал, B = хост тал. Хөл тасрахад (socket хаагдахад) нөгөө хөлийг
// ХААХГҮЙ, holdMs хүлээнэ; тэр хооронд нөгөө хөлөөс ирсэн байтууд абсолют offset-той ring buffer-т хадгалагдана.
// Дахин холбогдоход peer «миний хүлээн авсан нийт байт» (recv)-аа хэлнэ → энд тэр offset-оос replay; энд «чамаас хүлээн
// авсан нийт байт»-аа хэлнэ → peer тэр offset-оос дахин илгээнэ. Байт алдагдахгүй, давхардахгүй, дараалал хадгалагдана.
// rc flag-гүй (хуучин клиент) хөл тасрахад session тэр даруй хаагдана (өмнөх зан хэвээр).
// ⚠ ЭНЭ ФАЙЛ hostbot/rcsession.js ба client/src/services/rcsession.js хоёрт ИЖИЛ (relay сервер + хост клиентийн mesh listener).
const EventEmitter = require('events');

class Ring {
  constructor(max) { this.max = max; this.chunks = []; this.start = 0; this.end = 0; }   // [start, end) — хадгалагдсан абсолют offset
  push(buf) {
    if (!buf || !buf.length) return;
    this.chunks.push(buf); this.end += buf.length;
    while (this.end - this.start > this.max && this.chunks.length) { const c = this.chunks.shift(); this.start += c.length; }
  }
  /** off-оос хойшхи бүх байт (Buffer[]); off буфераас өмнө (хаягдсан) бол null = сэргээх боломжгүй. */
  from(off) {
    if (off < this.start || off > this.end) return null;
    const out = []; let pos = this.start;
    for (const c of this.chunks) { const e = pos + c.length; if (e > off) out.push(off > pos ? c.subarray(off - pos) : c); pos = e; }
    return out;
  }
}

class RcSession extends EventEmitter {
  /** @param {{id:string, holdMs?:number, ringBytes?:number, log?:Function}} o */
  constructor({ id, holdMs = 55000, ringBytes = 2 * 1024 * 1024, log = () => {} } = {}) {
    super();
    this.id = String(id); this.holdMs = holdMs; this.log = log; this.closed = false; this.closeReason = null;
    const leg = () => ({ sock: null, rc: false, recv: 0, ring: new Ring(ringBytes), hold: null, attachedOnce: false });
    this.legs = { A: leg(), B: leg() };
  }
  other(name) { return name === 'A' ? 'B' : 'A'; }
  /**
   * Хөлд socket холбоно. resume=true бол өмнө холбогдож байсан хөлийг сэргээнэ (recv = peer-ийн хүлээн авсан нийт байт).
   * preface(r) → replay-ийн өмнө бичих header (сэргээхэд заавал: эс бөгөөс peer replay байтыг header гэж андуурна).
   * → { ok, recv (энэ peer-ээс хүлээн авсан нийт — peer үүнээс хойшхийг дахин илгээнэ) } эсвэл { ok:false, error }
   */
  attach(name, sock, { rc = false, recv = 0, leftover = null, resume = false, preface = null } = {}) {
    const leg = this.legs[name], other = this.legs[this.other(name)];
    if (!leg) return { ok: false, error: 'bad-leg' };
    if (this.closed) return { ok: false, error: 'closed' };
    if (resume && !leg.attachedOnce) return { ok: false, error: 'no-session' };
    const rep = other.ring.from(resume ? Math.max(0, Number(recv) || 0) : other.ring.start);
    if (!rep) return { ok: false, error: 'gap' };   // peer хэт хоцорсон — буферт байхгүй
    if (leg.sock && leg.sock !== sock) { const old = leg.sock; leg.sock = null; try { old.destroy(); } catch {} }   // хуучин (үхсэн) socket
    if (leg.hold) { clearTimeout(leg.hold); leg.hold = null; }
    leg.rc = !!rc; leg.sock = sock; leg.attachedOnce = true;
    try { sock.setNoDelay(true); } catch {}
    if (preface) { try { sock.write(preface({ ok: true, recv: leg.recv })); } catch {} }   // header (rc хариу) replay-ийн ӨМНӨ
    for (const b of rep) { try { sock.write(b); } catch {} }   // нөгөө хөлөөс хүлээн аваагүй байтууд
    sock.on('data', (d) => this._onData(name, sock, d));
    const gone = () => { if (leg.sock !== sock) return; leg.sock = null; this._legGone(name); };
    sock.on('close', gone); sock.on('error', gone);
    if (leftover && leftover.length) this._onData(name, sock, leftover);
    this.emit('attach', name, sock, resume);
    if (resume) this.log(`session ${this.id}: ${name} сэргэв (replay ${rep.reduce((s, b) => s + b.length, 0)}B)`);
    return { ok: true, recv: leg.recv };
  }
  _onData(name, sock, d) {
    const leg = this.legs[name]; if (leg.sock !== sock || this.closed) return;
    leg.recv += d.length; leg.ring.push(Buffer.from(d));
    this.emit(name === 'A' ? 'joinerdata' : 'hostdata', d);
    const o = this.legs[this.other(name)];
    if (o.sock) { try { o.sock.write(d); } catch {} }
  }
  _legGone(name) {
    if (this.closed) return;
    const leg = this.legs[name];
    if (!leg.rc) { this.close(`leg-${name}-closed`); return; }
    this.log(`session ${this.id}: ${name} тасарлаа — ${Math.round(this.holdMs / 1000)}с хүлээнэ`);
    leg.hold = setTimeout(() => this.close(`hold-timeout-${name}`), this.holdMs);
    if (leg.hold.unref) leg.hold.unref();
    this.emit('hold', name);
  }
  /** Хөл одоо холбоотой эсэх */
  attached(name) { return !!this.legs[name].sock; }
  close(reason = 'close') {
    if (this.closed) return; this.closed = true; this.closeReason = reason;
    for (const l of [this.legs.A, this.legs.B]) { if (l.hold) clearTimeout(l.hold); const s = l.sock; l.sock = null; try { s && s.destroy(); } catch {} }
    this.emit('close', reason);
  }
}

/** Handshake-ийн дараа peer-д буцаах мөр: {"t":"rc","session":…,"recv":…} эсвэл алдаа */
function rcReply(session, r) { return JSON.stringify(r.ok ? { t: 'rc', session: String(session), recv: r.recv } : { t: 'rc', session: String(session), error: r.error }) + '\n'; }

module.exports = { Ring, RcSession, rcReply };
