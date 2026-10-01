// ══════════════════════════════════════════════════════════════
// GX shell (2026-09-30) — GameRanger X маягийн шинэ UI-ийн зан төлөв.
// app.js-ийн логикийг ХӨНДӨХГҮЙ: зөвхөн глобал render функцүүдийг (renderFilteredRooms, showTab) ороож,
// шинэ элементүүдийг (зүүн цэс, дээд мөр, баруун самбар, Тоглоомууд/Premium таб) хуучин ID-уудтай холбоно.
// app.js-ийн дараа ачаалагдана (index.html).
// ══════════════════════════════════════════════════════════════
(function gxShell() {
  const $ = (id) => document.getElementById(id);
  const esc = (t) => (typeof escHtml === 'function' ? escHtml(t) : String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const mode = new URLSearchParams(location.search).get('mode') || '';
  const isMain = !mode;

  // ── 1. Цайвар / бараан горим ──
  const root = document.documentElement;
  function setTheme(t) {
    root.dataset.gxTheme = t;
    try { localStorage.setItem('gx_theme', t); } catch {}
    const l = $('gx-theme-label'); if (l) l.textContent = t === 'dark' ? 'Бараан' : 'Цайвар';
  }
  setTheme(root.dataset.gxTheme === 'dark' ? 'dark' : 'light');
  $('gx-theme')?.addEventListener('click', () => setTheme(root.dataset.gxTheme === 'dark' ? 'light' : 'dark'));

  if (!isMain) return;   // room / dm / friends / radar цонхонд зөвхөн сэдэв

  // ── 2. Хэрэглэгчийн карт (Найзууд цонхны нуугдмал чипээс толилно) ──
  function syncMe() {
    const n = $('user-name'); const t = $('gx-me-name');
    if (n && t) { t.textContent = n.textContent || '…'; if (n.dataset.fxUser) t.dataset.fxUser = n.dataset.fxUser; t.className = n.className; }
    const av = $('user-avatar'); const gav = $('gx-me-avatar');
    if (av && gav && av.getAttribute('src')) { gav.src = av.src; gav.classList.remove('hidden'); gav.parentElement.classList.add('has-img'); }
    const lv = $('user-level'); if (lv && $('gx-me-level')) $('gx-me-level').textContent = lv.textContent || 'LV 1';
    const tr = $('user-tier'); const gtr = $('gx-me-tier');
    if (tr && gtr) { gtr.textContent = tr.textContent; gtr.classList.toggle('hidden', tr.classList.contains('hidden')); gtr.dataset.tier = (tr.textContent || '').toLowerCase(); }
    const st = $('login-status')?.value; const dot = document.querySelector('.gx-me .gx-dot'); if (dot) dot.dataset.st = st || 'online';
  }
  ['user-name', 'user-avatar', 'user-level', 'user-tier'].forEach((id) => {
    const el = $(id); if (el) new MutationObserver(syncMe).observe(el, { attributes: true, childList: true, characterData: true, subtree: true });
  });
  syncMe();

  // ── 3. Цэсний туслах товчнууд ──
  $('gx-logout')?.addEventListener('click', () => { if (typeof doLogout === 'function') doLogout(); });
  $('gx-help')?.addEventListener('click', () => { showTab('settings'); document.querySelector('.settings-menu-item[data-settings-section="guide"]')?.click(); });

  // ── 4. Дээд хайлт → өрөөний хайлт ──
  const gs = $('gx-search');
  gs?.addEventListener('input', () => {
    const rs = $('room-search'); if (!rs) return;
    if (!$('tab-lobby')?.classList.contains('active')) showTab('lobby');
    rs.value = gs.value; rs.dispatchEvent(new Event('input'));
  });
  $('room-search')?.addEventListener('input', () => { if (gs && document.activeElement !== gs) gs.value = $('room-search').value; });

  // ── 5. Баруун самбар (найзууд / онлайн / party) — tab-chat-ийн .dm-users-panel-ийг түр зөөж ашиглана ──
  const drawer = $('gx-drawer');
  const panel = document.querySelector('.dm-users-panel');
  const panelHome = panel?.parentElement;
  let drawerKind = null;
  function closeDrawer() {
    drawer?.classList.remove('open'); drawer?.setAttribute('aria-hidden', 'true');
    document.querySelectorAll('.gx-rail-i').forEach((b) => b.classList.remove('on'));
    if (panel && panelHome && panel.parentElement !== panelHome) panelHome.appendChild(panel);
    drawerKind = null;
  }
  function openDrawer(kind) {
    if (!drawer) return;
    if (drawerKind === kind) { closeDrawer(); return; }
    drawerKind = kind;
    document.querySelectorAll('.gx-rail-i').forEach((b) => b.classList.toggle('on', b.dataset.drawer === kind));
    const titles = { friends: 'Найзууд', online: 'Онлайн тоглогчид', party: 'Party' };
    $('gx-drawer-title').textContent = titles[kind] || '';
    const soon = kind === 'party';
    $('gx-drawer-soon')?.classList.toggle('hidden', !soon);
    $('gx-drawer-body')?.classList.toggle('hidden', soon);
    if (!soon && panel) {
      $('gx-drawer-body').appendChild(panel);
      document.querySelector(`.dm-tab[data-dm-tab="${kind === 'online' ? 'online' : 'friends'}"]`)?.click();
      if (typeof loadSocialData === 'function') { try { loadSocialData(); } catch {} }
    }
    drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  }
  document.querySelectorAll('.gx-rail-i').forEach((b) => b.addEventListener('click', () => openDrawer(b.dataset.drawer)));
  $('gx-drawer-close')?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && drawerKind) closeDrawer(); });
  // Найзын хүсэлтийн тоо → баруун самбарын badge
  const pb = $('pending-badge'); const rb = $('gx-rail-req');
  if (pb && rb) new MutationObserver(() => { rb.textContent = pb.textContent; rb.classList.toggle('hidden', pb.classList.contains('hidden') || pb.textContent === '0'); })
    .observe(pb, { attributes: true, childList: true, characterData: true, subtree: true });

  // ── 6. Таб солигдоход: шинэ табуудын render, самбар буцаах ──
  const _st = showTab;
  showTab = function (name) {
    if (name === 'chat') closeDrawer();
    _st(name);
    if (name === 'games') renderGames();
    if (name === 'premium') { window.__premium?.renderAll?.(); syncPayPrices(); syncPlanButtons(); }
    document.getElementById('gx-content')?.scrollTo?.({ top: 0 });
  };
  // app.js дотор bind хийгдсэн .nav-btn onclick-ууд хуучин showTab-ыг барьсан тул шинэчилнэ
  document.querySelectorAll('.nav-btn[data-tab]').forEach((b) => { b.onclick = () => showTab(b.dataset.tab); });

  // ── 7. Өрөөний жагсаалт — тоглоомоор бүлэглэсэн (GRX маяг) ──
  let gxState = 'all';                      // all | waiting | playing
  const collapsed = new Set(JSON.parse(localStorage.getItem('gx_collapsed') || '[]'));
  const ctl = document.querySelector('.lobby-control-bar');
  if (ctl && !ctl.querySelector('.gx-seg')) {
    const seg = document.createElement('div');
    seg.className = 'gx-seg gx-state-seg';
    seg.innerHTML = '<button type="button" class="on" data-st="all">Бүгд</button><button type="button" data-st="waiting"><svg><use href="#gx-i-clock"/></svg>Хүлээж буй</button><button type="button" data-st="playing"><svg><use href="#gx-i-play"/></svg>Тоглож буй</button>';
    ctl.appendChild(seg);
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-st]'); if (!b) return;
      gxState = b.dataset.st; seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      renderFilteredRooms();
    });
  }
  function initials(t) {
    const s = String(t || '');
    if (/imba/i.test(s)) return 'IM';
    if (/counter|cstrike|cs|hl\.exe|^hl$/i.test(s)) return 'CS';
    if (/quake|ioq3|q3/i.test(s)) return 'Q3';
    if (/red alert|ra2?/i.test(s)) return 'RA';
    if (/frozen|warcraft|w3|dota/i.test(s)) return 'W3';
    return s.replace(/[^A-Za-zА-Яа-яӨөҮү0-9 ]/g, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  }
  function pingBars(hostId) {
    const q = (typeof _netQuality === 'object' && _netQuality) ? _netQuality[String(hostId)] : null;
    let lvl = 0, cls = 'none', title = 'Ping мэдээлэл алга';
    if (q && q.rtt != null && !(q.loss >= 20)) { lvl = q.rtt < 25 ? 4 : q.rtt < 60 ? 3 : q.rtt < 120 ? 2 : 1; cls = lvl >= 3 ? 'good' : lvl === 2 ? 'ok' : 'bad'; title = `Хост: ${q.rtt}ms`; }
    else if (q) { lvl = 1; cls = 'bad'; title = `Алдагдал ${q.loss}%`; }
    return `<span class="gx-bars ${cls}" title="${esc(title)}">${[1, 2, 3, 4].map((i) => `<i class="${i <= lvl ? 'on' : ''}"></i>`).join('')}</span>`;
  }
  function stateOf(r, isMine) {
    if (r.status === 'playing') return ['playing', 'Тоглож буй'];
    if ((r.player_count || 0) >= (r.max_players || 0)) return ['full', 'Дүүрсэн'];
    return isMine ? ['mine', 'Миний'] : ['open', 'Нээлттэй'];
  }
  function gxRow(r) {
    const myId = String(currentUser?.id);
    const isMine = String(r.host_id) === myId || (r.members || []).some((m) => String(m.id) === myId);
    const [st, stLabel] = stateOf(r, isMine);
    const sel = String(r.id) === String(selectedRoomId);
    const desc = (r.description || '').trim();
    const full = (r.player_count || 0) >= (r.max_players || 0);
    const modeLbl = (r.game_mode || 'Custom').toUpperCase();
    return `<div class="room-grid-row gx-row st-${st} ${isMine ? 'room-mine' : ''} ${sel ? 'selected' : ''}" role="row" tabindex="0" data-room-id="${r.id}">
      <div class="gx-c-name"><b>${r.clan_id ? `<span class="gx-clan-chip">${esc(r.clan_tag || 'КЛАН')}</span>` : ''}${esc(r.name)}</b>${desc ? `<small>${esc(desc)}</small>` : ''}</div>
      <div class="gx-c-mode"><span class="gx-mode">${esc(modeLbl)}</span>${r.ranked ? '<span class="gx-ranked" title="Ranked: хүчинтэй хожил бүр 2💎">🏆 Ranked</span>' : ''}</div>
      <div class="gx-c-lock">${r.has_password ? '<svg title="Нууц үгтэй"><use href="#gx-i-lock"/></svg>' : ''}</div>
      <div class="gx-c-host"><svg><use href="#gx-i-host"/></svg><span class="clickable-name" data-user-id="${esc(String(r.host_id || ''))}">${esc(r.host_name || '-')}</span></div>
      <div class="gx-c-pl ${full ? 'full' : ''}"><svg><use href="#gx-i-users"/></svg>${r.player_count || 0}/${r.max_players || '-'}</div>
      <div class="gx-c-ping">${pingBars(r.host_id)}</div>
      <div class="gx-c-st"><span class="gx-st ${st}">${stLabel}</span></div>
      <div class="gx-c-act">${roomActionButton(r, r.status === 'playing', isMine, myId)}</div>
    </div>`;
  }
  renderFilteredRooms = function () {
    const list = $('rooms-waiting'); if (!list) return;
    const playing = $('rooms-playing'); if (playing) playing.innerHTML = '';
    let rooms = getFilteredRooms(Object.values(roomsCache));
    const openN = rooms.filter((r) => r.status === 'waiting').length;
    const playN = rooms.filter((r) => r.status === 'playing').length;
    if (gxState !== 'all') rooms = rooms.filter((r) => r.status === gxState);
    if (!rooms.some((r) => String(r.id) === String(selectedRoomId))) selectedRoomId = null;
    const hasFilter = Boolean(($('room-search')?.value || '').trim() || $('room-filter-type')?.value || gxState !== 'all');
    const groups = new Map();
    // Кланы өрөө (зөвхөн гишүүдэд ирдэг) → «🛡 [TAG] Клан» бүлэг эхэнд; бусад нь тоглоомоор
    rooms.filter((r) => r.clan_id).forEach((r) => { const k = `🛡 [${r.clan_tag || ''}] ${r.clan_name || 'Клан'}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    rooms.filter((r) => !r.clan_id).forEach((r) => { const k = r.game_type || 'Бусад'; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
    // Хүлээж буйг эхэнд
    groups.forEach((arr) => arr.sort((a, b) => (a.status === b.status ? 0 : a.status === 'waiting' ? -1 : 1)));
    if (!rooms.length) {
      list.innerHTML = `<div class="gx-empty"><svg><use href="#gx-i-lobby"/></svg><b>${hasFilter ? 'Тохирох өрөө олдсонгүй' : 'Одоогоор нээлттэй өрөө алга'}</b><span>${hasFilter ? 'Шүүлтүүрээ өөрчилж үзнэ үү.' : 'Эхний өрөөг та үүсгээрэй — найзууд тань шууд харна.'}</span>${hasFilter ? '' : '<button type="button" class="btn btn-primary" data-gx-click="btn-create-room">+ Өрөө үүсгэх</button>'}</div>`;
    } else {
      list.innerHTML = [...groups.entries()].map(([g, arr]) => {
        const c = collapsed.has(g);
        return `<section class="gx-group ${c ? 'collapsed' : ''}" data-game="${esc(g)}">
          <button type="button" class="gx-group-head" data-gx-group="${esc(g)}"><i class="gx-gi ${g.startsWith('🛡') ? 'clan' : ''}" style="--gc:${gameTypeColor(g)}">${g.startsWith('🛡') ? '🛡' : esc(initials(g))}</i><b>${esc(g)}</b><span class="gx-count">${arr.length}</span><svg class="gx-chev"><use href="#gx-i-chev"/></svg></button>
          <div class="gx-group-rows">${arr.map(gxRow).join('')}</div>
        </section>`;
      }).join('');
    }
    const cnt = $('rooms-waiting-count'); if (cnt) cnt.textContent = `${openN} нээлттэй · ${playN} тоглож буй`;
    const sub = $('gx-lobby-sub'); if (sub) sub.textContent = `${openN + playN} өрөө · ${openN} нээлттэй · ${playN} тоглож буй`;
    const sr = rooms.find((r) => String(r.id) === String(selectedRoomId));
    document.querySelector('.room-board-layout')?.classList.toggle('no-selection', !sr);
    const detail = $('room-detail-panel'); if (detail) detail.innerHTML = sr ? `<button type="button" class="gx-x gx-detail-x" title="Хаах">✕</button>${renderRoomDetail(sr)}` : '';
    syncCurrentRoom();
  };
  document.addEventListener('click', (e) => {
    const h = e.target.closest('[data-gx-group]'); if (!h) return;
    const g = h.dataset.gxGroup;
    if (collapsed.has(g)) collapsed.delete(g); else collapsed.add(g);
    try { localStorage.setItem('gx_collapsed', JSON.stringify([...collapsed])); } catch {}
    h.parentElement.classList.toggle('collapsed', collapsed.has(g));
  });
  // Сонгосон өрөөг дахин дарвал хаана (детал самбар)
  $('room-detail-panel')?.addEventListener('click', (e) => { if (e.target.closest('.gx-detail-x')) { selectedRoomId = null; renderFilteredRooms(); } });

  // ── 8. Одоогийн өрөөний ногоон карт (roomsCache-аас, нэмэлт хүсэлтгүй) ──
  function syncCurrentRoom() {
    const card = $('gx-cur-room'); if (!card || !currentUser) return;
    const myId = String(currentUser.id);
    const r = Object.values(roomsCache || {}).find((x) => String(x.host_id) === myId || (x.members || []).some((m) => String(m.id) === myId));
    card.classList.toggle('hidden', !r);
    if (!r) return;
    $('gx-cur-room-name').textContent = r.name || 'Өрөө';
    $('gx-cur-room-meta').textContent = `${r.player_count || 0}/${r.max_players || 10} тоглогч${r.status === 'playing' ? ' · тоглож буй' : ''}`;
    card.onclick = () => enterRoom(r.id, r.name, r.game_type, String(r.host_id) === myId, r.host_id, r.status);
  }

  // ── 9. Тоглоомууд таб ──
  function renderGames() {
    const games = (typeof configuredGames !== 'undefined' && configuredGames) || [];
    const rooms = Object.values(roomsCache || {});
    const online = (typeof onlineUserIds !== 'undefined' && onlineUserIds) ? onlineUserIds.size : 0;
    const ps = Number(currentUser?.play_seconds_total || 0);
    const hrs = ps >= 3600 ? `${Math.floor(ps / 3600)}ц ${Math.round((ps % 3600) / 60)}м` : `${Math.round(ps / 60)}м`;
    const byGame = (g) => rooms.filter((r) => r.game_type === g);
    $('gx-games-sub').textContent = `${online || rooms.reduce((a, r) => a + (r.player_count || 0), 0)} тоглогч онлайн · ${rooms.length} өрөөнд`;
    $('gx-games-stats').innerHTML = [
      ['gx-i-games', games.length, 'Бүртгэсэн тоглоом', 'c-violet'],
      ['gx-i-lobby', rooms.length, 'Идэвхтэй өрөө', 'c-green'],
      ['gx-i-clock', hrs, 'Нийт тоглосон цаг', 'c-amber'],
      ['gx-i-users', online || '—', 'Онлайн тоглогч', 'c-cyan'],
    ].map(([i, v, l, c]) => `<div class="gx-stat ${c}"><span class="gx-stat-ico"><svg><use href="#${i}"/></svg></span><div><b>${esc(v)}</b><small>${esc(l)}</small></div></div>`).join('');
    const grid = $('gx-games-grid');
    if (!games.length) {
      grid.innerHTML = `<div class="gx-empty"><svg><use href="#gx-i-games"/></svg><b>Тоглоом бүртгэгдээгүй байна</b><span>Warcraft III-ийнхаа war3.exe / Frozen Throne.exe файлыг нэмснээр өрөө үүсгэж, нэгдэх боломжтой болно.</span><button type="button" class="btn btn-primary" data-gx-click="btn-add-game">Тоглоом нэмэх</button></div>`;
      return;
    }
    grid.innerHTML = games.map((g) => {
      const rs = byGame(g.name); const players = rs.reduce((a, r) => a + (r.player_count || 0), 0);
      return `<article class="gx-game" style="--gc:${gameTypeColor(g.name)}">
        <div class="gx-game-cover"><span class="gx-game-ab">${esc(initials(g.name))}</span><span class="gx-game-tag">Суулгасан</span></div>
        <div class="gx-game-meta"><span><svg><use href="#gx-i-users"/></svg>${players}</span><span><svg><use href="#gx-i-lobby"/></svg>${rs.length} өрөө</span></div>
        <h4 title="${esc(g.name)}">${esc(g.name)}</h4>
        <p class="gx-game-path" title="${esc(g.path)}">${esc(g.path)}</p>
        <div class="gx-game-act"><button type="button" class="btn btn-primary btn-sm" data-gx-create="${esc(g.name)}">Өрөө үүсгэх</button><button type="button" class="btn btn-sm" data-gx-rooms="${esc(g.name)}">Өрөөнүүд</button></div>
      </article>`;
    }).join('');
  }
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-gx-create]');
    if (c) { showTab('lobby'); $('btn-create-room')?.click(); setTimeout(() => { const s = $('room-type'); if (s) s.value = c.dataset.gxCreate; }, 30); return; }
    const r = e.target.closest('[data-gx-rooms]');
    if (r) { showTab('lobby'); const f = $('room-filter-type'); if (f) { f.value = r.dataset.gxRooms; f.dispatchEvent(new Event('change')); } }
  });
  $('gx-add-game')?.addEventListener('click', () => $('btn-add-game')?.click());
  const gl = $('games-list'); if (gl) new MutationObserver(() => { if ($('tab-games')?.classList.contains('active')) renderGames(); }).observe(gl, { childList: true });

  // ── 10. Premium: төлбөрийн хэлбэр (QPay / Diamond) ──
  function syncPayPrices() {
    const v = $('membership-pay-with')?.value || 'qpay';
    document.querySelectorAll('.gx-pay-seg [data-pay]').forEach((b) => b.classList.toggle('on', b.dataset.pay === v));
    document.querySelectorAll('[data-price-qpay]').forEach((n) => { n.textContent = v === 'diamonds' ? n.dataset.priceDia : n.dataset.priceQpay; });
  }
  document.querySelector('.gx-pay-seg')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pay]'); if (!b) return;
    const sel = $('membership-pay-with'); if (sel) sel.value = b.dataset.pay;
    syncPayPrices();
  });
  // Одоогийн төлөвлөгөөний товч
  function syncPlanButtons() {
    document.querySelectorAll('.gx-plan').forEach((c) => {
      const btn = c.querySelector('.gx-plan-btn'); if (!btn) return;
      const cur = c.classList.contains('current');
      if (c.dataset.tier === 'bronze') { btn.textContent = cur ? 'Одоогийн төлөвлөгөө' : 'Үнэгүй'; return; }
      btn.textContent = cur ? 'Сунгах' : `${c.querySelector('h3')?.textContent || ''} сонгох`;
    });
  }
  document.querySelectorAll('.gx-plan').forEach((c) => new MutationObserver(syncPlanButtons).observe(c, { attributes: true, attributeFilter: ['class'] }));
  syncPlanButtons();

  // ── 11. Өрөө үүсгэх форм = modal (арын дэвсгэр дээр дарвал хаана) ──
  const form = $('create-room-form');
  if (form) {
    form.addEventListener('mousedown', (e) => { if (e.target === form) $('btn-cancel-room')?.click(); });
    new MutationObserver(() => document.body.classList.toggle('gx-modal-open', form.style.display === 'block')).observe(form, { attributes: true, attributeFilter: ['style'] });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && form.style.display === 'block') $('btn-cancel-room')?.click(); });
  }

  // Lobby толгойн дэд мөр (тоо)
  const lh = document.querySelector('#tab-lobby .lobby-title-group');
  if (lh && !$('gx-lobby-sub')) { const p = document.createElement('p'); p.id = 'gx-lobby-sub'; p.className = 'gx-sub'; lh.appendChild(p); }
  // CSP inline handler-гүй: data-gx-click="<id>" → тухайн товчийг дарна
  document.addEventListener('click', (e) => { const b = e.target.closest('[data-gx-click]'); if (b) $(b.dataset.gxClick)?.click(); });
  // app.js-ийн init() энэ скриптээс ӨМНӨ өрөөнүүдийг зурсан байж болно → шинэ загвараар дахин зурна
  selectedRoomId = null;   // GRX шиг: эхэндээ бүтэн өргөнтэй жагсаалт, өрөө сонгоход л дэлгэрэнгүй самбар
  if (Object.keys(roomsCache || {}).length) renderFilteredRooms();
  setTimeout(() => { syncMe(); if (Object.keys(roomsCache || {}).length) renderFilteredRooms(); }, 400);
  // ── Шууд холболт (mesh) төлөв — зүүн цэсэнд; идэвхгүй бол дарахад суулгаж/холбоно (UAC нэг удаа) ──
  // 2026-10-01 (эзэн): bot1-ийн үеийнх шиг бүх тоглолт зөвхөн УБ relay-ээр — шууд холболтын (mesh) товч/тууз/цонхыг
  // харуулахгүй. Дахин нээх бол MESH_UI = true + сервер MESH_DISABLED-ийг авна.
  const MESH_UI = window.GX_MESH_UI !== false;   // app.js-д тодорхойлсон (одоо false)
  if (!MESH_UI) { $('gx-mesh')?.classList.add('hidden'); document.getElementById('mesh-row')?.classList.add('hidden'); }
  function meshUi(st) {
    if (!MESH_UI) return;
    const b = $('gx-mesh'); if (!b || !st) return;
    const on = st.state === 'Running' && !!st.ip;
    const busy = st.state === 'Installing' || st.state === 'Starting';
    b.dataset.state = on ? 'on' : busy ? 'busy' : 'off';
    $('gx-mesh-text').textContent = on ? 'Шууд холболт идэвхтэй' : busy ? 'Холбогдож байна…' : st.state === 'ForeignTailnet' ? 'Шууд холболт: өөр Tailscale' : 'Шууд холболт идэвхжүүлэх';
    // Байнгын туузан сануулга (2.9.11): идэвхгүй бүх хугацаанд контентын дээд талд; ✕ = зөвхөн энэ удаад нуух
    const quiet = on || busy || ['ForeignTailnet', 'Disabled'].includes(st.state) || !st.state;
    meshBanner(!quiet);
    // Апп эхэлж анх «идэвхжүүлээгүй» мэдээ ирэхэд тайлбартай цонх — сесс бүрд нэг удаа
    if (!quiet && st.state === 'NotInstalled' && !meshAsked) { meshAsked = true; setTimeout(() => askMesh(false), 1500); }
  }
  let meshAsked = false, bannerHidden = false;
  function meshBanner(show) {
    let el = $('gx-mesh-banner');
    if (!show || bannerHidden) { el?.remove(); return; }
    if (el) return;
    const host = $('gx-content'); if (!host) return;
    el = document.createElement('div');
    el.id = 'gx-mesh-banner'; el.className = 'gx-mesh-banner'; el.setAttribute('role', 'status');
    el.innerHTML = '<span class="mb-ico">⚡</span><span class="mb-text"><b>Шууд холболт идэвхгүй байна.</b> Одоо тоглолт серверээр (Сингапур) дамжиж ping ~100–200мс болно. Идэвхжүүлбэл Монгол доторх тоглогчидтой <b>~10мс</b>.</span><button type="button" class="btn btn-primary mb-go">Идэвхжүүлэх</button><button type="button" class="mb-x" title="Энэ удаад нуух" aria-label="Нуух">✕</button>';
    el.querySelector('.mb-go').addEventListener('click', () => askMesh(true));
    el.querySelector('.mb-x').addEventListener('click', () => { bannerHidden = true; el.remove(); });
    host.insertBefore(el, host.firstChild);
  }
  async function askMesh(fromClick) {
    const b = $('gx-mesh'); if (b?.dataset.state === 'on' || b?.dataset.state === 'busy') return;
    const ok = await showConfirm('⚡ Шууд холболт идэвхжүүлэх',
      'Тоглогчидтой серверээр дамжилгүй ШУУД холбогдоно — Монгол дотор ping ~10мс (одоо Сингапураар ~100–200мс).\n\n'
      + 'Дараагийн алхамд Windows «Энэ апп өөрчлөлт хийхийг зөвшөөрөх үү?» гэж асуухад «Yes / Тийм» дарна уу. Энэ нь нэг л удаа асууна.\n\n'
      + 'Суулгах зүйл: Tailscale — албан ёсны, аюулгүй сүлжээний програм (зөвхөн Garena.mn тоглогчидтой холбогдоно).');
    if (!ok) { if (!fromClick) showToast('Дараа нь зүүн доод «Шууд холболт идэвхжүүлэх» товчоор идэвхжүүлж болно', 'info', 5000); return; }
    meshUi({ state: 'Starting' });
    let st; try { st = await window.api.meshEnsure(); } catch {}
    if (st) meshUi(st);
    if (st?.state === 'Running' && st.ip) showToast('⚡ Шууд холболт идэвхжлээ!', 'success', 5000);
    else if (st?.error === 'declined') showToast('Windows-ын зөвшөөрөл дээр «Yes» дараагүй тул идэвхжсэнгүй. Дахин оролдоно уу.', 'warning', 7000);
    else if (st) showToast(`Шууд холболт идэвхжсэнгүй: ${st.error || st.state}`, 'warning', 7000);
  }
  window.api?.onMeshStatus?.(meshUi);
  window.api?.meshStatus?.().then(meshUi).catch(() => {});
  $('gx-mesh')?.addEventListener('click', async () => {
    const b = $('gx-mesh'); if (b.dataset.state === 'on') { showToast('Шууд холболт идэвхтэй — mesh-тэй тоглогчидтой хамгийн бага ping-ээр холбогдоно', 'success'); return; }
    askMesh(true);
  });
  window.gx = { renderGames, openDrawer, closeDrawer, setTheme, gxRow };
})();
