'use strict';
// ── Party (2026-10-08, эзэн: «Party чат + урих») — баруун самбарын Party drawer ──
//  • Тоглогчийн нэр дээр баруун товч → «🎉 Party-д урих» (gx-channels.js) эсвэл энд онлайн тоглогчдоос «Урих».
//  • Урилга: toast + 🔔 (gx-notif 'party' төрөл) → Нэгдэх / Татгалзах.
//  • Гишүүд: 👑 удирдагч, онлайн цэг, одоо аль Room-д (→ «Очих»), удирдагч: хасах / удирдлага шилжүүлэх.
//  • Party чат (серверт сүүлийн 60 мессеж, санах ойд).
// Сервер: routes/party.js (socket party:*). Зөвхөн үндсэн цонхонд UI; урих нь өрөөний цонхноос ч ажиллана.
(() => {
  const mode = new URLSearchParams(location.search).get('mode');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const toast = (m, t = 'info', d = 4000) => { try { showToast(m, t, d); } catch { console.log(m); } };
  const me = () => String((typeof currentUser !== 'undefined' && currentUser?.id) || '');
  const ack = (ev, data, ms = 8000) => new Promise((res) => {
    const s = (typeof socket !== 'undefined' && socket) || null;
    if (!s?.connected) return res({ ok: false, error: 'Сервертэй холбогдоогүй байна' });
    let done = false; const t = setTimeout(() => { if (!done) { done = true; res({ ok: false, error: 'Сервер хариу өгсөнгүй' }); } }, ms);
    s.emit(ev, data, (r) => { if (done) return; done = true; clearTimeout(t); res(r || { ok: false, error: 'Хариу ирсэнгүй' }); });
  });

  // Урих — аль ч цонхноос (баруун товчны цэс)
  async function invite(userId, name) {
    const r = await ack('party:invite', { userId: String(userId) });
    if (r.ok) toast(`🎉 ${name || 'Тоглогч'}-ийг Party-д урилаа — хариуг хүлээж байна`, 'success');
    else toast(r.error || 'Урьж чадсангүй', 'error');
    if (r.state) { state = r.state; paint(); }
    return r;
  }
  window.gxPartyInvite = invite;
  if (mode) return;   // доорх UI зөвхөн үндсэн цонхонд

  let state = null;           // { id, leader_id, max, members[], history[] }
  let online = [];            // lobby:online_users
  let unread = 0, open = false, boundSock = null, filter = '';
  const invitesSeen = new Set();

  function bind(s) {
    if (!s || s === boundSock) return; boundSock = s;
    s.on('party:state', (st) => { state = st || null; paint(); });
    s.on('party:msg', (m) => {
      if (!state) return;
      state.history = [...(state.history || []), m].slice(-60);
      if (!open && !m.sys && String(m.user_id) !== me()) unread++;
      paint();
    });
    s.on('party:invited', (d = {}) => {
      if (!d.invite_id || invitesSeen.has(d.invite_id)) return; invitesSeen.add(d.invite_id);
      try { window.gxNotif?.push({ type: 'party', inviteId: d.invite_id, fromName: d.from_name, size: d.size, max: d.max }); } catch {}
      toast(`🎉 ${d.from_name} таныг Party-д урьж байна — 🔔 мэдэгдлээс «Нэгдэх» дарна уу`, 'info', 7000);
    });
    s.on('party:declined', ({ name } = {}) => toast(`${name || 'Тоглогч'} Party-гийн урилгаас татгалзлаа`, 'info'));
    s.on('party:kicked', () => { toast('Таныг Party-гаас хаслаа', 'warning'); state = null; paint(); });
    s.on('lobby:online_users', (list) => { online = Array.isArray(list) ? list : []; if (open && !state) paint(); });
    s.on('connect', () => refresh());
    refresh();
  }
  setInterval(() => { try { if (typeof socket !== 'undefined' && socket) bind(socket); } catch {} }, 1000);
  async function refresh() { const r = await ack('party:state', {}); if (r.ok) { state = r.state || null; paint(); } }
  setInterval(() => { if (open && state) refresh(); }, 10000);   // гишүүдийн Room/онлайн төлөв

  async function accept(inviteId) {
    const r = await ack('party:accept', { inviteId });
    if (r.ok) { state = r.state; toast('🎉 Party-д нэгдлээ', 'success'); paint(); try { window.gxOpenDrawer?.('party'); } catch {} }
    else toast(r.error || 'Нэгдэж чадсангүй', 'error');
    return r;
  }
  async function decline(inviteId) { await ack('party:decline', { inviteId }); }
  window.gxParty = { invite, accept, decline, mount, setOpen, refresh, get state() { return state; } };

  function setOpen(v) { open = !!v; if (open) { unread = 0; refresh(); } badge(); }
  function badge() {
    const b = document.querySelector('.gx-rail-i[data-drawer="party"]'); if (!b) return;
    b.title = state ? `Party (${state.members.length}/${state.max})` : 'Party — найзуудтайгаа баг болох';
    let i = b.querySelector('.gx-badge'); if (!i) { i = document.createElement('span'); i.className = 'gx-badge hidden'; b.appendChild(i); }
    i.textContent = String(unread); i.classList.toggle('hidden', !unread);
    b.classList.toggle('gx-party-on', !!state);
  }

  let host = null;
  function mount(el) { host = el; paint(); }
  const roomName = (id) => { try { return (typeof roomsCache !== 'undefined' && roomsCache[id]?.name) || `Room #${id}`; } catch { return `Room #${id}`; } };
  const time = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  function paint() {
    badge();
    if (!host || !open) return;
    const myId = me();
    if (!state) {
      const q = filter.toLowerCase();
      const list = online.filter((u) => String(u.userId) !== myId && (!q || String(u.username || '').toLowerCase().includes(q))).slice(0, 40);
      host.innerHTML = `<div class="gxp">
        <div class="gxp-intro"><div class="gxp-ico">🎉</div><b>Party — найзуудтайгаа баг бол</b>
          <p>Party-д 5 хүртэл хүн нэгдэж, тусдаа чатаар ярилцан, нэг Room-д цуглана. Тоглогчийн нэр дээр <b>баруун товч → «Party-д урих»</b>, эсвэл доороос урина.</p></div>
        <input class="gxp-search" id="gxp-search" type="text" placeholder="Онлайн тоглогч хайх…" value="${esc(filter)}">
        <div class="gxp-online">${list.length ? list.map((u) => `<div class="gxp-ou"><span class="gxp-dot on"></span><b>${esc(u.username)}</b><button type="button" class="btn btn-sm btn-primary" data-pinv="${esc(u.userId)}" data-name="${esc(u.username)}">Урих</button></div>`).join('') : '<div class="gxp-muted">Онлайн тоглогч олдсонгүй</div>'}</div>
      </div>`;
      const s = $('gxp-search'); if (s) { s.oninput = () => { filter = s.value; const pos = s.selectionStart; paint(); const s2 = $('gxp-search'); if (s2) { s2.focus(); s2.setSelectionRange(pos, pos); } }; }
      return;
    }
    const amLeader = String(state.leader_id) === myId;
    const members = state.members.map((m) => {
      const self = String(m.user_id) === myId;
      const where = m.online ? (m.room_id ? `📍 ${esc(roomName(m.room_id))}` : 'Лоббид') : 'Офлайн';
      const go = !self && m.room_id && String(window.gxRoom?.roomId || '') !== String(m.room_id) ? `<button type="button" class="btn btn-sm" data-pgo="${esc(m.room_id)}" title="Энэ гишүүний Room руу очих">Очих</button>` : '';
      const lead = amLeader && !self ? `<button type="button" class="gxp-mini" data-ppro="${esc(m.user_id)}" title="Удирдлага шилжүүлэх">👑</button><button type="button" class="gxp-mini danger" data-pkick="${esc(m.user_id)}" data-name="${esc(m.username)}" title="Party-гаас хасах">✕</button>` : '';
      return `<div class="gxp-m"><span class="gxp-dot ${m.online ? 'on' : ''}"></span><div class="gxp-mn"><b>${m.leader ? '👑 ' : ''}${esc(m.username)}${self ? ' <i>(Та)</i>' : ''}</b><small>${where}</small></div>${go}${lead}</div>`;
    }).join('');
    const msgs = (state.history || []).map((m) => m.sys
      ? `<div class="gxp-sys">${esc(m.text)}</div>`
      : `<div class="gxp-msg${String(m.user_id) === myId ? ' mine' : ''}"><span class="gxp-t">${time(m.time)}</span><b>${esc(m.username)}</b><span>${esc(m.text)}</span></div>`).join('');
    const keep = $('gxp-input')?.value || '';
    host.innerHTML = `<div class="gxp">
      <div class="gxp-h"><b>Party · ${state.members.length}/${state.max}</b><button type="button" class="btn btn-sm" id="gxp-leave">Гарах</button></div>
      <div class="gxp-ms">${members}</div>
      ${state.members.length < state.max ? '<div class="gxp-hint">➕ Урих: тоглогчийн нэр дээр баруун товч → «Party-д урих»</div>' : ''}
      <div class="gxp-chat" id="gxp-chat">${msgs || '<div class="gxp-muted">Party-ийн чат — зөвхөн гишүүд харна</div>'}</div>
      <form class="gxp-form" id="gxp-form"><input id="gxp-input" type="text" maxlength="500" placeholder="Party-д бичих…" autocomplete="off"><button type="submit" class="btn btn-primary btn-sm">Илгээх</button></form>
    </div>`;
    const inp = $('gxp-input'); if (inp) { inp.value = keep; if (keep || document.activeElement === document.body) inp.focus(); }
    const ch = $('gxp-chat'); if (ch) ch.scrollTop = ch.scrollHeight;
  }

  document.addEventListener('click', async (e) => {
    if (!host || !host.contains(e.target)) return;
    const inv = e.target.closest('[data-pinv]'); if (inv) { inv.disabled = true; await invite(inv.dataset.pinv, inv.dataset.name); inv.disabled = false; return; }
    if (e.target.closest('#gxp-leave')) {
      let yes = true; try { yes = await showConfirm('Та итгэлтэй байна уу?', 'Party-гаас гарах уу?', { ok: 'Тийм', cancel: 'Үгүй' }); } catch {}
      if (yes) { const r = await ack('party:leave', {}); if (r.ok) { state = null; paint(); } }
      return;
    }
    const kick = e.target.closest('[data-pkick]');
    if (kick) {
      let yes = true; try { yes = await showConfirm('Та итгэлтэй байна уу?', `${kick.dataset.name}-ийг Party-гаас хасах уу?`, { ok: 'Тийм', cancel: 'Үгүй' }); } catch {}
      if (yes) { const r = await ack('party:kick', { userId: kick.dataset.pkick }); if (!r.ok) toast(r.error || 'Алдаа', 'error'); }
      return;
    }
    const pro = e.target.closest('[data-ppro]'); if (pro) { const r = await ack('party:promote', { userId: pro.dataset.ppro }); if (!r.ok) toast(r.error || 'Алдаа', 'error'); return; }
    const go = e.target.closest('[data-pgo]');
    if (go) {
      const id = go.dataset.pgo; const r = (typeof roomsCache !== 'undefined' && roomsCache[id]) || {};
      try { await joinRoom(id, r.name || roomName(id), r.game_type || 'Warcraft III: The Frozen Throne', !!r.has_password, r.host_id); } catch (err) { toast(err?.message || 'Очиж чадсангүй', 'error'); }
    }
  });
  document.addEventListener('submit', async (e) => {
    if (e.target?.id !== 'gxp-form') return;
    e.preventDefault();
    const inp = $('gxp-input'); const text = (inp?.value || '').trim(); if (!text) return;
    inp.value = '';
    const r = await ack('party:msg', { text });
    if (!r.ok) { toast(r.error || 'Илгээж чадсангүй', 'error'); inp.value = text; }
  });
})();
