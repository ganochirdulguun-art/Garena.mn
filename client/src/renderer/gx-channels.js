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
  async function loadMe() { try { me = await api('get', '/roles/me'); } catch { me = null; } try { document.dispatchEvent(new Event('gx:me')); } catch {} return me; }
  window.gxRoleMe = () => me;   // gx-rgc.js (RGC маягийн өрөө) — Moderator хэсэг
  async function requestModerator() {
    const note = await window.gxPrompt('🛡 Moderator авах хүсэлт', 'Moderator нь нийтийн Room-д LAN тоглоом нээж бусдыг тоглуулна. Өөрийнхөө тухай товч бичнэ үү (заавал биш):', '', { okText: 'Хүсэлт илгээх' });
    if (note == null) return false;
    try {
      const r = await api('post', '/roles/request', { note });
      if (r?.auto) toast('✅ Moderator эрх автоматаар олгогдлоо! Одоо нийтийн Room-д LAN тоглоом нээж болно.', 'success', 7000);
      else toast('✅ Хүсэлт илгээгдлээ — эзэн/админ шалгаад батална', 'success', 5000);
      await loadMe(); return true;
    }
    catch (e) { toast(errMsg(e), 'warning', 5000); return false; }
  }
  window.gxRequestModerator = requestModerator;
  // Socket бүрт (гараад дахин нэвтрэхэд connectSocket шинэ socket үүсгэдэг) сонсогчийг нэг удаа залгана — хуучин socket дээр үлддэг байв
  const onSocket = (fn) => { setInterval(() => { if (typeof socket !== 'undefined' && socket) { if (!socket.__gxCh) socket.__gxCh = new Set(); if (!socket.__gxCh.has(fn)) { socket.__gxCh.add(fn); fn(socket); } } }, 1000); };
  const fmtAgo = (ts) => {
    if (!ts) return '—'; const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'дөнгөж сая'; if (s < 3600) return `${Math.floor(s / 60)}м өмнө`; if (s < 86400) return `${Math.floor(s / 3600)}ц өмнө`; return `${Math.floor(s / 86400)} өдөр өмнө`;
  };
  const fmtHours = (sec) => { const h = (Number(sec) || 0) / 3600; return h >= 10 ? `${Math.round(h)}ц` : `${h.toFixed(1)}ц`; };

  // ── Хэрэглэгчийн нэр дээр баруун товч → цол (эзэн: ADMIN+Moderator, админ: Moderator) ──
  (function userRoleMenu() {
    let box = null;
    const hide = () => box?.classList.add('hidden');
    document.addEventListener('click', (e) => { if (box && !e.target.closest('#gxu-ctx')) hide(); });
    window.addEventListener('blur', hide);
    document.addEventListener('scroll', hide, true);
    document.addEventListener('contextmenu', async (e) => {
      const el = e.target.closest('[data-user-id]');
      if (!el || !me?.staff) return;
      const uid = String(el.dataset.userId || '');
      if (!uid || uid === String((typeof currentUser !== 'undefined' && currentUser?.id) || '')) return;
      e.preventDefault(); e.stopPropagation();
      if (!box) { box = document.createElement('div'); box.id = 'gxu-ctx'; box.className = 'gx-ctx hidden'; document.body.appendChild(box); box.addEventListener('click', onPick); }
      box.innerHTML = '<div class="gxu-h">Ачааллаж байна…</div>';
      place(e);
      let u; try { u = await api('get', `/roles/user/${uid}`); } catch (err) { box.innerHTML = `<div class="gxu-h">${esc(errMsg(err))}</div>`; return; }
      const roleLbl = { owner: '👑 Эзэн', admin: '🛡 ADMIN', moderator: '⭐ Moderator' }[u.role] || 'Энгийн гишүүн';
      const item = (act, label, cls = '') => `<button type="button" class="gx-ctx-i ${cls}" data-gxu="${act}" data-uid="${u.id}" data-name="${esc(u.username)}">${label}</button>`;
      box.innerHTML = [
        `<div class="gxu-h"><b>${esc(u.username)}</b><span>${roleLbl}</span></div>`,
        u.can_set_admin ? (u.role === 'admin' ? item('unset', '🛡 ADMIN цол хураах', 'danger') : item('admin', '🛡 ADMIN цол өгөх', 'accent')) : '',
        u.can_set_mod && u.role !== 'admin' ? (u.role === 'moderator' ? item('unset', '⭐ Moderator хураах', 'danger') : item('moderator', '⭐ Moderator өгөх', 'accent')) : '',
        !u.can_set_admin && !u.can_set_mod ? '<div class="gxu-h gxo-muted">Энэ хэрэглэгчийн цолыг өөрчлөх эрхгүй</div>' : '',
        '<hr>', item('profile', '👤 Профайл харах'),
      ].join('');
      place(e);
    }, true);
    function place(e) {
      box.classList.remove('hidden');
      const w = box.offsetWidth, h = box.offsetHeight;
      box.style.left = `${Math.min(e.clientX, innerWidth - w - 8)}px`;
      box.style.top = `${Math.min(e.clientY, innerHeight - h - 8)}px`;
    }
    async function onPick(e) {
      const b = e.target.closest('[data-gxu]'); if (!b) return;
      hide();
      const act = b.dataset.gxu, uid = b.dataset.uid, name = b.dataset.name;
      if (act === 'profile') { try { openUserProfile(uid); } catch {} return; }
      const role = act === 'unset' ? null : act;
      const q = role ? `${name}-д ${role === 'admin' ? 'ADMIN' : 'Moderator'} цол өгөх үү?` : `${name}-ийн цолыг хураах уу?`;
      if (!await showConfirm('Цол', q)) return;
      try { await api('post', `/roles/set/${uid}`, { role }); toast(role ? `✓ ${name} → ${role === 'admin' ? 'ADMIN' : 'Moderator'}` : `${name}-ийн цол хураагдлаа`, 'success'); }
      catch (err) { toast(errMsg(err), 'error'); }
    }
  })();

  if (mode === 'room') return roomMode();
  if (mode) return;
  mainMode();

  // ══════════════════ Үндсэн цонх ══════════════════
  // Нийтийн Room-той тоглоомууд (лоббид энэ дарааллаар): id = gameKindOf() (app.js)
  const CH_GAMES = [
    { id: 'wc3', title: 'Warcraft III: The Frozen Throne', short: 'Warcraft III', ico: 'W3', emoji: '🌐', net: 'LAN' },
    { id: 'cs16', title: 'Counter-Strike 1.6', short: 'CS 1.6', ico: 'CS', emoji: '🎯', net: 'Сервер' },
    { id: 'q3', title: 'Quake III Arena', short: 'Quake III', ico: 'Q3', emoji: '⚡', net: 'Сервер' },
    { id: 'ra2', title: 'Red Alert 2', short: 'Red Alert 2', ico: 'RA', emoji: '🪖', net: 'LAN' },
  ];
  const myRoomId = () => String(window.gxRoom?.roomId || (typeof currentRoom !== 'undefined' && currentRoom?.id) || '');
  function chFavs() { try { return new Set(JSON.parse(localStorage.getItem('gx_ch_favs') || '[]')); } catch { return new Set(); } }
  function mainMode() {
    document.addEventListener('click', (e) => {
      const f = e.target.closest('[data-ch-fav]'); if (!f) return;
      e.stopPropagation(); e.preventDefault();
      const s2 = chFavs(); const id = String(f.dataset.chFav); s2.has(id) ? s2.delete(id) : s2.add(id);
      try { localStorage.setItem('gx_ch_favs', JSON.stringify([...s2])); } catch {}
      try { renderFilteredRooms(); } catch {}
    }, true);
    // Лобби: Room 1–20 хэсэг (gx.js renderFilteredRooms дуудна)
    window.gxChannels = {
      // Garena Plus маяг: дээрээс доош цувсан жагсаалт — Өрөөний нэр | Тоглоом | Тоглогч | Дүүргэлт | ★
      // Тоглоом бүр тусдаа хэсэг (2026-10-02): WC3 Room 1–20 → CS 1.6 → Quake III → Red Alert 2 (тус бүр Room 1–5)
      sectionHTML(channels) {
        if (!channels.length) return '';
        const kindOf = (c) => (typeof gameKindOf === 'function' ? gameKindOf(c.game_type) : 'wc3');
        return CH_GAMES.map((g) => this.gameSectionHTML(g, channels.filter((c) => kindOf(c) === g.id))).join('');
      },
      gameSectionHTML(g, channels) {
        if (!channels.length) return '';
        const mine = myRoomId();
        const favs = chFavs();
        const total = channels.reduce((a, c) => a + Number(c.player_count || 0), 0);
        const rankedN = channels.filter((c) => c.ranked).length;
        const sorted = channels.slice().sort((a, b) => (favs.has(String(b.id)) - favs.has(String(a.id))) || (Number(a.channel_no) - Number(b.channel_no)));
        const rows = sorted.map((c) => {
          const n = Number(c.player_count || 0); const cap = Number(c.visible_cap || c.max_players || 200);
          const extra = Math.max(0, n - cap); const pct = Math.min(100, Math.round((Math.min(n, cap) / cap) * 100));
          const st = n >= cap ? 'full' : pct >= 80 ? 'busy' : 'ok';
          const fav = favs.has(String(c.id));
          const no = String(c.channel_no).padStart(2, '0');
          return `<div class="gxcl-row st-${st} ${String(c.id) === mine ? 'mine' : ''} ${c.ranked ? 'ranked' : ''}" role="row" tabindex="0" data-ch-join="${c.id}" title="${c.ranked ? '🏆 Ranked Room — хүчинтэй хожил бүр +2 💎. ' : ''}Дарж орох">
            <span class="gxcl-name"><span class="gxcl-icw ${c.ranked ? 'rk' : ''}"${c.ranked ? ' title="Ranked Room"' : ''}><img class="gxcl-ico gxcl-img" src="icons/${g.id}.png" alt="${g.ico}" onerror="this.replaceWith(Object.assign(document.createElement('i'),{className:'gxcl-ico k-${g.id}',textContent:'${g.ico}'}))"></span>${esc(c.name)}${c.ranked ? '<b class="gxcl-rk">RANKED</b>' : ''}${String(c.id) === mine ? '<em>Та энд</em>' : ''}</span>
            <span class="gxcl-game">${c.ranked ? `${g.short} · <b>Ranked</b>` : `${g.short} · ${g.net}`}</span>
            <span class="gxcl-num">${n}<small>/${cap}</small>${extra ? `<b title="Premium нөөц slot-оор орсон">⭐+${extra}</b>` : ''}</span>
            <span class="gxcl-bar"><i style="width:${pct}%"></i></span>
            <span class="gxcl-st">${(c.games_started || c.games_open) ? `<b class="gxcl-live" title="Энэ Room-д явагдаж буй / нээлттэй LAN тоглоом">🎮 ${c.games_started ? `${c.games_started} тоглолт` : ''}${c.games_started && c.games_open ? ' · ' : ''}${c.games_open ? `${c.games_open} нээлттэй` : ''}</b>` : st === 'full' ? 'Дүүрсэн · ⭐' : st === 'busy' ? 'Дүүрэх дөхсөн' : 'Чөлөөтэй'}</span>
            <button type="button" class="gxcl-fav ${fav ? 'on' : ''}" data-ch-fav="${c.id}" title="${fav ? 'Дуртайгаас хасах' : 'Дуртайд нэмэх'}">${fav ? '★' : '☆'}</button>
          </div>`;
        }).join('');
        return `<section class="gxch-sec k-${g.id}"><div class="gxch-head"><h3><img class="gxch-gico" src="icons/${g.id}.png" alt="" onerror="this.remove()">${esc(g.title)} <span>Нийтийн Room 1–${channels.length}${rankedN ? ` · 🏆 Ranked: Room 1–${rankedN}` : ''}</span></h3><span class="gxch-total"><b>${total}</b> тоглогч өрөөнүүдэд</span></div>
          <div class="gxcl"><div class="gxcl-row gxcl-th" role="row"><span>Өрөөний нэр</span><span>Тоглоом</span><span>Тоглогч</span><span>Дүүргэлт</span><span>Төлөв</span><span>★</span></div>${rows}</div></section>`;
      },
    };
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ch-join]'); if (!b) return;
      e.stopPropagation();
      const r = (roomsCache || {})[b.dataset.chJoin]; if (!r) return;
      if (myRoomId() === String(r.id)) { showTab('roomview'); return; }
      channelJoin(r);
    });
    // 🏆 Ranked товч (Ranked таб): Ranked Room 1–5-аас багтаамжтай, хамгийн олон хүнтэйг сонгоно
    window.gxJoinRanked = async () => {
      try { await loadRooms(); } catch {}   // хуучирсан кэшээр биш, шинэ тоогоор Room сонгоно
      const list = Object.values(roomsCache || {}).filter((r) => r.kind === 'channel' && r.ranked);
      if (!list.length) { showTab('lobby'); return; }
      const cap = (r) => Number(r.visible_cap || 200);
      const free = list.filter((r) => Number(r.player_count || 0) < cap(r));
      const pick = (free.length ? free : list).sort((a, b) => Number(b.player_count || 0) - Number(a.player_count || 0) || Number(a.channel_no) - Number(b.channel_no))[0];
      if (myRoomId() === String(pick.id)) { showTab('roomview'); return; }
      channelJoin(pick);
    };
    // Өрөө солихын өмнө: LAN тоглолт/relay идэвхтэй бол анхааруулна — нэг товшилтоор явагдаж буй тоглолт тасардаг байв (аудит 2026-10-02)
    async function switchGuard(targetId) {
      const cur = myRoomId(); if (!cur || cur === String(targetId)) return true;
      let busy = false; try { busy = !!(await window.api.isRelayRunning?.()); } catch {}
      if (!busy) return true;
      return !!(await showConfirm('⚠ Тоглолт явагдаж байна', 'Өөр Room руу шилжвэл одоогийн LAN тоглолтын холболт ТАСАРНА (хост бол бүх тоглогч сална).\n\nҮргэлжлүүлэх үү?'));
    }
    async function channelJoin(r) {
      if (!await switchGuard(r.id)) return;
      try { await window.api.joinRoom(String(r.id), null); enterRoom(String(r.id), r.name, r.game_type, false, ''); }
      catch (err) {
        const m = errMsg(err);
        if (/Premium нөөц slot/.test(m)) { if (await showConfirm('⭐ Өрөө дүүрсэн', `${m}\n\nSilver/Gold гишүүнчлэл авбал дүүрсэн өрөөнд ч шууд орно. Premium хуудас руу очих уу?`)) showTab('premium'); }
        else toast(m, 'error');
      }
    }

    // «⚡ Хурдан» = хамгийн идэвхтэй нийтийн WC3 Room руу (өмнө нь GOLD-гүй хүнд хувийн «Quick Match» өрөө үүсгэдэг байв)
    $('btn-quickmatch')?.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); window.gxJoinPublic('wc3'); }, true);
    // Өөрийн өрөө үүсгэх — зөвхөн GOLD (эзэн/админ чөлөөтэй)
    const createBtn = $('btn-create-room');
    createBtn?.addEventListener('click', async (e) => {
      const cu = (typeof currentUser !== 'undefined' && currentUser) || {};
      if (cu.is_owner || cu.is_admin || cu.tier === 'gold' || cu.membership === 'gold') return;
      e.stopImmediatePropagation(); e.preventDefault();
      goldGuide();
    }, true);

    // Нийтийн WC3 Room руу оруулна: багтаамжтай, хамгийн олон хүнтэйг (хүн цуглардаг) сонгоно
    window.gxJoinPublic = async (kind = 'wc3') => {
      const pick = () => Object.values(roomsCache || {}).filter((r) => r.kind === 'channel' && (typeof gameKindOf !== 'function' || gameKindOf(r.game_type) === kind));
      try { await loadRooms(); } catch {}   // хуучирсан кэшээр биш, шинэ тоогоор Room сонгоно
      const list = pick();
      if (!list.length) { showTab('lobby'); return; }
      const free = list.filter((r) => Number(r.player_count || 0) < Number(r.visible_cap || 200));
      const r = (free.length ? free : list).sort((a, b) => Number(b.player_count || 0) - Number(a.player_count || 0) || Number(a.channel_no) - Number(b.channel_no))[0];
      if (myRoomId() === String(r.id)) { showTab('roomview'); return; }
      channelJoin(r);
    };

    // «Өрөө үүсгэх» — GOLD биш хэрэглэгчид бүрэн заавар (2026-10-02, эзэн): Нийтийн Room → Moderator хүсэлт → LAN нээх, эсвэл GOLD
    async function goldGuide() {
      await loadMe();
      const canHost = !!me?.can_host_channel; const pending = !!me?.pending; const auto = !!me?.auto_approve;
      const wrap = document.createElement('div');
      wrap.className = 'gxp-back';
      wrap.innerHTML = `<div class="gxp gxg" role="dialog" aria-modal="true">
        <h3>👑 Хувийн өрөө үүсгэх нь GOLD гишүүний эрх</h3>
        <p class="gxg-lead">Гэхдээ та <b>одоо ч шууд тоглож</b> болно — Нийтийн Room-д орж Moderator эрх аваад өөрөө LAN тоглоом нээгээрэй:</p>
        <ol class="gxg-steps">
          <li><b>🌐 Нийтийн Room-д ор</b><span>Лоббигийн «Warcraft III» жагсаалтаас WC3 Room 1–20. 🏆 Room 1–5 нь Ranked — хожил бүр +2 💎.</span></li>
          <li class="${canHost ? 'done' : ''}"><b>🛡 Moderator эрх хүс</b><span>${canHost ? '✓ Та аль хэдийн LAN нээх эрхтэй.' : pending ? '⏳ Таны хүсэлт хүлээгдэж байна — эзэн/админ батална.' : `Room дотор «Тоглоом дотор өрөө үүсгэх заавар» доорх «Moderator эрх хүсэх» эсвэл доорх товч.${auto ? ' <em>Одоо хүсэлт шууд (автоматаар) батлагдана!</em>' : ' Эзэн/админ батална.'}`}</span></li>
          <li><b>🎮 LAN тоглоом нээ</b><span>Room-ын доод «START» / баруун талын «LAN НЭЭХ» → WC3 нээгдэнэ → Local Area Network → Create Game. Бусад нь OPEN GAMES-ээс «Нэгдэх» дарж орно.</span></li>
          <li><b>👑 Өөрийн хувийн өрөө хэрэгтэй бол</b><span>GOLD гишүүнчлэл авбал нууц үгтэй/10 хүний хувийн өрөөгөө нээнэ (Diamond-оор ч авч болно).</span></li>
        </ol>
        <div class="gxg-act">
          <button type="button" class="btn btn-primary" data-g="join">🌐 Нийтийн Room руу орох</button>
          ${!canHost && !pending ? '<button type="button" class="btn" data-g="mod">🛡 Moderator хүсэлт илгээх</button>' : ''}
          <button type="button" class="btn gxg-gold" data-g="gold">👑 GOLD авах</button>
          <button type="button" class="btn gxg-x" data-g="close">Хаах</button>
        </div></div>`;
      const close = () => wrap.remove();
      wrap.addEventListener('click', async (ev) => {
        if (ev.target === wrap) return close();
        const b = ev.target.closest('[data-g]'); if (!b) return;
        const a = b.dataset.g; close();
        if (a === 'join') window.gxJoinPublic('wc3');
        else if (a === 'mod') { if (await requestModerator()) { if (me?.can_host_channel) window.gxJoinPublic('wc3'); } }
        else if (a === 'gold') showTab('premium');
      });
      wrap.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') close(); });
      document.body.appendChild(wrap);
      wrap.querySelector('[data-g="join"]')?.focus();
    }

    // Эзэн/админ: эзний цэс (рекламын оронд) + самбар + мэдэгдэл
    // Хэрэглэгч солигдох (гараад өөр акаунтаар нэвтрэх) бүрт me/staff төлөвийг шинэчилнэ
    let lastUid = null;
    setInterval(async () => {
      if (typeof currentUser === 'undefined' || !currentUser) { if (lastUid !== null) { lastUid = null; teardownStaff(); } return; }
      const uid = String(currentUser.id || '');
      if (uid === lastUid) return;
      lastUid = uid;
      await loadMe();
      if (me?.staff) setupStaff(); else teardownStaff();
    }, 700);
    onSocket((s) => {
        s.on('role:decided', ({ role, approved, revoked } = {}) => {
          if (role !== 'moderator') return;
          if (revoked) toast('Таны Moderator эрх цуцлагдлаа', 'warning', 6000);
          else if (approved) { toast('🎉 Баяр хүргэе! Та Moderator боллоо — нийтийн Room-д LAN тоглоом нээж бусдыг тоглуулах эрхтэй.', 'success', 8000); try { playSound('notify'); } catch {} }
          else toast('Таны Moderator хүсэлтийг татгалзлаа', 'warning', 6000);
          loadMe();
        });
    });
  }
  function teardownStaff() {
    document.body.classList.remove('gx-staff');
    $('gxo-menu')?.remove();
    const t = $('tab-owner'); if (t) { if (t.classList.contains('active')) { try { showTab('lobby'); } catch {} } t.remove(); }
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
    if (!setupStaff._bound) { setupStaff._bound = true; document.addEventListener('click', (e) => {
      const m = e.target.closest('[data-gxo]');
      if (m) { if (m.dataset.gxo === 'admin') { $('btn-admin-dashboard')?.click(); return; } openOwner(m.dataset.gxo); return; }
      const tb = e.target.closest('[data-gxo-tab]'); if (tb) { openOwner(tb.dataset.gxoTab); return; }
      const act = e.target.closest('[data-gxo-act]'); if (act) { ownerAction(act); }
      const row = e.target.closest('[data-gxo-user]'); if (row && !e.target.closest('button')) toggleDetail(row);
    }); }
    setBadge(me.pending_count || 0);
    onSocket((s) => s.on('staff:notify', (p = {}) => {
      if (typeof p.pending_count === 'number') setBadge(p.pending_count);
      if (p.type === 'role_auto') toast(`⚡ ${p.username} автоматаар Moderator боллоо${p.note ? ` — «${p.note}»` : ''}`, 'info', 6000);
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
    document.body.classList.remove('gx-roomview-on');   // өрөөний харагдацаас нээхэд самбар гүйлгэгдэнэ
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-owner'));
    document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('[data-gxo-tab]').forEach((b) => b.classList.toggle('on', b.dataset.gxoTab === curTab));
    renderOwner();
  }
  let ownerSeq = 0;
  async function renderOwner() {
    const body = $('gxo-body'); if (!body) return;
    const seq = ++ownerSeq;   // хоцорсон хариу өөр табын агуулгыг дарахгүй
    const typing = document.activeElement?.id === 'gxo-q';
    if (!typing) body.innerHTML = '<div class="gx-empty"><b>Ачааллаж байна…</b></div>';
    try {
      if (curTab === 'activity') {
        const r = await api('get', `/roles/activity?sort=${encodeURIComponent(actSort)}&q=${encodeURIComponent(actQ)}`);
        if (seq !== ownerSeq) return;
        const live = typing && $('gxo-q') ? $('gxo-q').value : null;   // ачаалах хооронд бичсэн тэмдэгтүүд алдагдахгүй
        body.innerHTML = `<div class="gxo-tools"><label class="gx-search"><svg><use href="#gx-i-search"/></svg><input id="gxo-q" type="text" placeholder="Хэрэглэгч хайх…" value="${esc(actQ)}" /></label>
          <select id="gxo-sort" class="input"><option value="active">Тоглосон цагаар</option><option value="games">Тоглолтын тоогоор</option><option value="hosted">LAN нээсэн тоогоор</option><option value="recent">Сүүлд идэвхтэйгээр</option><option value="new">Шинэ бүртгэлээр</option></select>
          <span class="gxo-hint">Мөр дээр дарвал өрөө нээсэн түүх, сүүлийн тоглолтууд</span></div>
          <div class="gxo-table"><div class="gxo-tr gxo-th"><span>Хэрэглэгч</span><span>Тоглосон цаг</span><span>Тоглолт</span><span>7 хоног</span><span>Хожил/Хож.</span><span>LAN нээсэн</span><span>Өрөө нээсэн</span><span>Сүүлд идэвхтэй</span><span></span></div>
          ${r.users.map(userRow).join('') || '<div class="gx-empty"><b>Олдсонгүй</b></div>'}</div>`;
        $('gxo-sort').value = actSort;
        $('gxo-sort').addEventListener('change', (e) => { actSort = e.target.value; renderOwner(); });
        let tmr; $('gxo-q').addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { actQ = e.target.value.trim(); renderOwner(); }, 350); });
        if (live != null) { const i = $('gxo-q'); i.value = live; i.focus(); i.setSelectionRange(live.length, live.length); if (live.trim() !== actQ) i.dispatchEvent(new Event('input')); }
      } else if (curTab === 'requests') {
        const r = await api('get', '/roles/requests?status=pending'); if (seq !== ownerSeq) return; setBadge(r.pending_count || 0);
        let au = null; try { au = await api('get', '/roles/auto'); } catch {}
        const auBar = au ? `<div class="gxo-auto ${au.active ? 'on' : ''}"><div><b>⚡ Автомат батлалт: ${au.active ? 'ИДЭВХТЭЙ' : 'унтраалттай'}</b>
            <span>${au.active ? `${new Date(au.until).toLocaleString('mn-MN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })} хүртэл шинэ Moderator хүсэлт шууд батлагдана.` : 'Хүсэлт бүрийг эзэн/админ гараар батална.'}</span></div>
            ${au.can_edit ? `<div class="gxo-auto-act">${au.active ? '<button type="button" class="btn btn-sm" data-gxo-act="auto" data-days="0">Унтраах</button>' : ''}<button type="button" class="btn btn-primary btn-sm" data-gxo-act="auto" data-days="7">${au.active ? '7 хоног сунгах' : '7 хоног асаах'}</button></div>` : ''}</div>` : '';
        body.innerHTML = auBar + (r.requests.length ? r.requests.map((q) => `<div class="gxo-card"><div class="gxo-card-main"><b>${esc(q.username)}</b> ${q.tier ? `<span class="gxo-tier">${esc(q.tier)}</span>` : ''} <span class="gxo-meta">${fmtAgo(q.created_at)} · ${q.wins}W/${q.losses}L</span>
            ${q.note ? `<p>«${esc(q.note)}»</p>` : '<p class="gxo-muted">Тайлбаргүй</p>'}</div>
            <div class="gxo-card-act"><button type="button" class="btn btn-primary btn-sm" data-gxo-act="approve" data-id="${q.id}">✓ Батлах</button><button type="button" class="btn btn-sm" data-gxo-act="reject" data-id="${q.id}">✕ Татгалзах</button></div></div>`).join('')
          : '<div class="gx-empty"><b>Хүлээгдэж буй хүсэлт алга</b><span>Шинэ хүсэлт ирэхэд энд гарч, дуут мэдэгдэл ирнэ.</span></div>');
      } else if (curTab === 'mods') {
        const r = await api('get', '/roles/moderators');
        body.innerHTML = r.moderators.length ? `<div class="gxo-table gxo-mods"><div class="gxo-tr gxo-th"><span>Moderator</span><span>Олгосон</span><span>Хэзээ</span><span></span></div>
          ${r.moderators.map((m) => `<div class="gxo-tr"><span><b>${esc(m.username)}</b> ${m.role === 'admin' ? '<span class="mod-badge admin">ADMIN</span>' : ''} ${m.tier ? `<span class="gxo-tier">${esc(m.tier)}</span>` : ''}</span><span>${esc(m.granted_by_name || '—')}</span><span>${fmtAgo(m.granted_at)}</span><span>${m.role === 'admin' ? '<small class="gxo-muted">нэр дээр баруун товч</small>' : `<button type="button" class="btn btn-sm" data-gxo-act="revoke" data-uid="${m.user_id}" data-name="${esc(m.username)}">Эрх хасах</button>`}</span></div>`).join('')}</div>`
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
      else if (a === 'auto') {
        const d = Number(b.dataset.days || 0);
        const r = await api('post', '/roles/auto', { days: d });
        toast(d ? `⚡ Автомат батлалт ${d} хоног идэвхтэй${r.swept ? ` — хүлээгдэж байсан ${r.swept} хүсэлт батлагдлаа` : ''}` : 'Автомат батлалт унтарлаа', d ? 'success' : 'info', 6000);
      }
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
      // эрх хожуу ирсэн бол Kick товч / AFK тэмдэг шууд гарна (дараагийн гишүүний өөрчлөлтийг хүлээхгүй)
      try { if (currentRoom.staff && Array.isArray(currentRoom.members) && typeof renderMembers === 'function') renderMembers(currentRoom.members); } catch {}
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
        if (me?.can_host_channel) btn = `<span class="gxn-role" title="LAN тоглоом нээх эрх: Moderator · Админ · Эзэн">${me.owner ? '👑 Эзэн' : me.staff ? '🛡 Админ' : '⭐ Moderator'} — LAN нээх эрхтэй (Moderator · Админ · Эзэн)</span>`;
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
