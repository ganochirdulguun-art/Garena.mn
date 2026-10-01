// ══════════════════════════════════════════════════════════════
// Тоглоомын каталог (2.9.5) — GameRanger X-ийн Games → Browse шиг, БҮХ хэрэглэгчид ижил жагсаалт.
// Cover-ууд нь Garena.mn-ийн өөрийн загвар (CSS/SVG) — албан ёсны хайрцагны зургийг (зохиогчийн эрхтэй) ашиглахгүй.
// «Миний сан» = энэ PC дээр Тохиргоо → Тоглоомд бүртгэсэн exe (каталогийн тоглоомтой автоматаар таарна).
// ══════════════════════════════════════════════════════════════
(function gxCatalog() {
  if (new URLSearchParams(location.search).get('mode')) return;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => escHtml(t ?? '');
  const CATALOG = [
    { id: 'wc3', title: 'Warcraft III: The Frozen Throne', short: 'Frozen Throne', ver: '1.26a', genre: 'Стратеги · RTS', net: 'УБ relay (~12мс)', status: 'ready',
      desc: 'DotA, LoD, IMBA зэрэг map-тай. Ranked, XP, Diamond бүрэн ажиллана.', buy: 'https://shop.battle.net/product/warcraft-iii-reforged', cls: 'cv-wc3', mark: 'III' },
    { id: 'cs16', title: 'Counter-Strike 1.6', short: 'Counter-Strike', ver: '1.6', genre: 'Буудлага · FPS', net: 'Удахгүй', status: 'soon',
      desc: 'Хост өөрийн PC дээр сервер нээж, өрөөний гишүүд нэг товчоор нэгдэнэ. УБ relay-ээр холбох хөгжүүлэлтэд байна.', buy: 'https://store.steampowered.com/app/10/CounterStrike/', cls: 'cv-cs', mark: '1.6' },
    { id: 'q3', title: 'Quake III Arena', short: 'Quake III', ver: '1.32', genre: 'Буудлага · Arena', net: 'Удахгүй', status: 'soon',
      desc: 'Хурдан arena буудлага. УБ relay-ээр холбох хөгжүүлэлтэд байна.', buy: 'https://store.steampowered.com/app/2200/Quake_III_Arena/', cls: 'cv-q3', mark: 'III' },
    { id: 'ra2', title: "Command & Conquer: Red Alert 2", short: 'Red Alert 2', ver: "Yuri's Revenge", genre: 'Стратеги · RTS', net: 'Удахгүй', status: 'soon',
      desc: 'LAN broadcast гүүр хөгжүүлэлтэд байна. Удахгүй нэмэгдэнэ.', buy: 'https://store.steampowered.com/bundle/39394/', cls: 'cv-ra2', mark: '2' },
  ];
  // «Хэрэглэгчдийн хүсэж буй тоглоомууд» (2026-10-01): эрх эзэмшигчээс албан ёсны зөвшөөрөл хүсэж буй тоглоомууд.
  // Худал «удахгүй» амлахгүй — шошго «Зөвшөөрөл хүсэж байна», хэрэглэгч ❤-ээр санал өгнө (сервер /wishes).
  const WISHES = [
    { id: 'umk3', title: 'Ultimate Mortal Kombat 3', genre: 'Тулаан · Fighting', year: '1995', owner: 'Warner Bros. Games', desc: 'Sub-Zero, Scorpion, Kabal… Fatality-тай домогт тулааны тоглоом.' },
    { id: 'ctr', title: 'Crash Team Racing', genre: 'Уралдаан · Kart', year: '1999', owner: 'Activision', desc: 'Crash болон найзуудын карт уралдаан — 4 хүн хамтдаа.' },
    { id: 'goldeneye', title: 'GoldenEye 007', genre: 'Буудлага · FPS', year: '1997', owner: 'Nintendo · Rare · MGM', desc: 'James Bond — 4 тоглогчийн домогт DeathMatch.' },
  ];
  let wishData = null, wishLoading = false;
  async function loadWishes(force) {
    if (wishLoading || (wishData && !force)) return;
    wishLoading = true;
    try { wishData = await window.api.request('get', '/wishes'); } catch { wishData = wishData || { counts: {}, mine: [] }; }
    wishLoading = false; renderWishes();
  }
  function wishCard(w) {
    const n = Number(wishData?.counts?.[w.id] || 0); const mine = (wishData?.mine || []).includes(w.id);
    return `<article class="gxc gxw">
      <div class="gxc-cover">
        <img class="gxc-img" src="covers/${w.id}.jpg" alt="${esc(w.title)}" loading="lazy" draggable="false" />
        <span class="gxc-shade"></span>
        <span class="gxc-tag wish" title="Garena.mn эрх эзэмшигч (${esc(w.owner)})-ээс албан ёсны зөвшөөрөл хүсэж байна">Зөвшөөрөл хүсэж байна</span>
      </div>
      <div class="gxc-body">
        <h4 title="${esc(w.title)}">${esc(w.title)}</h4>
        <div class="gxc-meta"><span>${esc(w.genre)}</span><span class="gxc-ver">${esc(w.year)}</span></div>
        <p>${esc(w.desc)}</p>
        <div class="gxw-owner">Эрх эзэмшигч: ${esc(w.owner)}</div>
        <button type="button" class="gxw-btn ${mine ? 'on' : ''}" data-wish="${w.id}" ${wishData ? '' : 'disabled'}>
          <span class="gxw-heart">${mine ? '❤' : '♡'}</span><span>${mine ? 'Та хүссэн' : 'Тоглохыг хүсэж байна'}</span><b>${wishData ? n : '…'}</b>
        </button>
      </div>
    </article>`;
  }
  function renderWishes() {
    const grid = $('gx-games-grid'); if (!grid) return;
    let sec = $('gxw-sec');
    const list = WISHES.filter((w) => !q || `${w.title} ${w.genre}`.toLowerCase().includes(q));
    if (tab !== 'browse' || !list.length) { sec?.remove(); return; }
    if (!sec) { sec = document.createElement('section'); sec.id = 'gxw-sec'; sec.className = 'gxw-sec'; grid.insertAdjacentElement('afterend', sec); }
    const total = Object.values(wishData?.counts || {}).reduce((a, b) => a + Number(b || 0), 0);
    sec.innerHTML = `<div class="gxw-head"><div><h3>❤ Хэрэглэгчдийн хүсэж буй тоглоомууд</h3>
      <p>Эдгээр хуучны дурсамжтай тоглоомыг Garena.mn-д нэмэхээр эрх эзэмшигчдээс <b>албан ёсны зөвшөөрөл хүсэж байна</b>. Тоглохыг хүсэж байвал ❤ дарж санал өгөөрэй — таны санал зөвшөөрөл авахад тусална.</p></div>
      ${wishData ? `<span class="gxw-total"><b>${total}</b> санал</span>` : ''}</div>
      <div class="gx-games-grid gxc-grid">${list.map(wishCard).join('')}</div>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-wish]'); if (!b) return;
    e.stopPropagation(); b.disabled = true;
    try { const r = await window.api.request('post', `/wishes/${encodeURIComponent(b.dataset.wish)}`); wishData = { counts: r.counts, mine: r.mine }; if (r.wished) showToast('❤ Санал тань бүртгэгдлээ. Баярлалаа!', 'success', 3000); }
    catch (err) { showToast('Санал өгч чадсангүй. Дахин оролдоно уу.', 'error', 3500); }
    renderWishes();
  });
  /** exe нэр/зам эсвэл өрөөний game_type → каталогийн id */
  function kindOf(s) {
    const h = String(s || '').toLowerCase();
    if (/war3|warcraft|frozen throne|wc3|dota|\blod\b|imba/.test(h)) return 'wc3';
    if (/cstrike|counter[-\s]?strike|\bcs\s?1\.6|hl\.exe|\bhl\b/.test(h)) return 'cs16';
    if (/quake\s?(3|iii)|ioquake3|quake3|\bq3/.test(h)) return 'q3';
    if (/red alert|ra2|gamemd|yuri/.test(h)) return 'ra2';
    return null;
  }
  let tab = 'browse', q = '';
  const favs = () => { try { return new Set(JSON.parse(localStorage.getItem('gx_fav_games') || '[]')); } catch { return new Set(); } };
  const saveFavs = (s) => { try { localStorage.setItem('gx_fav_games', JSON.stringify([...s])); } catch {} };

  function localFor(id) { return ((typeof configuredGames !== 'undefined' && configuredGames) || []).filter((g) => kindOf(`${g.name} ${g.path}`) === id); }
  function card(c) {
    const rooms = Object.values(roomsCache || {}).filter((r) => kindOf(r.game_type) === c.id);
    const players = rooms.reduce((a, r) => a + Number(r.player_count || 0), 0);
    const local = localFor(c.id); const inst = local.length > 0; const fav = favs().has(c.id);
    const act = c.status === 'soon'
      ? '<button type="button" class="btn btn-sm" disabled>Удахгүй</button>'
      : inst
        ? `<button type="button" class="btn btn-primary btn-sm" data-gx-create="${esc(local[0].name)}">Өрөө үүсгэх</button><button type="button" class="btn btn-sm" data-gx-rooms="${esc(local[0].name)}">Өрөөнүүд</button>`
        : `<button type="button" class="btn btn-primary btn-sm" data-gx-click="btn-add-game" title="Компьютер дээрээ суулгасан exe-ээ сонгоно">Тоглоом нэмэх</button><button type="button" class="btn btn-sm" data-open-url="${esc(c.buy)}" title="Албан ёсоор худалдаж авах">Авах</button>`;
    return `<article class="gxc ${c.status === 'soon' ? 'soon' : ''}">
      <div class="gxc-cover ${c.cls}">
        <img class="gxc-img" src="covers/${c.id}.jpg" alt="${esc(c.title)}" loading="lazy" draggable="false" />
        <span class="gxc-shade"></span>
        ${inst ? '<span class="gxc-tag ok">Суулгасан</span>' : c.status === 'soon' ? '<span class="gxc-tag soon">Удахгүй</span>' : ''}
        <button type="button" class="gxc-fav ${fav ? 'on' : ''}" data-fav="${c.id}" title="Дуртай">${fav ? '★' : '☆'}</button>
        <span class="gxc-stats"><span><svg><use href="#gx-i-users"/></svg>${players}</span><span><svg><use href="#gx-i-lobby"/></svg>${rooms.length}</span></span>
      </div>
      <div class="gxc-body">
        <h4 title="${esc(c.title)}">${esc(c.title)}</h4>
        <div class="gxc-meta"><span>${esc(c.genre)}</span><span class="gxc-ver">${esc(c.ver)}</span></div>
        <p>${esc(c.desc)}</p>
        <div class="gxc-net"><svg><use href="#gx-i-bolt"/></svg>${esc(c.net)}</div>
        <div class="gx-game-act">${act}</div>
      </div>
    </article>`;
  }
  function render() {
    const grid = $('gx-games-grid'); if (!grid) return;
    const list = CATALOG.filter((c) => (tab === 'browse' || (tab === 'library' && localFor(c.id).length) || (tab === 'fav' && favs().has(c.id)))
      && (!q || `${c.title} ${c.genre}`.toLowerCase().includes(q)));
    const inst = CATALOG.filter((c) => localFor(c.id).length).length;
    const tabs = $('gxc-tabs');
    if (tabs) tabs.querySelectorAll('[data-gxc-tab]').forEach((b) => {
      b.classList.toggle('on', b.dataset.gxcTab === tab);
      const n = b.querySelector('i'); if (n) n.textContent = b.dataset.gxcTab === 'library' ? inst : favs().size;
    });
    renderWishes(); loadWishes();
    grid.innerHTML = list.length ? list.map(card).join('')
      : `<div class="gx-empty"><svg><use href="#gx-i-games"/></svg><b>${tab === 'library' ? 'Таны санд тоглоом алга' : tab === 'fav' ? 'Дуртай тоглоом сонгоогүй байна' : 'Тоглоом олдсонгүй'}</b><span>${tab === 'library' ? 'Компьютер дээрээ суулгасан тоглоомын exe-г «Тоглоом нэмэх»-ээр бүртгэнэ.' : tab === 'fav' ? 'Картын ☆ товчоор дуртай тоглоомоо тэмдэглэ.' : ''}</span></div>`;
    // Статистик: каталогийн тоо, суулгасан
    const st = $('gx-games-stats');
    if (st) {
      const vals = st.querySelectorAll('.gx-stat b'); const lbls = st.querySelectorAll('.gx-stat small');
      if (vals[0]) { vals[0].textContent = CATALOG.length; lbls[0].textContent = 'Нийт тоглоом'; }
      if (vals[1]) { vals[1].textContent = inst; lbls[1].textContent = 'Суулгасан'; }
    }
  }
  function mountTabs() {
    const grid = $('gx-games-grid'); if (!grid || $('gxc-tabs')) return;
    const h = grid.previousElementSibling; if (h && h.classList.contains('gx-sec-h')) h.remove();
    const bar = document.createElement('div'); bar.id = 'gxc-tabs'; bar.className = 'gxc-tabs';
    bar.innerHTML = `<div class="gx-subtabs"><button type="button" data-gxc-tab="browse" class="on">Бүх тоглоом</button><button type="button" data-gxc-tab="library">Миний сан <i>0</i></button><button type="button" data-gxc-tab="fav">Дуртай <i>0</i></button></div>
      <label class="gx-search"><svg><use href="#gx-i-search"/></svg><input id="gxc-q" type="text" placeholder="Тоглоом хайх…" autocomplete="off" /></label>`;
    grid.parentElement.insertBefore(bar, grid);
    grid.classList.add('gxc-grid');
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-gxc-tab]'); if (b) { tab = b.dataset.gxcTab; render(); } });
    $('gxc-q').addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); render(); });
  }
  document.addEventListener('click', (e) => {
    const f = e.target.closest('[data-fav]'); if (!f) return;
    e.stopPropagation(); const s = favs(); s.has(f.dataset.fav) ? s.delete(f.dataset.fav) : s.add(f.dataset.fav); saveFavs(s); render();
  });
  // Каталогийн «Авах» товч (data-open-url) — gx-clans.js-ийн ерөнхий handler хийнэ.
  // gx.js-ийн renderGames-ийг каталогоор орлуулна (статистикийн мөрийг хадгалж)
  if (window.gx) {
    const base = window.gx.renderGames;
    const wrapped = function () { base(); mountTabs(); render(); };
    window.gx.renderGames = wrapped;
    const _st = showTab;
    showTab = function (name) { _st(name); if (name === 'games') { mountTabs(); render(); } };
  }
  // gx.js дотоод renderGames (жиш: тоглоом нэмэх/устгах үед) grid-ийг дарвал каталогоор дахин зурна
  const g = $('gx-games-grid');
  if (g) new MutationObserver(() => { if (g.querySelector('.gx-game')) { mountTabs(); render(); } }).observe(g, { childList: true });
  window.gxCatalog = { CATALOG, kindOf, render };
})();
