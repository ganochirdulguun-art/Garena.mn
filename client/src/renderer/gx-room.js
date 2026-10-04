// ══════════════════════════════════════════════════════════════
// GX өрөө — үндсэн цонхонд шигтгэх (2.9.2, GameRanger X шиг: тусдаа цонх нээгдэхгүй).
// Main процесс room:openWindow дээр 'room:embed' илгээнэ → энд #tab-roomview дотор
// index.html?mode=room… iframe үүсгэнэ. Өрөөний бүх логик (socket, LAN relay, чат) хуучин
// тусдаа цонхных шигээ iframe дотор ажиллана; preload subframe-д ажилладаг (nodeIntegrationInSubFrames).
//  • Өрөөнөөс гарах/хаах: iframe дахь window.close() → parent-д 'gx:room-closed' → iframe устгаж лобби руу.
//  • Өрөөний «Буцах»: өрөөнөөс гарахгүйгээр лобби руу (зүүн цэсний ногоон картаар буцаж орно).
// ══════════════════════════════════════════════════════════════
(function gxRoom() {
  const q = new URLSearchParams(location.search);
  const inFrame = window.parent && window.parent !== window;

  // ── A. Өрөөний хуудас (iframe дотор) ──
  if (q.get('mode') === 'room' && inFrame) {
    document.documentElement.classList.add('gx-embedded');
    const post = (type, extra) => { try { window.parent.postMessage({ gx: true, type, roomId: q.get('roomId'), ...(extra || {}) }, '*'); } catch {} };
    // «Лобби» товчийг gx-roomui.js үүсгэнэ (GameRanger X-ийн lobby толгой)
    // Хост / Live төлөв → үндсэн цонх: өөр Room руу шилжихээс өмнө «тоглоом хаагдана» гэж анхааруулна (эзэн 2026-10-04)
    setInterval(() => { try { post('state', { hosting: !!window.gxLan?.hosting, live: !!window.gxLive?.isLive }); } catch {} }, 1500);
    return;
  }

  // ── B. Үндсэн цонх ──
  if (q.get('mode')) return;
  const $ = (id) => document.getElementById(id);
  let frame = null, frameRoomId = null, frameState = {};

  function ensureTab() {
    let tab = $('tab-roomview');
    if (!tab) {
      tab = document.createElement('div');
      tab.id = 'tab-roomview'; tab.className = 'tab gx-roomview';
      $('gx-content')?.appendChild(tab);
      const nb = document.createElement('button');   // showTab() нь [data-tab=...] элемент шаарддаг
      nb.type = 'button'; nb.className = 'nav-btn hidden-tab'; nb.dataset.tab = 'roomview'; nb.tabIndex = -1; nb.setAttribute('aria-hidden', 'true');
      document.querySelector('.gx-nav')?.appendChild(nb);
    }
    return tab;
  }
  function openRoom(params) {
    const tab = ensureTab();
    if (frame && frameRoomId === String(params.roomId)) { showTab('roomview'); return; }
    closeFrame();
    const qs = new URLSearchParams(params).toString();
    frame = document.createElement('iframe');
    frame.className = 'gx-room-frame';
    frame.setAttribute('title', params.roomName || 'Өрөө');
    frame.src = `index.html?${qs}`;
    frameRoomId = String(params.roomId);
    tab.appendChild(frame);
    document.body.classList.add('gx-in-room');
    showTab('roomview');
  }
  function closeFrame() {
    if (frame) { try { frame.remove(); } catch {} }
    frame = null; frameRoomId = null; frameState = {};
    document.body.classList.remove('gx-in-room');
  }
  window.api?.onRoomEmbed?.((params) => openRoom(params));
  window.addEventListener('message', (e) => {
    const d = e.data; if (!d || !d.gx || !frame || e.source !== frame.contentWindow) return;
    if (d.type === 'state') { frameState = { hosting: !!d.hosting, live: !!d.live }; return; }
    if (d.type === 'closed') { closeFrame(); showTab('lobby'); try { loadRooms(); } catch {} }
    else if (d.type === 'back') { showTab('lobby'); }
    // RGC маягийн доод цэс (FORUM / LADDER / SHOP) → үндсэн цонхны таб (зөвхөн зөвшөөрөгдсөн)
    else if (d.type === 'tab' && ['discord', 'ranking', 'premium', 'lobby'].includes(d.tab)) { showTab(d.tab); }
  });
  // Зүүн цэсний ногоон «одоогийн өрөө» карт → шигтгэсэн өрөө рүү
  document.addEventListener('click', (e) => {
    if (!frame) return;
    const card = e.target.closest('#gx-cur-room'); if (!card) return;
    e.stopImmediatePropagation(); e.preventDefault();
    showTab('roomview');
  }, true);
  // Тоглолтын дүн (replay) — шигтгэсэн өрөө нээлттэй бол өрөө өөрөө харуулна (давхар modal гаргахгүй)
  window.api?.onGameResult?.((data) => { if (frame) return; try { showGameResult(data); } catch {} });
  // Гарах (logout) → өрөөний frame-ийг хаана
  const _sp = showPage;
  showPage = function (id) { if (id === 'page-login') closeFrame(); _sp(id); };
  // Өрөөний таб идэвхтэй үед агуулгын padding-гүй (бүтэн талбай)
  const _st = showTab;
  showTab = function (name) { _st(name); document.body.classList.toggle('gx-roomview-on', name === 'roomview'); };
  // Одоогийн Room-оос гарвал юу алдагдахыг тайлбарласан текст (хост / Live биш бол null)
  function leaveWarning() {
    if (!frame) return null;
    const w = [];
    if (frameState.hosting) w.push('Таны нээсэн LAN тоглоом хаагдаж, нэгдсэн тоглогчид ТАСАРНА.');
    if (frameState.live) w.push('Таны LIVE дамжуулалт зогсоно.');
    return w.length ? w.join(' ') : null;
  }
  window.gxRoom = { openRoom, closeFrame, leaveWarning, get roomId() { return frameRoomId; } };
})();
