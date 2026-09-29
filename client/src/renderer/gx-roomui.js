// ══════════════════════════════════════════════════════════════
// GX өрөөний хуудас (2.9.4) — GameRanger X-ийн lobby бүтэц:
//   [← Лобби] Нэр [Нийтийн/Нууц/Клан] ………… [Өрөө хаах | Гарах] [▶ Тоглоом эхлүүлэх]
//   ┌ Тоглогчид (N) | Тохиргоо ┐ ┌ Тоглоомын тохиргоо ┐ ┌ Холболт ┐
//   │ жагсаалт                 │ └───────────── Лобби чат ─────────┘
// Хуучин элементүүдийг (ID-тай нь) шинэ байршил руу ЗӨӨНӨ → app.js/gx-ipgame.js-ийн логик өөрчлөгдөхгүй.
// ══════════════════════════════════════════════════════════════
(function gxRoomUI() {
  const q = new URLSearchParams(location.search);
  if (q.get('mode') !== 'room') return;
  const $ = (id) => document.getElementById(id);
  const page = $('page-room'); const old = page?.querySelector('.room-layout');
  if (!page || !old || $('gxr')) return;
  const inFrame = window.parent && window.parent !== window;
  const svg = (id) => `<svg class="btn-icon-svg"><use href="#${id}"/></svg>`;

  const root = document.createElement('div');
  root.id = 'gxr'; root.className = 'gxr';
  root.innerHTML = `
    <div class="gxr-bar">
      <button type="button" class="btn btn-sm gxr-back" id="gxr-back">${svg('gx-i-left')}Лобби</button>
      <h2 class="gxr-title" id="gxr-title-slot"></h2>
      <span class="gxr-pill" id="gxr-privacy">Нийтийн</span>
      <span class="gxr-game" id="gxr-game-slot"></span>
      <span class="gxr-fill"></span>
      <span id="gxr-actions"></span>
      <button type="button" class="btn btn-primary gxr-start" id="gxr-start">${svg('gx-i-play')}<span>Тоглоом эхлүүлэх</span></button>
    </div>
    <div class="gxr-grid">
      <aside class="gxr-card gxr-left">
        <div class="gxr-tabs" role="tablist">
          <button type="button" class="on" data-gxr-tab="players">${svg('gx-i-users')}<span>Тоглогчид (<b id="gxr-count">0</b>)</span></button>
          <button type="button" data-gxr-tab="settings">${svg('gx-i-gear')}<span>Тохиргоо</span></button>
        </div>
        <div class="gxr-pane on" data-gxr-pane="players" id="gxr-players"></div>
        <div class="gxr-pane" data-gxr-pane="settings" id="gxr-settings"></div>
      </aside>
      <section class="gxr-card gxr-game-card">
        <h3>${svg('gx-i-games')}Тоглоомын тохиргоо</h3>
        <div class="gxr-kv"><span>Тоглоом</span><b id="gxr-game">-</b></div>
        <div class="gxr-kv"><span>Горим</span><b id="gxr-mode">-</b></div>
        <div class="gxr-kv"><span>Дээд тоглогч</span><b id="gxr-max">-</b></div>
        <div class="gxr-kv"><span>Төлөв</span><b id="gxr-status">Хүлээлгийн өрөө</b></div>
        <details class="gxr-howto" open>
          <summary>${svg('gx-i-info')}Тоглоом дотор өрөө үүсгэх заавар</summary>
          <p id="gxr-howto-text">Хост: Local Area Network → Create Game → map сонгоно → Create Game<br>Тоглогчид: Local Area Network → үүссэн тоглоомыг сонгоно → Join Game</p>
        </details>
      </section>
      <section class="gxr-card gxr-conn">
        <h3>${svg('gx-i-bolt')}Холболт <span class="gxr-conn-state" id="gxr-conn-state">Бэлэн</span></h3>
        <div id="gxr-conn-body"></div>
      </section>
      <section class="gxr-card gxr-chat">
        <h3>${svg('gx-i-msg')}Лобби чат</h3>
        <div id="gxr-chat-body" class="gxr-chat-body"></div>
      </section>
    </div>`;
  page.insertBefore(root, old);
  old.classList.add('gxr-old');

  // ── Элементүүдийг зөөх ──
  const move = (id, dest) => { const el = $(id); if (el && dest) dest.appendChild(el); return el; };
  move('room-title', $('gxr-title-slot'));
  move('room-badge', $('gxr-game-slot'));
  move('btn-leave-room', $('gxr-actions'));
  move('btn-close-room', $('gxr-actions'));
  move('members-list', $('gxr-players'));
  move('btn-invite-friends', $('gxr-players'));
  move('invite-friends-dropdown', $('gxr-players'));
  const set = $('gxr-settings');
  const info = document.createElement('div'); info.className = 'gxr-info';
  info.innerHTML = '<div class="gxr-kv"><span>Таны эрх</span><b id="gxr-role">-</b></div><div class="gxr-kv"><span>Өрөө</span><b id="gxr-roomno">-</b></div>';
  set.appendChild(info);
  move('max-players-row', set);
  move('lan-host-panel', $('gxr-conn-body'));
  move('ip-game-panel', $('gxr-conn-body'));
  move('chat-messages', $('gxr-chat-body'));
  const chatRow = old.querySelector('.chat-input-row'); if (chatRow) $('gxr-chat-body').appendChild(chatRow);
  const closeBtn = $('btn-close-room'); if (closeBtn) { closeBtn.className = 'btn btn-sm btn-danger-soft gxr-danger'; closeBtn.innerHTML = `${svg('ico-trash')}<span>Өрөө хаах</span>`; }
  const leaveBtn = $('btn-leave-room'); if (leaveBtn) { leaveBtn.className = 'btn btn-sm btn-danger-soft gxr-danger'; leaveBtn.innerHTML = `${svg('gx-i-out')}<span>Гарах</span>`; }

  // ── Товчнууд ──
  $('gxr-back').addEventListener('click', () => {
    if (inFrame) { try { window.parent.postMessage({ gx: true, type: 'back', roomId: q.get('roomId') }, '*'); } catch {} }
  });
  if (!inFrame) $('gxr-back').classList.add('hidden-keep');
  document.querySelectorAll('[data-gxr-tab]').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('[data-gxr-tab]').forEach((x) => x.classList.toggle('on', x === b));
    document.querySelectorAll('[data-gxr-pane]').forEach((p) => p.classList.toggle('on', p.dataset.gxrPane === b.dataset.gxrTab));
  }));

  const vis = (el) => !!el && el.offsetParent !== null && !el.classList.contains('hidden');
  const startBtn = $('gxr-start'); const startLbl = startBtn.querySelector('span');
  function startTarget() {
    const host = !!(typeof currentRoom !== 'undefined' && currentRoom?.isHost);
    if (document.body.classList.contains('ipgame-room')) {
      if (host) { const row = $('ipg-host-row'); return row && !row.classList.contains('hidden') ? [$('btn-ipg-host'), 'Сервер нээх'] : [$('btn-ipg-relaunch'), 'Тоглоом дахин нээх']; }
      return [$('btn-ipg-join'), 'Нэгдэх'];
    }
    if (host) {
      const lh = $('btn-lan-host');
      return lh && !lh.classList.contains('hidden') ? [lh, 'Тоглоом эхлүүлэх'] : [null, 'Тоглоом нээлттэй'];
    }
    const j = document.querySelector('#lan-games-list [data-join]:not(.joined)');
    return j ? [j, 'Нэгдэх'] : [null, document.querySelector('#lan-games-list .joined') ? 'WC3-д нээгдсэн' : 'Хостыг хүлээж байна'];
  }
  startBtn.addEventListener('click', () => { const [t] = startTarget(); t?.click(); });

  // ── Тогтмол синк (текст, төлөв, тоо) ──
  let meta = null;
  (async () => { try { meta = await window.api.getMyRoom?.(); } catch {} })();
  function sync() {
    const [t, label] = startTarget();
    startLbl.textContent = label; startBtn.disabled = !t;
    const cr = (typeof currentRoom !== 'undefined' && currentRoom) || {};
    const n = document.querySelectorAll('#members-list > li').length;
    $('gxr-count').textContent = String(n);
    $('gxr-game').textContent = cr.gameType || '-';
    $('gxr-max').textContent = String(cr.maxPlayers || '-');
    $('gxr-status').textContent = cr.status === 'playing' ? 'Тоглолт явагдаж байна' : 'Хүлээлгийн өрөө';
    $('gxr-role').textContent = cr.isHost ? 'Хост' : 'Оролцогч';
    $('gxr-roomno').textContent = cr.id ? `#${cr.id}` : '-';
    if (meta && String(meta.id) === String(cr.id)) {
      $('gxr-mode').textContent = (meta.game_mode || 'Custom').toUpperCase() + (meta.ranked ? ' · 🏆 Ranked' : '');
      const p = $('gxr-privacy');
      p.textContent = meta.clan_id ? `🛡 ${meta.clan_tag || 'Клан'}` : meta.has_password ? '🔒 Нууц үгтэй' : 'Нийтийн';
      p.dataset.kind = meta.clan_id ? 'clan' : meta.has_password ? 'lock' : 'public';
    }
    const st = $('ipg-state')?.closest('.ip-game-panel:not(.hidden)') ? $('ipg-state') : $('lan-host-state');
    const cs = $('gxr-conn-state');
    if (st && cs) { cs.textContent = st.textContent || 'Бэлэн'; cs.dataset.state = st.dataset.state || 'idle'; }
    if (document.body.classList.contains('ipgame-room')) $('gxr-howto-text').innerHTML = 'Хост: «Сервер нээх» → тоглоом сервертэйгээ нээгдэнэ.<br>Тоглогчид: «Нэгдэх» → тоглоом серверт автоматаар холбогдоно.';
  }
  setInterval(sync, 700); setTimeout(sync, 50);
})();
