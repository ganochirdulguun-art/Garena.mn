// ══════════════════════════════════════════════════════════════
// Нийтийн өрөөнүүд «Room 1–20» + Moderator + Эзний самбар (2026-10-02, Garena Plus маяг)
//  • Лобби: WC3 Room 1–20 картууд (N/200, ⭐ Premium нөөц slot), нэг товшилтоор орно.
//  • Өрөө: чатын дээд бэхэлсэн зарлал + «Moderator авах»; LAN тоглоом нээх эрх зөвхөн Moderator/ажилтан.
//  • Ажилтан (эзэн/админ): гишүүдийн AFK хугацаа, шалтгаантай kick; эзний самбар (идэвх, хүсэлт, Moderator, kick лог).
//  • Эзэн/админы апп-д реклам харуулахгүй — оронд нь эзний цэс.
// ══════════════════════════════════════════════════════════════
(function gxChannels() {
  const mode = new URLSearchParams(location.search).get('mode');
  const $ = (id) => document.getElementById(id);
  const esc = (t) => (typeof escHtml === 'function' ? escHtml(t ?? '') : String(t ?? ''));
  const errMsg = (e) => String(e?.message || e || 'Алдаа гарлаа').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const api = (m, p, b) => window.api.request(m, p, b);
  const toast = (m, t = 'info', ms = 4000) => { try { showToast(m, t, ms); } catch {} };

  // ── Текст оруулах цонх (бүх горимд) ──
  window.gxPrompt = function gxPrompt(title, label, value = '', { multiline = false, okText = 'Илгээх' } = {}) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'gxp-back';
      wrap.innerHTML = `<div class="gxp" role="dialog" aria-modal="true"><h3></h3><label></label>
        ${multiline ? '<textarea class="input gxp-in" rows="7"></textarea>' : '<input class="input gxp-in" type="text" maxlength="300" />'}
        <div class="gxp-act"><button type="button" class="btn gxp-no">Болих</button><button type="button" class="btn btn-primary gxp-ok"></button></div></div>`;
      wrap.querySelector('h3').textContent = title;
      wrap.querySelector('label').textContent = label;
      wrap.querySelector('.gxp-ok').textContent = okText;
      const inp = wrap.querySelector('.gxp-in'); inp.value = value || '';
      const done = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelector('.gxp-no').addEventListener('click', () => done(null));
      wrap.querySelector('.gxp-ok').addEventListener('click', () => done(inp.value));
      wrap.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(null); if (e.key === 'Enter' && !multiline) done(inp.value); });
      document.body.appendChild(wrap); setTimeout(() => inp.focus(), 30);
    });
  };

  let me = null;   // /roles/me — { role, staff, owner, can_host_channel, pending, pending_count }
  async function loadMe() { try { me = await api('get', '/roles/me'); } catch { me = null; } return me; }
  async function requestModerator() {
    const note = await window.gxPrompt('🛡 Moderator авах хүсэлт', 'Moderator нь нийтийн Room-д LAN тоглоом нээж бусдыг тоглуулна. Өөрийнхөө тухай товч бичнэ үү (заавал биш):', '', { okText: 'Хүсэлт илгээх' });
    if (note == null) return false;
    try { await api('post', '/roles/request', { note }); toast('✅ Хүсэлт илгээгдлээ — эзэн шалгаад батална', 'success', 5000); await loadMe(); return true; }
    catch (e) { toast(errMsg(e), 'warning', 5000); return false; }
  }
  window.gxRequestModerator = requestModerator;
  const onSocket = (fn) => { const t = setInterval(() => { if (typeof socket !== 'undefined' && socket) { clearInterval(t); fn(socket); } }, 500); };
  const fmtAgo = (ts) => {
    if (!ts) return '—'; const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'дөнгөж сая'; if (s < 3600) return `${Math.floor(s / 60)}м өмнө`; if (s < 86400) return `${Math.floor(s / 3600)}ц өмнө`; return `${Math.floor(s / 86400)} өдөр өмнө`;
  };
  const fmtHours = (sec) => { const h = (Number(sec) || 0) / 3600; return h >= 10 ? `${Math.round(h)}ц` : `${h.toFixed(1)}ц`; };

  if (mode === 'room') return roomMode();
  if (mode) return;
  mainMode();

  // ══════════════════ Үндсэн цонх ══════════════════
  function mainMode() {
    // Лобби: Room 1–20 хэсэг (gx.js renderFilteredRooms дуудна)
    window.gxChannels = {
      sectionHTML(channels) {
        if (!channels.length) return '';
        const mine = String((typeof currentRoom !== 'undefined' && currentRoom?.id) || '');
        const total = channels.reduce((a, c) => a + Number(c.player_count || 0), 0);
        const cards = channels.map((c) => {
          const n = Number(c.player_count || 0); const cap = Number(c.visible_cap || c.max_players || 200);
          const extra = Math.max(0, n - cap); const pct = Math.min(100, Math.round((Math.min(n, cap) / cap) * 100));
          const st = n >= cap ? 'full' : pct >= 80 ? 'busy' : 'ok';
          return `<button type="button" class="gxch st-${st} ${String(c.id) === mine ? 'mine' : ''}" data-ch-join="${c.id}" title="${esc(c.name)} — ${n}/${cap}${extra ? ` (+${extra} Premium)` : ''}">
            <span class="gxch-top"><b>Room ${esc(c.channel_no)}</b>${String(c.id) === mine ? '<em>Та энд</em>' : ''}</span>
            <span class="gxch-n">${Math.min(n, cap)}<small>/${cap}</small>${extra ? `<i title="Premium нөөц slot-оор орсон">⭐+${extra}</i>` : ''}</span>
            <span class="gxch-bar"><i style="width:${pct}%"></i></span>
            <span class="gxch-st">${st === 'full' ? 'Дүүрсэн · ⭐ Premium нэвтэрнэ' : st === 'busy' ? 'Дүүрэх дөхсөн' : 'Чөлөөтэй'}</span>
          </button>`;
        }).join('');
        return `<section class="gxch-sec"><div class="gxch-head"><h3>🌐 Нийтийн өрөөнүүд <span>Warcraft III · Room 1–${channels.length}</span></h3><span class="gxch-total"><b>${total}</b> тоглогч өрөөнүүдэд</span></div><div class="gxch-grid">${cards}</div></section>`;
      },
    };
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ch-join]'); if (!b) return;
      e.stopPropagation();
      const r = (roomsCache || {})[b.dataset.chJoin]; if (!r) return;
      if (String((typeof currentRoom !== 'undefined' && currentRoom?.id) || '') === String(r.id)) { enterRoom(String(r.id), r.name, r.game_type, false, ''); return; }
      channelJoin(r);
    });
    async function channelJoin(r) {
      try { await window.api.joinRoom(String(r.id), null); enterRoom(String(r.id), r.name, r.game_type, false, ''); }
      catch (err) {
        const m = errMsg(err);
        if (/Premium нөөц slot/.test(m)) { if (await showConfirm('⭐ Өрөө дүүрсэн', `${m}\n\nSilver/Gold гишүүнчлэл авбал дүүрсэн өрөөнд ч шууд орно. Premium хуудас руу очих уу?`)) showTab('premium'); }
        else toast(m, 'error');
      }
    }

    // Өөрийн өрөө үүсгэх — зөвхөн GOLD (эзэн/админ чөлөөтэй)
    const createBtn = $('btn-create-room');
    createBtn?.addEventListener('click', async (e) => {
      const cu = (typeof currentUser !== 'undefined' && currentUser) || {};
      if (cu.is_owner || cu.is_admin || cu.tier === 'gold' || cu.membership === 'gold') return;
      e.stopImmediatePropagation(); e.preventDefault();
      if (await showConfirm('👑 GOLD эрх', 'Өөрийн хувийн өрөө үүсгэх нь GOLD гишүүнчлэлийн эрх.\n\nНийтийн Room 1–20-д хэн ч орж тоглоно. GOLD авбал 10 хүний хувийн өрөөгөө нээнэ. Premium хуудас руу очих уу?')) showTab('premium');
    }, true);

    // Эзэн/админ: эзний цэс (рекламын оронд) + самбар + мэдэгдэл
    const t = setInterval(async () => {
      if (typeof currentUser === 'undefined' || !currentUser) return;
      clearInterval(t);
      await loadMe();
      if (me?.staff) setupStaff();
      onSocket((s) => {
        s.on('role:decided', ({ role, approved, revoked } = {}) => {
          if (role !== 'moderator') return;
          if (revoked) toast('Таны Moderator эрх цуцлагдлаа', 'warning', 6000);
          else if (approved) { toast('🎉 Баяр хүргэе! Та Moderator боллоо — нийтийн Room-д LAN тоглоом нээж бусдыг тоглуулах эрхтэй.', 'success', 8000); try { playSound('notify'); } catch {} }
          else toast('Таны Moderator хүсэлтийг татгалзлаа', 'warning', 6000);
          loadMe();
        });
      });
    }, 700);
  }

  function setupStaff() {
    document.body.classList.add('gx-staff');
    // 1) Рекламын оронд эзний цэс
    const fill = document.querySelector('.gx-side-fill');
    if (fill && !$('gxo-menu')) {
      const menu = document.createElement('div');
      menu.id = 'gxo-menu'; menu.className = 'gxo-menu';
      menu.innerHTML = `<div class="gxo-menu-h">${me.owner ? '👑 Эзний цэс' : '🛡 Админы цэс'}</div>
        <button type="button" data-gxo="activity">📊 Гишүүдийн идэвх</button>
        <button type="button" data-gxo="requests">🛡 Moderator хүсэлт <b class="gxo-badge hidden" id="gxo-badge">0</b></button>
        <button type="button" data-gxo="mods">⭐ Moderator-ууд</button>
        <button type="button" data-gxo="kicks">🚪 Kick бүртгэл</button>
        ${$('btn-admin-dashboard') ? '<button type="button" data-gxo="admin">⚙️ Админ самбар</button>' : ''}`;
      fill.appendChild(menu);
    }
    // 2) Самбарын таб
    const host = $('gx-content');
    if (host && !$('tab-owner')) {
      const tab = document.createElement('div');
      tab.id = 'tab-owner'; tab.className = 'tab gxo';
      tab.innerHTML = `<div class="gx-page-head"><div><h2>${me.owner ? '👑 Эзний самбар' : '🛡 Админы самбар'}</h2><p class="gx-sub">Гишүүдийн идэвхийг харж, хамгийн идэвхтэй тоглогчдод Moderator олгоно.</p></div></div>
        <div class="gx-subtabs gxo-tabs"><button type="button" data-gxo-tab="activity" class="on">📊 Гишүүдийн идэвх</button><button type="button" data-gxo-tab="requests">🛡 Хүсэлтүүд <i id="gxo-tab-n">0</i></button><button type="button" data-gxo-tab="mods">⭐ Moderator-ууд</button><button type="button" data-gxo-tab="kicks">🚪 Kick бүртгэл</button></div>
        <div id="gxo-body" class="gxo-body"></div>`;
      host.appendChild(tab);
    }
    document.addEventListener('click', (e) => {
      const m = e.target.closest('[data-gxo]');
      if (m) { if (m.dataset.gxo === 'admin') { $('btn-admin-dashboard')?.click(); return; } openOwner(m.dataset.gxo); return; }
      const tb = e.target.closest('[data-gxo-tab]'); if (tb) { openOwner(tb.dataset.gxoTab); return; }
      const act = e.target.closest('[data-gxo-act]'); if (act) { ownerAction(act); }
      const row = e.target.closest('[data-gxo-user]'); if (row && !e.target.closest('button')) toggleDetail(row);
    });
    setBadge(me.pending_count || 0);
    onSocket((s) => s.on('staff:notify', (p = {}) => {
      if (typeof p.pending_count === 'number') setBadge(p.pending_count);
      if (p.type === 'role_request') {
        toast(`🛡 Шинэ Moderator хүсэлт: ${p.username}${p.note ? ` — «${p.note}»` : ''}`, 'info', 7000);
        try { playSound('notify'); } catch {}
        if (curTab === 'requests' && $('tab-owner')?.classList.contains('active')) renderOwner();
      }
    }));
  }
  function setBadge(n) {
    const b = $('gxo-badge'); if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
    const t = $('gxo-tab-n'); if (t) t.textContent = n;
  }

  let curTab = 'activity', actQ = '', actSort = 'active';
  function openOwner(tabName) {
    curTab = tabName || curTab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-owner'));
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('[data-gxo-tab]').forEach((b) => b.classList.toggle('on', b.dataset.gxoTab === curTab));
    renderOwner();
  }
  async function renderOwner() {
    const body = $('gxo-body'); if (!body) return;
    body.innerHTML = '<div class="gx-empty"><b>Ачааллаж байна…</b></div>';
    try {
      if (curTab === 'activity') {
        const r = await api('get', `/roles/activity?sort=${encodeURIComponent(actSort)}&q=${encodeURIComponent(actQ)}`);
        body.innerHTML = `<div class="gxo-tools"><label class="gx-search"><svg><use href="#gx-i-search"/></svg><input id="gxo-q" type="text" placeholder="Хэрэглэгч хайх…" value="${esc(actQ)}" /></label>
          <select id="gxo-sort" class="input"><option value="active">Тоглосон цагаар</option><option value="games">Тоглолтын тоогоор</option><option value="hosted">LAN нээсэн тоогоор</option><option value="recent">Сүүлд идэвхтэйгээр</option><option value="new">Шинэ бүртгэлээр</option></select>
          <span class="gxo-hint">Мөр дээр дарвал өрөө нээсэн түүх, сүүлийн тоглолтууд</span></div>
          <div class="gxo-table"><div class="gxo-tr gxo-th"><span>Хэрэглэгч</span><span>Тоглосон цаг</span><span>Тоглолт</span><span>7 хоног</span><span>Хожил/Хож.</span><span>LAN нээсэн</span><span>Өрөө нээсэн</span><span>Сүүлд идэвхтэй</span><span></span></div>
          ${r.users.map(userRow).join('') || '<div class="gx-empty"><b>Олдсонгүй</b></div>'}</div>`;
        $('gxo-sort').value = actSort;
        $('gxo-sort').addEventListener('change', (e) => { actSort = e.target.value; renderOwner(); });
        let tmr; $('gxo-q').addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { actQ = e.target.value.trim(); renderOwner(); }, 350); });
      } else if (curTab === 'requests') {
        const r = await api('get', '/roles/requests?status=pending'); setBadge(r.pending_count || 0);
        body.innerHTML = r.requests.length ? r.requests.map((q) => `<div class="gxo-card"><div class="gxo-card-main"><b>${esc(q.username)}</b> ${q.tier ? `<span class="gxo-tier">${esc(q.tier)}</span>` : ''} <span class="gxo-meta">${fmtAgo(q.created_at)} · ${q.wins}W/${q.losses}L</span>
            ${q.note ? `<p>«${esc(q.note)}»</p>` : '<p class="gxo-muted">Тайлбаргүй</p>'}</div>
            <div class="gxo-card-act"><button type="button" class="btn btn-primary btn-sm" data-gxo-act="approve" data-id="${q.id}">✓ Батлах</button><button type="button" class="btn btn-sm" data-gxo-act="reject" data-id="${q.id}">✕ Татгалзах</button></div></div>`).join('')
          : '<div class="gx-empty"><b>Хүлээгдэж буй хүсэлт алга</b><span>Шинэ хүсэлт ирэхэд энд гарч, дуут мэдэгдэл ирнэ.</span></div>';
      } else if (curTab === 'mods') {
        const r = await api('get', '/roles/moderators');
        body.innerHTML = r.moderators.length ? `<div class="gxo-table gxo-mods"><div class="gxo-tr gxo-th"><span>Moderator</span><span>Олгосон</span><span>Хэзээ</span><span></span></div>
          ${r.moderators.map((m) => `<div class="gxo-tr"><span><b>${esc(m.username)}</b> ${m.tier ? `<span class="gxo-tier">${esc(m.tier)}</span>` : ''}</span><span>${esc(m.granted_by_name || '—')}</span><span>${fmtAgo(m.granted_at)}</span><span><button type="button" class="btn btn-sm" data-gxo-act="revoke" data-uid="${m.user_id}" data-name="${esc(m.username)}">Эрх хасах</button></span></div>`).join('')}</div>`
          : '<div class="gx-empty"><b>Moderator алга</b><span>«Гишүүдийн идэвх»-ээс хамгийн идэвхтэй тоглогчдод олгоно уу.</span></div>';
      } else if (curTab === 'kicks') {
        const r = await api('get', '/roles/kicks');
        body.innerHTML = r.kicks.length ? `<div class="gxo-table gxo-kicks"><div class="gxo-tr gxo-th"><span>Хэзээ</span><span>Өрөө</span><span>Гаргасан</span><span>Гаргуулсан</span><span>Шалтгаан</span></div>
          ${r.kicks.map((k) => `<div class="gxo-tr"><span>${fmtAgo(k.created_at)}</span><span>${esc(k.room_name || `#${k.room_id}`)}</span><span>${esc(k.by_name || '—')}</span><span>${esc(k.target_name || '—')}</span><span>${esc(k.reason || '')}</span></div>`).join('')}</div>`
          : '<div class="gx-empty"><b>Kick бүртгэл хоосон</b></div>';
      }
    } catch (e) { body.innerHTML = `<div class="gx-empty"><b>Ачаалж чадсангүй</b><span>${esc(errMsg(e))}</span></div>`; }
  }
  function userRow(u) {
    const tag = u.role === 'moderator' ? '<span class="gxo-mod">MOD</span>' : '';
    const act = u.banned ? '<span class="gxo-muted">бан</span>'
      : u.role === 'moderator' ? `<button type="button" class="btn btn-sm" data-gxo-act="revoke" data-uid="${u.id}" data-name="${esc(u.username)}">MOD хасах</button>`
      : `<button type="button" class="btn btn-primary btn-sm" data-gxo-act="grant" data-uid="${u.id}" data-name="${esc(u.username)}">${u.requested ? '✓ Хүсэлт батлах' : 'Moderator өгөх'}</button>`;
    return `<div class="gxo-tr" data-gxo-user="${u.id}"><span><i class="gxo-dot ${u.online ? 'on' : ''}"></i><b>${esc(u.username)}</b>${tag}${u.requested ? '<span class="gxo-req">хүсэлт</span>' : ''}${u.tier ? ` <span class="gxo-tier">${esc(u.tier)}</span>` : ''}</span>
      <span>${fmtHours(u.play_seconds)}</span><span>${u.games}</span><span>${u.games_7d}</span><span>${u.wins}/${u.losses}</span><span>${u.hosted}</span><span>${u.rooms_created}</span><span>${u.online ? '<b class="gxo-on">Онлайн</b>' : fmtAgo(u.last_active_at)}</span><span>${act}</span></div>`;
  }
  async function toggleDetail(row) {
    const next = row.nextElementSibling;
    if (next?.classList.contains('gxo-detail')) { next.remove(); return; }
    const d = document.createElement('div'); d.className = 'gxo-detail'; d.textContent = 'Ачааллаж байна…'; row.after(d);
    try {
      const r = await api('get', `/roles/activity/${row.dataset.gxoUser}`);
      d.innerHTML = `<div><h4>🚪 Өрөө нээсэн түүх (${r.rooms.length})</h4>${r.rooms.length ? r.rooms.map((x) => `<div class="gxo-li">${esc(x.name)} <span>${esc(x.game_type || '')} · ${fmtAgo(x.created_at)} · ${Math.round((x.open_sec || 0) / 60)} мин нээлттэй</span></div>`).join('') : '<p class="gxo-muted">Өрөө нээгээгүй</p>'}</div>
        <div><h4>🎮 Сүүлийн тоглолтууд (${r.games.length})</h4>${r.games.length ? r.games.map((g) => `<div class="gxo-li">${fmtAgo(g.created_at)} <span>${Math.round((g.game_sec || 0) / 60)} мин${g.ranked ? ' · 🏆 Ranked' : ''} · +${g.xp} XP</span></div>`).join('') : '<p class="gxo-muted">Бичигдсэн тоглолт алга</p>'}</div>`;
    } catch (e) { d.textContent = errMsg(e); }
  }
  async function ownerAction(b) {
    const a = b.dataset.gxoAct; b.disabled = true;
    try {
      if (a === 'approve' || a === 'reject') { const r = await api('post', `/roles/requests/${b.dataset.id}/${a}`); setBadge(r.pending_count || 0); toast(a === 'approve' ? '✓ Moderator олголоо' : 'Татгалзлаа', a === 'approve' ? 'success' : 'info'); }
      else if (a === 'grant') { if (!await showConfirm('Moderator өгөх', `${b.dataset.name}-д Moderator эрх өгөх үү?\nНийтийн Room-д LAN тоглоом нээж бусдыг тоглуулах эрхтэй болно.`)) { b.disabled = false; return; } await api('post', `/roles/grant/${b.dataset.uid}`); toast(`✓ ${b.dataset.name} Moderator боллоо`, 'success'); }
      else if (a === 'revoke') { if (!await showConfirm('Moderator эрх хасах', `${b.dataset.name}-ийн Moderator эрхийг хасах уу?`)) { b.disabled = false; return; } await api('delete', `/roles/moderators/${b.dataset.uid}`); toast('Эрх хасагдлаа', 'info'); }
      renderOwner();
    } catch (e) { toast(errMsg(e), 'error'); b.disabled = false; }
  }

  // ══════════════════ Өрөөний цонх (iframe) ══════════════════
  function roomMode() {
    const ready = setInterval(async () => {
      if (typeof currentRoom === 'undefined' || !currentRoom?.id || !$('gxr-chat-body')) return;
      clearInterval(ready);
      const isChannel = currentRoom.kind === 'channel';
      await loadMe();
      currentRoom.staff = !!me?.staff;
      currentRoom.canHostChannel = isChannel && !!me?.can_host_channel;
      document.dispatchEvent(new CustomEvent('garena:host-changed', { detail: { isHost: !!currentRoom.isHost } }));
      let meta = null; try { meta = await window.api.getMyRoom?.(); } catch {}
      mountNotice(isChannel, meta && String(meta.id) === String(currentRoom.id) ? meta : null);
      if (isChannel) { $('max-players-row')?.classList.add('hidden'); }
      onSocket((s) => {
        s.on('room:notice', ({ notice } = {}) => { if (meta) meta.pinned_notice = notice; renderNotice(isChannel, meta); });
        s.on('role:decided', async () => { await loadMe(); currentRoom.canHostChannel = isChannel && !!me?.can_host_channel; renderNotice(isChannel, meta); document.dispatchEvent(new CustomEvent('garena:host-changed', { detail: { isHost: !!currentRoom.isHost } })); });
        // AFK: хулгана/гар/товшилт → 60с тутам нэгээс илүүгүй
        let last = 0; const ping = () => { const n = Date.now(); if (n - last > 60000) { last = n; try { s.emit('room:activity'); } catch {} } };
        ['mousemove', 'keydown', 'click', 'focus'].forEach((ev) => window.addEventListener(ev, ping, { passive: true }));
        if (currentRoom.staff) startAfk(s);
      });
    }, 300);

    let metaRef = null;
    function mountNotice(isChannel, meta) {
      metaRef = meta;
      const body = $('gxr-chat-body'); if (!body || $('gxn')) return;
      const n = document.createElement('div'); n.id = 'gxn'; n.className = 'gxn';
      body.insertBefore(n, body.firstChild);
      renderNotice(isChannel, meta);
      n.addEventListener('click', async (e) => {
        if (e.target.closest('#gxn-modreq')) { if (await requestModerator()) renderNotice(isChannel, metaRef); }
        else if (e.target.closest('#gxn-edit')) {
          const cur = metaRef?.pinned_notice || '';
          const v = await window.gxPrompt('📢 Зарлалын самбар засах', 'Өрөөний бүх гишүүнд чатын дээр байнга харагдана (≤1500 тэмдэгт):', cur, { multiline: true, okText: 'Хадгалах' });
          if (v == null) return;
          try { await api('patch', `/rooms/${currentRoom.id}/notice`, { notice: v }); if (metaRef) metaRef.pinned_notice = v; renderNotice(isChannel, metaRef); toast('Зарлал шинэчлэгдлээ', 'success'); } catch (err) { toast(errMsg(err), 'error'); }
        } else if (e.target.closest('#gxn-toggle')) { n.classList.toggle('collapsed'); }
      });
    }
    function renderNotice(isChannel, meta) {
      const n = $('gxn'); if (!n) return;
      const def = isChannel ? '' : 'Хост: «Тоглоом эхлүүлэх» → WC3 LAN → Create Game. Тоглогчид: «Нэгдэх» → WC3 LAN → Join Game.';
      const text = (meta?.pinned_notice || (isChannel ? '' : (meta?.description || def))).trim();
      let btn = '';
      if (isChannel) {
        if (me?.can_host_channel) btn = `<span class="gxn-role">${me.staff ? '🛡 Админ' : '⭐ Та Moderator'} — «LAN тоглоом нээх» эрхтэй</span>`;
        else if (me?.pending) btn = '<span class="gxn-role pending">⏳ Moderator хүсэлт хүлээгдэж байна</span>';
        else btn = '<button type="button" class="btn btn-primary btn-sm" id="gxn-modreq">🛡 Moderator авах</button>';
      }
      n.innerHTML = `<div class="gxn-h"><b>📢 Зарлал</b>${btn}${me?.staff ? '<button type="button" class="gxn-ic" id="gxn-edit" title="Зарлал засах">✎</button>' : ''}<button type="button" class="gxn-ic" id="gxn-toggle" title="Нуух/харуулах">▾</button></div>
        <div class="gxn-t">${esc(text || 'Зарлал алга.').replace(/\n/g, '<br>')}</div>`;
    }

    // Ажилтан: гишүүдийн AFK хугацаа (20с тутам) — нэрийн ард
    let afk = null;
    function startAfk(s) {
      const pull = () => s.emit('room:afk_list', (r) => { if (r?.ok) { afk = r; paintAfk(); } });
      pull(); setInterval(pull, 20000);
      const ml = $('members-list'); if (ml) new MutationObserver(() => paintAfk()).observe(ml, { childList: true });
    }
    function paintAfk() {
      if (!afk) return;
      document.querySelectorAll('#members-list [data-afk-uid]').forEach((el) => {
        const m = afk.members[el.dataset.afkUid];
        if (!m) { el.textContent = ''; el.className = 'afk-badge'; return; }
        if (m.in_game) { el.textContent = '🎮 тоглож буй'; el.className = 'afk-badge game'; return; }
        const min = m.active_at ? Math.floor((afk.now - m.active_at) / 60000) : null;
        if (min == null) { el.textContent = 'AFK ?'; el.className = 'afk-badge warn'; return; }
        el.textContent = min < 5 ? '' : `AFK ${min >= 60 ? `${Math.floor(min / 60)}ц ${min % 60}м` : `${min}м`}`;
        el.className = `afk-badge ${min >= 30 ? 'warn' : ''}`;
      });
    }
  }
})();
