// ══════════════════════════════════════════════════════════════
// RGC (Ranked Gaming Client) маягийн нийтийн Room-ын дотоод цонх (2026-10-02, эзний хүсэлт)
//   ┌ баннер: өрөөний нэр · эрх ………………………………… [Гарах] ┐┌ миний карт: нэр · LV · XP ┐
//   │ зүүн: өрөөнүүд + Тоглоомын тохиргоо + Холболт + Moderator │ ЧАТ │ ГИШҮҮД (туг·нэр·Tier·LV) │ STARTED/OPEN GAMES + [НЭГДЭХ] │
//   └ доод цэс: MENU · FORUM · START · LADDER · SHOP ┘
// Зөвхөн нийтийн Room 1–20 (kind=channel). Хуучин элементүүдийг ID-тай нь зөөнө → app.js-ийн логик хэвээр.
// ══════════════════════════════════════════════════════════════
(function gxRGC() {
  const q = new URLSearchParams(location.search);
  if (q.get('mode') !== 'room' || q.get('kind') !== 'channel') return;
  const $ = (id) => document.getElementById(id);
  const gxr = $('gxr');
  if (!gxr || $('rgc')) return;
  const inFrame = window.parent && window.parent !== window;
  const esc = (t) => (typeof escHtml === 'function' ? escHtml(t ?? '') : String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const post = (type, extra) => { if (inFrame) { try { window.parent.postMessage({ gx: true, type, roomId: q.get('roomId'), ...(extra || {}) }, '*'); } catch {} } };

  // Тоглоом (2026-10-02): WC3 / CS 1.6 / Quake III / Red Alert 2 — баннер зураг, гарчиг, холболтын төлөв
  const GAME = { wc3: ['Warcraft III', 'wc3-room'], cs16: ['Counter-Strike 1.6', 'cs16'], q3: ['Quake III Arena', 'q3'], ra2: ['Red Alert 2', 'ra2'] };
  const gk = (typeof gameKindOf === 'function' ? gameKindOf(q.get('gameType')) : 'wc3');
  const [gameLabel, cover] = GAME[gk] || GAME.wc3;
  const isWc3 = gk === 'wc3' || !GAME[gk];
  document.body.classList.add('rgc', `rgc-${GAME[gk] ? gk : 'wc3'}`);
  const root = document.createElement('div');
  root.id = 'rgc';
  root.style.setProperty('--rgc-cover', `url('covers/${cover}.jpg')`);
  root.innerHTML = `
    <header class="rgc-top">
      <div class="rgc-banner">
        <img class="rgc-logo" src="logo.png" alt="" />
        <div class="rgc-btitle"><b id="rgc-title">${esc(q.get('roomName') || 'Room')}</b><span id="rgc-bsub">Garena.mn · ${esc(gameLabel)} · Нийтийн өрөө</span></div>
        <span id="rgc-privacy-slot"></span>
        <span class="rgc-rk" title="Ranked Room: хүчинтэй хожил бүр +2 💎 (1v1-ээс дээш, ≥12 мин, ялагчтай)">🏆 RANKED</span>
        <span class="rgc-fill"></span>
        <div class="rgc-actions" id="rgc-actions"></div>
      </div>
      <div class="rgc-me">
        <div class="rgc-me-h"><b id="rgc-me-name">—</b><span class="rgc-me-lv" id="rgc-me-lv">1</span></div>
        <div class="rgc-me-sub" id="rgc-me-sub">Онлайн</div>
        <div class="rgc-xp"><i id="rgc-xp-bar"></i><span id="rgc-xp-text">0 XP</span></div>
      </div>
    </header>
    <div class="rgc-main">
      <aside class="rgc-left">
        <div class="rgc-tree">
          <div class="rgc-tree-h">▾ Нийтийн өрөөнүүд</div>
          <div class="rgc-tree-i on"><i></i><span id="rgc-tree-name">${esc(q.get('roomName') || 'WC3 Room')}</span><em>[<b id="rgc-tree-n">0</b>]</em></div>
        </div>
        <div class="rgc-lsec" id="rgc-l-game"></div>
        <div class="rgc-lsec" id="rgc-l-conn"></div>
        <div class="rgc-lsec rgc-mod" id="rgc-mod"></div>
      </aside>
      <section class="rgc-chat" id="rgc-chat"></section>
      <section class="rgc-members">
        <div class="rgc-h"><span>Өрөөнд байгаа</span><b id="rgc-mcount">0</b></div>
        <div class="rgc-mhead"><span></span><span>Нэр</span><span>Tier</span><span>LV</span></div>
        <div id="rgc-mlist" class="rgc-mlist"></div>
      </section>
      <aside class="rgc-games">
        <div class="rgc-gsec"><div class="rgc-h"><span>STARTED GAMES</span><b id="rgc-st-n">0</b></div><div class="rgc-glist" id="rgc-started"></div></div>
        <div class="rgc-gsec rgc-gsec-open"><div class="rgc-h"><span>OPEN GAMES</span><b id="rgc-op-n">0</b></div><div class="rgc-glist" id="rgc-open"></div></div>
        <div class="rgc-gsec rgc-selsec"><div class="rgc-h"><span id="rgc-sel-h">СОНГОСОН ТОГЛООМ</span></div><div id="rgc-sel" class="rgc-sel"></div></div>
        <button type="button" class="rgc-sign" id="rgc-sign">НЭГДЭХ</button>
      </aside>
    </div>
    <nav class="rgc-nav">
      <button type="button" data-rgc="menu" title="Үндсэн цэс (лобби) руу буцах — өрөөнөөс гарахгүй">MENU</button>
      <button type="button" data-rgc="forum" title="Garena.mn Discord сервер">FORUM</button>
      <button type="button" data-rgc="start" class="start" id="rgc-start" title="">START<small id="rgc-start-sub"></small></button>
      <button type="button" data-rgc="ladder" title="Тоглогчдын жагсаалт (Ranking)">LADDER</button>
      <button type="button" data-rgc="shop" title="Silver / Gold гишүүнчлэл">SHOP</button>
    </nav>`;
  gxr.parentNode.insertBefore(root, gxr);
  gxr.classList.add('rgc-hidden');

  // ── Элементүүдийг зөөх ──
  const move = (el, dest) => { if (el && dest) dest.appendChild(el); return el; };
  move(gxr.querySelector('.gxr-game-card'), $('rgc-l-game'));
  move(gxr.querySelector('.gxr-conn'), $('rgc-l-conn'));
  // WC3 бус тоглоом: онлайн холболт хараахан бүрэн бэлэн биш — шударгаар мэдэгдэнэ (WC3 LAN relay-г ашиглахгүй)
  if (!isWc3) {
    const n = document.createElement('p'); n.className = 'rgc-soon';
    n.textContent = gk === 'ra2'
      ? `⏳ ${gameLabel}-ын онлайн холболт хөгжүүлэгдэж байна — удахгүй нээгдэнэ. Одоогоор өрөөнд цуглаж, чатлаж болно.`
      : `⏳ ${gameLabel}-ын сервер холболт туршилтын шатанд — удахгүй бүрэн нээгдэнэ. Одоогоор өрөөнд цуглаж, чатлаж болно.`;
    $('gxr-conn-body')?.prepend(n);
  }
  move(gxr.querySelector('.gxr-chat'), $('rgc-chat'));
  move($('gxr-privacy'), $('rgc-privacy-slot'));
  [...($('gxr-actions')?.children || [])].forEach((b) => move(b, $('rgc-actions')));
  move($('members-list'), $('rgc-mlist'));
  move($('btn-invite-friends'), $('rgc-mlist'));
  move($('invite-friends-dropdown'), $('rgc-mlist'));

  // ── Доод цэс ──
  root.querySelector('.rgc-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rgc]'); if (!b) return;
    const a = b.dataset.rgc;
    if (a === 'menu') $('gxr-back')?.click();   // gx-roomui → parent 'back'
    else if (a === 'forum') post('tab', { tab: 'discord' });
    else if (a === 'ladder') post('tab', { tab: 'ranking' });
    else if (a === 'shop') post('tab', { tab: 'premium' });
    else if (a === 'start') {
      if (isWc3) $('gxr-start')?.click();
      else { try { showToast(`⏳ ${gameLabel}-ын онлайн холболт удахгүй нээгдэнэ`, 'info', 4000); } catch {} }
    }
  });

  // ── W3GS GAMEINFO (0x30) задлах: тоглоомын нэр, map, тоглогч [used/total] ──
  // product(4) version(4) hostCounter(4) entryKey(4) | name\0 | 0x00 | encoded statstring\0 | slotsTotal(4) flags(4) slotsUsed(4) slotsAvail(4) uptime(4) port(2)
  const giCache = new Map();
  function parseGI(b64) {
    if (!b64) return null;
    if (giCache.has(b64)) return giCache.get(b64);
    let out = null;
    try {
      const bin = atob(b64); const b = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
      let o = 20;
      const cstr = () => { let e = o; while (e < b.length && b[e] !== 0) e++; const r = b.slice(o, e); o = e + 1; return r; };
      const td = new TextDecoder('utf-8');
      const name = td.decode(cstr());
      o += 1;
      const enc = cstr();
      const dec = []; let mask = 0;
      for (let i = 0; i < enc.length; i++) { if (i % 8 === 0) { mask = enc[i]; continue; } dec.push((mask & (1 << (i % 8))) ? enc[i] : enc[i] - 1); }
      const u32 = () => { const v = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; o += 4; return v; };
      const total = u32(); u32(); const used = u32(); const avail = u32();
      let p = 13, e = p; while (e < dec.length && dec[e] !== 0) e++;
      const mapPath = td.decode(new Uint8Array(dec.slice(p, e)));
      let e2 = e + 1; while (e2 < dec.length && dec[e2] !== 0) e2++;
      const hostName = td.decode(new Uint8Array(dec.slice(e + 1, e2)));
      const cap = avail > 0 && avail <= 24 ? avail : (total > 0 && total <= 24 ? total : 0);
      const players = used > 0 && used <= 24 ? Math.min(used, cap || used) : 0;
      out = { name, map: (mapPath.split(/[\\/]/).pop() || '').replace(/\.w3[xm]$/i, ''), hostName, players, cap };
    } catch { out = null; }
    giCache.set(b64, out);
    if (giCache.size > 200) giCache.delete(giCache.keys().next().value);
    return out;
  }

  // ── OPEN / STARTED GAMES ──
  let selected = null;
  const mmss = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${String(m).padStart(2, '0')}:${r}`; };
  function gameList() {
    const lan = window.gxLan; if (!lan) return [];
    return [...lan.games.values()].map((g) => ({ g, gi: parseGI(g.gameinfo_b64) }));
  }
  function gameTitle({ g, gi }) { return gi?.name || `${g.host_wc3_name || g.host_username || 'Тоглогч'}-ийн тоглоом`; }
  function renderGames() {
    const lan = window.gxLan; const myId = String((typeof currentUser !== 'undefined' && currentUser?.id) || '');
    const all = gameList();
    const open = all.filter((x) => !x.g.started_at).sort((a, b) => (a.g.created_at || 0) - (b.g.created_at || 0));
    const started = all.filter((x) => x.g.started_at).sort((a, b) => (b.g.started_at || 0) - (a.g.started_at || 0));
    if (selected && !all.some((x) => x.g.game_token === selected)) selected = null;
    if (!selected && open.length === 1) selected = open[0].g.game_token;
    $('rgc-op-n').textContent = String(open.length);
    $('rgc-st-n').textContent = String(started.length);
    $('rgc-open').innerHTML = open.length ? open.map((x) => {
      const mine = String(x.g.host_user_id) === myId; const joined = lan?.joined === x.g.game_token;
      const slots = x.gi?.cap ? ` [${x.gi.players}/${x.gi.cap}]` : '';
      return `<div class="rgc-g ${selected === x.g.game_token ? 'sel' : ''} ${mine ? 'mine' : ''} ${joined ? 'joined' : ''}" data-tok="${esc(x.g.game_token)}" title="Хост: ${esc(x.g.host_wc3_name || x.g.host_username || '')}${x.gi?.map ? ` · Map: ${esc(x.gi.map)}` : ''} — 2 товшвол нэгдэнэ">${mine ? '★ ' : joined ? '✓ ' : ''}${esc(gameTitle(x))}<b>${slots}</b></div>`;
    }).join('') : '<div class="rgc-empty">Нээлттэй тоглоом алга</div>';
    $('rgc-started').innerHTML = started.length ? started.map((x) => `<div class="rgc-g st ${selected === x.g.game_token ? 'sel' : ''}" data-tok="${esc(x.g.game_token)}" title="Хост: ${esc(x.g.host_wc3_name || x.g.host_username || '')}">${esc(gameTitle(x))} <b data-st="${x.g.started_at}">[${mmss(Date.now() - x.g.started_at)}]</b></div>`).join('') : '<div class="rgc-empty">Эхэлсэн тоглоом алга</div>';
    renderSel(all);
  }
  function renderSel(all = gameList()) {
    const x = all.find((y) => y.g.game_token === selected);
    const box = $('rgc-sel');
    if (!x) {
      $('rgc-sel-h').textContent = 'СОНГОСОН ТОГЛООМ';
      box.innerHTML = '<div class="rgc-empty">OPEN GAMES-ээс тоглоом сонго</div>';
    } else {
      $('rgc-sel-h').textContent = x.g.started_at ? 'ЭХЭЛСЭН ТОГЛООМ' : 'СОНГОСОН ТОГЛООМ';
      const kv = (k, v) => (v ? `<div><span>${k}</span><b>${esc(v)}</b></div>` : '');
      box.innerHTML = kv('Тоглоом', gameTitle(x)) + kv('Хост', x.g.host_wc3_name || x.g.host_username) + kv('Map', x.gi?.map)
        + kv('Тоглогч', x.gi?.cap ? `${x.gi.players}/${x.gi.cap}` : '') + kv(x.g.started_at ? 'Үргэлжилсэн' : 'Нээгдсэн', x.g.started_at ? mmss(Date.now() - x.g.started_at) : (x.g.created_at ? `${mmss(Date.now() - x.g.created_at)} өмнө` : ''));
    }
    syncSign();
  }
  function onGameClick(e, join) {
    const r = e.target.closest('.rgc-g[data-tok]'); if (!r) return;
    selected = r.dataset.tok; renderGames();
    if (join) signAction();
  }
  ['rgc-open', 'rgc-started'].forEach((id) => {
    $(id).addEventListener('click', (e) => onGameClick(e, false));
    $(id).addEventListener('dblclick', (e) => onGameClick(e, true));
  });
  document.addEventListener('garena:lan-games', () => renderGames());

  // ── [НЭГДЭХ] товч (RGC-ийн SIGN шиг): сонгосон тоглоомд нэгдэх / өөрийнхөө тоглоомыг зогсоох / LAN нээх / Moderator хүсэлт ──
  function signState() {
    if (!isWc3) return ['none', 'УДАХГҮЙ', true];   // CS/Q3/RA2 — тоглоомын холболт удахгүй
    const lan = window.gxLan; const myId = String((typeof currentUser !== 'undefined' && currentUser?.id) || '');
    const x = selected && lan?.games.get(selected);
    const me = window.gxRoleMe?.();
    if (x && String(x.host_user_id) === myId) return ['stop', 'ЗОГСООХ', false];
    if (x && !x.started_at) return lan.joined === selected ? ['join', '✓ НЭГДСЭН', false] : ['join', 'НЭГДЭХ', false];
    if (lan?.hosting) return ['stop', 'ЗОГСООХ', false];
    if (typeof currentRoom !== 'undefined' && currentRoom?.canHostChannel) return ['host', 'LAN НЭЭХ', false];
    if (me?.pending) return ['none', 'ХҮСЭЛТ ХҮЛЭЭГДЭЖ БАЙНА', true];
    return ['modreq', 'MODERATOR ХҮСЭЛТ', false];
  }
  function syncSign() {
    const [act, label, dis] = signState(); const b = $('rgc-sign');
    b.textContent = label; b.disabled = dis; b.dataset.act = act;
  }
  async function signAction() {
    const [act] = signState();
    if (act === 'join' && selected) window.gxLan?.join(selected);
    else if (act === 'stop') $('btn-lan-stop')?.click();
    else if (act === 'host') $('btn-lan-host')?.click();
    else if (act === 'modreq' && window.gxRequestModerator) { await window.gxRequestModerator(); renderMod(); }
    setTimeout(renderGames, 400);
  }
  $('rgc-sign').addEventListener('click', signAction);

  // ── Moderator хэсэг (зүүн багана): эрхийн тайлбар + хүсэлт илгээх товч ──
  function renderMod() {
    const me = window.gxRoleMe?.(); const box = $('rgc-mod');
    const who = me?.owner ? '👑 Эзэн' : me?.staff ? '🛡 Админ' : me?.role === 'moderator' ? '⭐ Moderator' : 'Гишүүн';
    let action;
    if (me?.can_host_channel) action = `<p class="ok">✓ Та LAN тоглоом нээх эрхтэй.</p>${me.staff ? '<p class="dim">Ирсэн Moderator хүсэлтийг эзний цэс → «Moderator хүсэлт»-ээс батална.</p>' : ''}`;
    else if (me?.pending) action = '<p class="warn">⏳ Таны Moderator хүсэлт хүлээгдэж байна — эзэн шалгаад батална.</p>';
    else action = '<p class="dim">LAN тоглоом нээхийн тулд «Тоглоом дотор өрөө үүсгэх заавар» доорх товчоор Moderator эрх хүснэ.</p>';
    box.innerHTML = `<h3>🛡 Эрх</h3><div class="rgc-kv"><span>Таны эрх</span><b>${who}</b></div>
      <p class="dim">LAN тоглоом нээх эрх: <b>Moderator · Админ · Эзэн</b></p>${action}`;
    // «Тоглоом дотор өрөө үүсгэх заавар» доорх Moderator эрх хүсэх товч (2026-10-02, эзний хүсэлт) — хүн бүрт харагдана
    const hm = $('rgc-howto-mod');
    if (hm) hm.innerHTML = me?.can_host_channel
      ? `<button type="button" class="rgc-btn" disabled title="Та аль хэдийн LAN нээх эрхтэй">✓ ${me.owner ? 'Эзэн' : me.staff ? 'Админ' : 'Moderator'} — LAN нээх эрхтэй</button>`
      : me?.pending ? '<button type="button" class="rgc-btn" disabled>⏳ Moderator хүсэлт хүлээгдэж байна</button>'
      : '<button type="button" class="rgc-btn" id="rgc-modreq">🛡 Moderator эрх хүсэх</button><small>Moderator нь энэ Room-д LAN тоглоом нээж бусдыг тоглуулна.</small>';
    syncSign();
  }
  // Заавар хэсэгт товчны байр
  (function mountHowtoMod() {
    const ht = document.querySelector('#rgc-l-game .gxr-howto'); if (!ht || $('rgc-howto-mod')) return;
    const d = document.createElement('div'); d.id = 'rgc-howto-mod'; d.className = 'rgc-howto-mod';
    ht.appendChild(d);
    d.addEventListener('click', async (e) => { if (e.target.closest('#rgc-modreq') && window.gxRequestModerator) { await window.gxRequestModerator(); renderMod(); } });
  })();
  $('rgc-mod').addEventListener('click', async (e) => {
    if (e.target.closest('#rgc-modreq') && window.gxRequestModerator) { await window.gxRequestModerator(); renderMod(); }
  });
  document.addEventListener('gx:me', renderMod);
  document.addEventListener('garena:host-changed', () => { renderMod(); renderGames(); });

  // ── Гишүүд: LV/XP (membership/public), эрэмбэ: ADMIN → MOD → LV ──
  const lvCache = new Map(); let fetching = false;
  async function fetchLv(ids) {
    if (fetching || !ids.length || !window.api?.request) return;
    fetching = true;
    try {
      const rows = await window.api.request('get', `/membership/public?ids=${ids.slice(0, 200).join(',')}`);
      (rows || []).forEach((r) => lvCache.set(String(r.id), { level: Number(r.level) || 1, xp: Number(r.xp) || 0, wins: Number(r.wins) || 0, tier: r.tier || 'bronze' }));
      ids.forEach((id) => { if (!lvCache.has(id)) lvCache.set(id, { level: 1, xp: 0, tier: 'bronze' }); });
    } catch { ids.forEach((id) => lvCache.set(id, lvCache.get(id) || { level: 1, xp: 0, tier: 'bronze' })); }
    fetching = false;
    paintMembers();
  }
  let painting = false;
  function paintMembers() {
    const ul = $('members-list'); if (!ul || painting) return;
    painting = true;
    const lis = [...ul.children];
    const need = [];
    lis.forEach((li) => {
      const id = li.dataset.uid; if (!id) return;
      const c = lvCache.get(id);
      if (!c) { need.push(id); return; }
      const lv = li.querySelector('.m-lv'); if (lv) lv.textContent = String(c.level);
      li.classList.toggle('t-gold', c.tier === 'gold'); li.classList.toggle('t-silver', c.tier === 'silver');
      li.dataset.lv = String(c.level); li.dataset.wins = String(c.wins || 0);
    });
    // Эрэмбэ (2026-10-02, эзэн): 👑 Эзэн → ADMIN → Moderator → Tier (1-1 хамгийн өндөр) → хожил → Level
    const rank = (li) => (li.classList.contains('r-owner') ? 3 : li.classList.contains('r-admin') ? 2 : li.classList.contains('r-mod') ? 1 : 0);
    const tierPts = (li) => { const m = /^([1-4])-([1-3])$/.exec(li.dataset.tier || ''); return m ? (5 - Number(m[1])) * 12 - (Number(m[2]) - 1) * 4 : 0; };
    const sorted = lis.slice().sort((a, b) => (rank(b) - rank(a)) || (tierPts(b) - tierPts(a)) || (Number(b.dataset.wins || 0) - Number(a.dataset.wins || 0)) || (Number(b.dataset.lv || 0) - Number(a.dataset.lv || 0)));
    if (sorted.some((li, i) => li !== lis[i])) sorted.forEach((li) => ul.appendChild(li));
    $('rgc-mcount').textContent = String(lis.length);
    $('rgc-tree-n').textContent = String(lis.length);
    painting = false;
    if (need.length) fetchLv(need);
  }
  const ml = $('members-list');
  if (ml) new MutationObserver(() => { if (!painting) paintMembers(); }).observe(ml, { childList: true });

  // ── Миний карт (баруун дээд) ──
  function paintMe() {
    const u = typeof currentUser !== 'undefined' ? currentUser : null; if (!u) return;
    const level = Number(u.level ?? 1); const xp = Number(u.xp ?? 0);
    const nextXp = u.next_level_xp || Math.round(100 * Math.pow(level + 1, 1.5));
    const curXp = Math.round(100 * Math.pow(level, 1.5));
    const prog = Math.max(0, Math.min(1, (xp - curXp) / Math.max(1, nextXp - curXp)));
    $('rgc-me-name').textContent = u.username || '—';
    $('rgc-me-lv').textContent = String(level);
    $('rgc-xp-bar').style.width = `${Math.round(prog * 100)}%`;
    $('rgc-xp-text').textContent = `${xp.toLocaleString('en-US')} XP`;
    const me = window.gxRoleMe?.();
    $('rgc-me-sub').textContent = `${me?.owner ? '👑 Эзэн' : me?.staff ? '🛡 Админ' : me?.role === 'moderator' ? '⭐ Moderator' : 'Гишүүн'}${u.diamonds != null ? ` · 💎 ${u.unlimited_diamonds ? '∞' : Number(u.diamonds).toLocaleString('en-US')}` : ''}`;
  }

  // 🏆 Ranked Room 1–5 — баннерт тэмдэг, тайлбарт Ranked/энгийн
  (async () => {
    let meta = null; try { meta = await window.api.getMyRoom?.(); } catch {}
    const own = meta && String(meta.id) === String(q.get('roomId'));
    const ranked = isWc3 && (own ? !!meta.ranked : /\bRoom\s*[1-5]$/i.test(q.get('roomName') || ''));
    root.classList.toggle('ranked', ranked);
    const sub = root.querySelector('.rgc-btitle span');
    if (sub) sub.textContent = ranked ? `Garena.mn · ${gameLabel} · Ranked өрөө · хожил бүр +2 💎` : `Garena.mn · ${gameLabel} · Нийтийн өрөө${isWc3 ? ' · XP' : ''}`;
  })();

  // ── Тогтмол синк ──
  function tick() {
    paintMe();
    const gs = $('gxr-start'); const sub = $('rgc-start-sub');
    if (gs && sub) { const t = isWc3 ? (gs.querySelector('span')?.textContent || '') : 'Удахгүй'; sub.textContent = t; $('rgc-start').title = t; $('rgc-start').classList.toggle('dim', gs.disabled); }
    const rt = $('room-title')?.textContent; if (rt) { $('rgc-title').textContent = rt; $('rgc-tree-name').textContent = rt; }
    document.querySelectorAll('#rgc-started [data-st]').forEach((b) => { b.textContent = `[${mmss(Date.now() - Number(b.dataset.st))}]`; });
    syncSign();
  }
  setInterval(tick, 1000); setTimeout(() => { tick(); renderMod(); renderGames(); paintMembers(); }, 60);
})();
