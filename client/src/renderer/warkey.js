// ── WarKey таб — платформд шигтгэсэн Garena.mn WarKey-ийн тохиргоо ──
// WarKey (тусдаа далд процесс, main.js/src/services/warkey.js асаадаг) 127.0.0.1 локал API-аар
// inventory/skill/quickchat тохиргоогоо өгнө; энэ таб түүнийг WarKey-ийн цонхтой ижил байдлаар
// харуулж засна. Тоглоом доторх Ctrl+F6 overlay нь WarKey-ийн native overlay хэвээр.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let timer = null;
  let state = null;
  let capture = null;   // { kind: 'inv'|'chat'|'new', index, label }
  let newVk = 0;

  // Windows virtual-key код: Chromium-ийн keyCode Windows дээр VK-тай давхцдаг (үсэг, тоо, F1–F12,
  // numpad, цэг таслал); хулгана: дунд=0x04, X1=0x05, X2=0x06, дугуй ↑=0x0E, ↓=0x0F (WarKey-ийн код).
  const VK_NAMES = { 8: 'Backspace', 9: 'Tab', 13: 'Enter', 27: 'Esc', 32: 'Space', 16: 'Shift', 17: 'Ctrl', 18: 'Alt',
    4: 'Mouse3', 5: 'Mouse4', 6: 'Mouse5', 14: 'Wheel ↑', 15: 'Wheel ↓',
    186: ';', 187: '=', 188: ',', 189: '-', 190: '.', 191: '/', 192: '`', 219: '[', 220: '\\', 221: ']', 222: "'" };
  function vkName(vk) {
    if (!vk) return '';
    if (VK_NAMES[vk]) return VK_NAMES[vk];
    if (vk >= 65 && vk <= 90) return String.fromCharCode(vk);
    if (vk >= 48 && vk <= 57) return String.fromCharCode(vk);
    if (vk >= 96 && vk <= 105) return 'Num' + (vk - 96);
    if (vk >= 112 && vk <= 123) return 'F' + (vk - 111);
    return '0x' + vk.toString(16).toUpperCase();
  }
  function vkFromKeyEvent(e) {
    // Numpad-ийн тоо (NumLock асаалттай) keyCode 96–105 ирдэг ✓; unshifted keyCode = VK
    const k = e.keyCode || e.which;
    if (!k) return 0;
    return k;
  }

  async function refresh(silent) {
    const r = await window.api.warkeyState();
    if (!r || r.ok === false) {
      const st = await window.api.warkeyStatus();
      renderOffline(st, r && r.error);
      return;
    }
    state = r;
    render();
  }

  function renderOffline(st, err) {
    const box = $('wk-status');
    if (!box) return;
    box.className = 'wk-status off';
    const why = err || (st && st.error) || 'WarKey асаагүй байна';
    box.innerHTML = `<b>⌨ WarKey ${st && st.bundled ? '' : '(суулгацад байхгүй)'}</b> — ${esc(why)}`
      + `${st && st.bundled ? ' <button type="button" class="btn btn-sm" id="wk-restart">Дахин асаах</button>' : ''}`;
    $('wk-body')?.classList.add('hidden');
    $('wk-restart')?.addEventListener('click', async () => { await window.api.warkeyRestart(); setTimeout(() => refresh(), 1500); });
  }

  function render() {
    const s = state; if (!s) return;
    const box = $('wk-status');
    box.className = 'wk-status ' + (s.locked ? 'locked' : s.live ? 'live' : 'on');
    const game = s.gameFocused ? '🎮 WC3 идэвхтэй' : s.gameRunning ? '🎮 WC3 нээлттэй (цонх ард)' : 'WC3 нээгээгүй';
    box.innerHTML = `<b>⌨ WarKey ${esc(s.version)}</b> · ${esc(game)}`
      + (s.locked ? ` · 🔒 ${esc(s.lockNotice)}` : s.status ? ` · ${esc(s.status)}${s.statusDetail ? ' — ' + esc(s.statusDetail) : ''}` : ' · ✅ бэлэн')
      + (s.problems ? `<div class="wk-problem">⚠️ ${esc(s.problems)}</div>` : '')
      + (s.hookInstalled ? '' : '<div class="wk-problem">⚠️ Keyboard hook ажиллахгүй байна — "Дахин асаах"</div>')
      + (s.war3NeedsAdmin ? '<div class="wk-problem">⚠️ WC3 админ эрхээр ажиллаж байна — энгийн эрхийн WarKey товч дамжуулж/skill уншиж чадахгүй. <button type="button" class="btn btn-sm" id="wk-elevate">WarKey-г админ эрхээр асаах (UAC)</button> эсвэл WC3-г энгийн эрхээр нээнэ үү.</div>' : '');
    $('wk-elevate')?.addEventListener('click', async () => { showToast('UAC цонх гарна — зөвшөөрнө үү', 'info'); const ok = await window.api.warkeyStartElevated(); showToast(ok ? 'WarKey админ эрхээр асав' : 'Асаагүй (UAC татгалзсан?)', ok ? 'success' : 'error'); setTimeout(() => refresh(), 1000); });
    $('wk-body')?.classList.remove('hidden');

    // Inventory 2×3
    const inv = $('wk-inv');
    inv.innerHTML = (s.inventory || []).map((m) => `
      <button type="button" class="wk-slot ${m.fromVk ? 'set' : ''} ${capture && capture.kind === 'inv' && capture.index === m.slot ? 'capturing' : ''}" data-slot="${m.slot}" title="Дарж товч сонгоно · Backspace = арилгах">
        <span class="wk-slot-n">${m.slot + 1}</span>
        <span class="wk-slot-key">${capture && capture.kind === 'inv' && capture.index === m.slot ? '…' : (m.from ? esc(m.from) : '+')}</span>
        <span class="wk-slot-to">${esc(m.to)}</span>
      </button>`).join('');
    inv.querySelectorAll('.wk-slot').forEach((b) => b.addEventListener('click', () => beginCapture('inv', Number(b.dataset.slot), 'Item ' + (Number(b.dataset.slot) + 1))));

    // Skills
    const sk = $('wk-skills');
    if (!s.skills || !s.skills.length) {
      sk.innerHTML = `<div class="wk-hint">${esc(s.skillsHint || 'Тоглоом эхлүүлж hero сонгоход skill-үүд энд гарна.')}</div>`;
    } else {
      sk.innerHTML = `<div class="wk-skill-head"><span>Skill</span><span>Default</span><span>Таны үсэг</span><span></span></div>` + s.skills.map((r) => `
        <div class="wk-skill ${r.applied ? 'applied' : r.applying ? 'applying' : ''}">
          <span class="wk-skill-name" title="${esc(r.id)}">${esc(r.name)}</span>
          <span class="wk-skill-def">${esc(r.default)}</span>
          <input class="input wk-letter" data-id="${esc(r.id)}" maxlength="1" value="${esc(r.assigned)}" placeholder="-" title="A–Z үсэг бичээд Enter" />
          <span class="wk-skill-state">${r.applied ? '✅' : r.applying ? '⏳' : ''}</span>
        </div>`).join('');
      sk.querySelectorAll('.wk-letter').forEach((inp) => {
        const commit = async () => {
          const letter = inp.value.trim().toUpperCase();
          if (letter && !/^[A-Z]$/.test(letter)) { showToast('A–Z үсэг оруулна уу', 'warning'); return; }
          const r = await window.api.warkeySetSkill(inp.dataset.id, letter);
          if (r && r.ok === false) showToast(r.error || 'Алдаа', 'error'); else { state = r; render(); }
        };
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } e.stopPropagation(); });
        inp.addEventListener('change', commit);
      });
    }

    // QuickChat
    const ch = $('wk-chat');
    ch.innerHTML = (s.chat || []).map((c) => `
      <div class="wk-chat-row">
        <button type="button" class="wk-key ${capture && capture.kind === 'chat' && capture.index === c.index ? 'capturing' : ''}" data-index="${c.index}" title="Товч солих">${capture && capture.kind === 'chat' && capture.index === c.index ? '…' : esc(c.key || '-')}</button>
        <input class="input wk-msg" data-index="${c.index}" value="${esc(c.message)}" maxlength="120" />
        <button type="button" class="btn btn-sm wk-del" data-index="${c.index}" title="Устгах">✕</button>
      </div>`).join('') || '<div class="wk-hint">QuickChat алга — доор товч + мессеж нэмнэ үү (жишээ: F2 → "gg wp").</div>';
    ch.querySelectorAll('.wk-key').forEach((b) => b.addEventListener('click', () => beginCapture('chat', Number(b.dataset.index), 'QuickChat')));
    ch.querySelectorAll('.wk-del').forEach((b) => b.addEventListener('click', async () => { const r = await window.api.warkeyChatRemove(Number(b.dataset.index)); apply(r); }));
    ch.querySelectorAll('.wk-msg').forEach((inp) => {
      const commit = async () => { const r = await window.api.warkeyChatSetMessage(Number(inp.dataset.index), inp.value); apply(r); };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } e.stopPropagation(); });
      inp.addEventListener('change', commit);
    });
    const nk = $('wk-new-key');
    if (nk) nk.textContent = capture && capture.kind === 'new' ? '…' : (newVk ? vkName(newVk) : 'Товч');
    const ov = $('wk-overlay');
    if (ov) ov.textContent = s.overlayOpen ? 'Overlay хаах (Ctrl+F6)' : 'Overlay нээх (Ctrl+F6)';
  }

  function apply(r) {
    if (!r) return;
    if (r.ok === false) { showToast(r.error || 'WarKey алдаа', 'error'); return; }
    state = r; render();
  }

  // ── Товч барих: keydown / хулганы товч / дугуй → VK ──
  function beginCapture(kind, index, label) {
    capture = { kind, index, label };
    render();
    showToast(`${label}: товч дарна уу (хулганы товч/дугуй ч болно; Backspace = арилгах, Esc = болих)`, 'info');
  }
  async function finishCapture(vk) {
    const c = capture; capture = null;
    if (!c) return;
    if (c.kind === 'inv') apply(await window.api.warkeySetInventory(c.index, vk));
    else if (c.kind === 'chat') { if (vk) apply(await window.api.warkeyChatSetKey(c.index, vk)); else render(); }
    else if (c.kind === 'new') { newVk = vk; render(); }
  }
  function onKey(e) {
    if (!capture || !$('tab-warkey')?.classList.contains('active')) return;
    e.preventDefault(); e.stopPropagation();
    const k = e.keyCode || e.which;
    if (k === 27) { capture = null; render(); return; }
    if (k === 13) return;                       // Enter — WC3 чатын товч, WarKey хүлээж авдаггүй
    finishCapture(k === 8 ? 0 : vkFromKeyEvent(e));
  }
  function onMouse(e) {
    if (!capture || !$('tab-warkey')?.classList.contains('active')) return;
    if (e.button === 0) return;                  // зүүн товч = UI дарах
    e.preventDefault(); e.stopPropagation();
    finishCapture(e.button === 1 ? 4 : e.button === 3 ? 5 : e.button === 4 ? 6 : 0);
  }
  function onWheel(e) {
    if (!capture || !$('tab-warkey')?.classList.contains('active')) return;
    e.preventDefault(); e.stopPropagation();
    finishCapture(e.deltaY < 0 ? 14 : 15);
  }
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('mousedown', onMouse, true);
  document.addEventListener('auxclick', (e) => { if (capture) e.preventDefault(); }, true);
  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  document.addEventListener('contextmenu', (e) => { if (capture) e.preventDefault(); }, true);

  function wire() {
    $('wk-new-key')?.addEventListener('click', () => beginCapture('new', -1, 'Шинэ QuickChat товч'));
    $('wk-new-add')?.addEventListener('click', async () => {
      const msg = ($('wk-new-msg')?.value || '').trim();
      if (!newVk) { showToast('Эхлээд товч сонгоно уу', 'warning'); return; }
      if (!msg) { showToast('Мессеж бичнэ үү', 'warning'); return; }
      const r = await window.api.warkeyChatAdd(newVk, msg);
      if (r && r.ok !== false) { $('wk-new-msg').value = ''; }
      apply(r);
    });
    $('wk-new-msg')?.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); $('wk-new-add')?.click(); } });
    $('wk-overlay')?.addEventListener('click', async () => apply(await window.api.warkeyOverlay()));
    $('wk-restart-top')?.addEventListener('click', async () => { await window.api.warkeyRestart(); showToast('WarKey дахин асааж байна…', 'info'); setTimeout(() => refresh(), 2000); });
  }

  window.warkeyTab = {
    activate() { wire(); refresh(); clearInterval(timer); timer = setInterval(() => { if (!capture) refresh(true); }, 2000); },
    deactivate() { clearInterval(timer); timer = null; capture = null; },
  };
})();
