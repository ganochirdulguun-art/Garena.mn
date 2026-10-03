'use strict';
// ── Мэдэгдлийн цэс 🔔 (2026-10-03, эзэн): баруун самбарын хонх → ирсэн DM (уншаагүй), найзын хүсэлт, өрөөний урилга,
//    бусад мэдэгдэл (найз зөвшөөрсөн г.м.) нэг дор. Өмнө нь DM-ийг зөвхөн нэр дээр дарж нээж байж хардаг байв.
//    Өгөгдөл app.js-ийн dmConversations / pendingRequests (глобал) + room:invited / friend:accepted hook (window.gxNotif.push).
(() => {
  const q = new URLSearchParams(location.search);
  if (q.get('mode') === 'room' || q.get('mode') === 'dm') return;   // зөвхөн үндсэн цонх
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const events = [];          // { id, type: 'invite'|'info', text, fromUsername, roomId, roomName, time, seen }
  const nameCache = new Map(); // userId → username (DM-ийн нэр unread тооноос ирэхгүй үед)
  let seq = 0, open = false;

  // ── Хонх (rail) + дүрс ──
  function ensureBell() {
    if ($('gx-rail-notif-btn')) return;
    const rail = document.querySelector('.gx-rail'); if (!rail) return;
    const sprite = document.querySelector('symbol#gx-i-friends')?.parentElement;
    if (sprite && !document.getElementById('gx-i-bell')) sprite.insertAdjacentHTML('beforeend', '<symbol id="gx-i-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></symbol>');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'gx-rail-i gx-rail-bell'; b.id = 'gx-rail-notif-btn'; b.title = 'Мэдэгдэл';
    b.innerHTML = '<svg><use href="#gx-i-bell"/></svg><span id="gx-rail-notif" class="gx-badge hidden">0</span>';
    rail.insertBefore(b, rail.firstChild);
    b.addEventListener('click', toggle);
  }

  // ── Өгөгдөл ──
  function dmItems() {
    const out = [];
    try {
      Object.entries(dmConversations || {}).forEach(([uid, c]) => {
        const n = Number(c?.unread || 0); if (n <= 0) return;
        const name = c.username || nameCache.get(uid) || lookupName(uid) || '';
        const last = (c.messages || []).slice(-1)[0];
        out.push({ uid, name, unread: n, preview: last?.text || '' });
      });
    } catch {}
    return out.sort((a, b) => b.unread - a.unread);
  }
  function lookupName(uid) {
    try { const f = (myFriends || []).find((x) => String(x.id) === String(uid)); if (f) return f.username; } catch {}
    try { const o = (_cachedOnlineUsers || []).find((x) => String(x.userId) === String(uid)); if (o) return o.username; } catch {}
    if (!nameCache.has(uid)) { nameCache.set(uid, ''); window.api?.getPlayerStatsById?.(uid).then((s) => { if (s?.username) { nameCache.set(uid, s.username); if (open) render(); } }).catch(() => {}); }
    return nameCache.get(uid) || '';
  }
  function requests() { try { return (pendingRequests || []).slice(); } catch { return []; } }
  // Кланы урилга — серверт хадгалагдана (офлайн байхад ирсэн ч харагдана)
  let clanInvites = [];
  async function refreshInvites() {
    try { const r = await window.api.request('get', '/clans/invites'); if (Array.isArray(r?.invites)) clanInvites = r.invites; } catch { /* хуучин сервер / сүлжээ — өмнөх жагсаалт хэвээр */ }
    badge(); if (open) render();
  }
  function total() {
    let dm = 0; try { dm = Object.values(dmConversations || {}).reduce((s, c) => s + Number(c?.unread || 0), 0); } catch {}
    return dm + requests().length + clanInvites.length + events.filter((e) => !e.seen).length;
  }
  function badge() {
    const n = total(); const b = $('gx-rail-notif'); if (!b) return;
    b.textContent = n > 99 ? '99+' : String(n); b.classList.toggle('hidden', n === 0);
    $('gx-rail-notif-btn')?.classList.toggle('has', n > 0);
  }

  // ── Самбар (gx.js-ийн drawer-ийг дахин ашиглана) ──
  function panel() {
    let p = $('gx-notif-panel');
    if (!p) { p = document.createElement('div'); p.id = 'gx-notif-panel'; p.className = 'gx-notif'; p.addEventListener('click', onClick); }
    return p;
  }
  function toggle() {
    const drawer = $('gx-drawer'); if (!drawer) return;
    if (open && drawer.classList.contains('open')) { $('gx-drawer-close')?.click(); open = false; return; }
    // өөр drawer нээлттэй бол хаагаад өөрийнхөө агуулгыг тавина
    if (drawer.classList.contains('open')) $('gx-drawer-close')?.click();
    document.querySelectorAll('.gx-rail-i').forEach((b) => b.classList.toggle('on', b.id === 'gx-rail-notif-btn'));
    $('gx-drawer-title').textContent = 'Мэдэгдэл';
    $('gx-drawer-soon')?.classList.add('hidden');
    const body = $('gx-drawer-body'); body.classList.remove('hidden');
    body.appendChild(panel());
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
    open = true; events.forEach((e) => { e.seen = true; }); render(); badge();
  }
  // Өөр drawer нээгдэх / хаагдахад манай самбар нуугдана
  const drawerEl = $('gx-drawer');
  if (drawerEl) new MutationObserver(() => {
    const isMine = $('gx-drawer-title')?.textContent === 'Мэдэгдэл' && drawerEl.classList.contains('open');
    if (!isMine) { open = false; $('gx-notif-panel')?.remove(); }
  }).observe(drawerEl, { attributes: true, childList: true, subtree: true, characterData: true });

  function render() {
    const p = $('gx-notif-panel'); if (!p) return;
    const dms = dmItems(), reqs = requests(), evs = events.slice().reverse(), invs = clanInvites.slice();
    const sec = (title, html, extra = '') => `<div class="gx-notif-sec"><div class="gx-notif-h"><b>${title}</b>${extra}</div>${html}</div>`;
    let html = '';
    if (dms.length) html += sec(`💬 Мессеж <i>${dms.reduce((s, d) => s + d.unread, 0)}</i>`, dms.map((d) => `<button type="button" class="gx-notif-i" data-dm="${esc(d.uid)}" data-name="${esc(d.name)}"><span class="gx-notif-av">${esc((d.name || '?').slice(0, 1).toUpperCase())}</span><span class="gx-notif-t"><b>${esc(d.name || `#${d.uid}`)}</b><small>${esc(d.preview || 'Шинэ мессеж')}</small></span><em>${d.unread}</em></button>`).join(''));
    if (reqs.length) html += sec(`👋 Найзын хүсэлт <i>${reqs.length}</i>`, reqs.map((r) => `<div class="gx-notif-i static"><span class="gx-notif-av">${esc(String(r.username || '?').slice(0, 1).toUpperCase())}</span><span class="gx-notif-t"><b>${esc(r.username)}</b><small>найз болохыг хүсэж байна</small></span><span class="gx-notif-act"><button type="button" class="btn btn-primary btn-sm" data-acc="${esc(r.id)}" data-name="${esc(r.username)}">Зөвшөөрөх</button><button type="button" class="btn btn-sm" data-dec="${esc(r.id)}">✕</button></span></div>`).join(''));
    if (invs.length) html += sec(`🛡 Кланы урилга <i>${invs.length}</i>`, invs.map((v) => `<div class="gx-notif-i static"><span class="gx-notif-av">🛡</span><span class="gx-notif-t"><b>${v.clan_tag ? `[${esc(v.clan_tag)}] ` : ''}${esc(v.clan_name)}</b><small>${esc(v.by_username || '')} таныг урьсан · ${ago(Date.parse(v.created_at))}</small></span><span class="gx-notif-act"><button type="button" class="btn btn-primary btn-sm" data-inv-acc="${esc(v.id)}">Нэгдэх</button><button type="button" class="btn btn-sm" data-inv-dec="${esc(v.id)}">✕</button></span></div>`).join(''));
    if (evs.length) html += sec('🔔 Мэдэгдэл', evs.map((e) => e.type === 'ac'
      ? `<div class="gx-notif-i static ac"><span class="gx-notif-av">${esc(e.icon || '🚨')}</span><span class="gx-notif-t"><b>${esc(e.text)}</b><small>${e.sub ? `${esc(e.sub)} · ` : ''}${ago(e.time)}</small></span><span class="gx-notif-act"><button type="button" class="btn btn-primary btn-sm" data-ac-open="${esc(e.caseId)}" data-ev="${e.id}">${esc(e.btn || 'Шалгах')}</button><button type="button" class="btn btn-sm" data-rm="${e.id}">✕</button></span></div>`
      : e.type === 'clan'
      ? `<div class="gx-notif-i static"><span class="gx-notif-av">${esc(e.icon || '🛡')}</span><span class="gx-notif-t"><b>${esc(e.text)}</b><small>${e.sub ? `${esc(e.sub)} · ` : ''}${ago(e.time)}</small></span><span class="gx-notif-act"><button type="button" class="btn btn-primary btn-sm" data-clan="${esc(e.clanId)}">${esc(e.btn || 'Нээх')}</button><button type="button" class="btn btn-sm" data-rm="${e.id}">✕</button></span></div>`
      : e.type === 'invite'
      ? `<div class="gx-notif-i static"><span class="gx-notif-av">🎮</span><span class="gx-notif-t"><b>${esc(e.fromUsername)}</b><small>«${esc(e.roomName)}» өрөөнд урив · ${ago(e.time)}</small></span><span class="gx-notif-act"><button type="button" class="btn btn-primary btn-sm" data-join="${esc(e.roomId)}" data-ev="${e.id}">Нэгдэх</button><button type="button" class="btn btn-sm" data-rm="${e.id}">✕</button></span></div>`
      : `<div class="gx-notif-i static"><span class="gx-notif-av">${esc(e.icon || 'ℹ️')}</span><span class="gx-notif-t"><b>${esc(e.text)}</b><small>${ago(e.time)}</small></span><span class="gx-notif-act"><button type="button" class="btn btn-sm" data-rm="${e.id}">✕</button></span></div>`).join(''),
      `<button type="button" class="gx-notif-clear" data-clear>Бүгдийг арилгах</button>`);
    if (!html) html = '<div class="gx-notif-empty"><div class="gx-notif-empty-ico">🔔</div><b>Шинэ мэдэгдэл алга</b><span>Ирсэн мессеж, найзын хүсэлт, өрөөний урилга энд харагдана.</span></div>';
    p.innerHTML = html;
  }
  function ago(t) { const s = Math.max(0, (Date.now() - Number(t || Date.now())) / 1000); return s < 60 ? 'саяхан' : s < 3600 ? `${Math.floor(s / 60)} мин` : s < 86400 ? `${Math.floor(s / 3600)} цаг` : `${Math.floor(s / 86400)} өдөр`; }

  async function onClick(e) {
    const dm = e.target.closest('[data-dm]'); if (dm) { try { openDM(dm.dataset.dm, dm.dataset.name || undefined); } catch {} return; }
    const acc = e.target.closest('[data-acc]'); if (acc) { acc.disabled = true; try { await acceptFriend(acc.dataset.acc, acc.dataset.name); } catch {} render(); badge(); return; }
    const dec = e.target.closest('[data-dec]'); if (dec) { dec.disabled = true; try { await declineFriend(dec.dataset.dec); } catch {} render(); badge(); return; }
    const join = e.target.closest('[data-join]');
    if (join) {
      join.disabled = true; const rid = join.dataset.join; remove(join.dataset.ev);
      try { await window.api.joinRoom(rid, null); const rooms = await window.api.getRooms(); const room = rooms.find((r) => String(r.id) === String(rid)); if (room) enterRoom(room.id, room.name, room.game_type, false, room.host_id); else showToast('Өрөө олдсонгүй', 'warning'); }
      catch (err) { showToast(`Нэгдэхэд алдаа: ${err.message}`, 'error'); }
      return;
    }
    const ia = e.target.closest('[data-inv-acc], [data-inv-dec]');
    if (ia) {
      ia.disabled = true; const acc = ia.hasAttribute('data-inv-acc'); const id = acc ? ia.dataset.invAcc : ia.dataset.invDec;
      try {
        const r = await window.api.request('post', `/clans/invites/${id}/${acc ? 'accept' : 'decline'}`);
        showToast(acc ? `🎉 «${r.clan_name || 'Клан'}» кланд нэгдлээ` : 'Урилгыг татгалзлаа', acc ? 'success' : 'info');
        if (acc) { try { window.gxClans?.loadMine?.(); } catch {} }
      } catch (err) { showToast(err?.message || 'Алдаа гарлаа', 'error'); }
      await refreshInvites(); return;
    }
    const aco = e.target.closest('[data-ac-open]');
    if (aco) { remove(aco.dataset.ev); try { $('gx-drawer-close')?.click(); window.gxAC?.openCase(aco.dataset.acOpen); } catch {} return; }
    const cl = e.target.closest('[data-clan]');
    if (cl) { try { $('gx-drawer-close')?.click(); showTab('clans'); setTimeout(() => window.gxClans?.openClan?.(cl.dataset.clan), 150); } catch {} return; }
    const rm = e.target.closest('[data-rm]'); if (rm) { remove(rm.dataset.rm); return; }
    if (e.target.closest('[data-clear]')) { events.length = 0; render(); badge(); }
  }
  function remove(id) { const i = events.findIndex((x) => String(x.id) === String(id)); if (i >= 0) events.splice(i, 1); render(); badge(); }

  // app.js-ээс дуудна: room:invited / friend:accepted / бусад
  function push(ev) {
    const e = { id: ++seq, time: Date.now(), seen: open, ...ev };
    if (e.type === 'invite') { const i = events.findIndex((x) => x.type === 'invite' && String(x.roomId) === String(e.roomId)); if (i >= 0) events.splice(i, 1); }
    events.push(e); if (events.length > 50) events.shift();
    if (open) render(); badge();
  }

  setInterval(() => { ensureBell(); badge(); if (open) render(); }, 1500);
  setInterval(refreshInvites, 5 * 60 * 1000);
  setTimeout(refreshInvites, 3000);
  ensureBell();
  window.gxNotif = { push, toggle, total, refreshInvites, _events: events, _setInvites: (a) => { clanInvites = a; badge(); if (open) render(); } };
})();
