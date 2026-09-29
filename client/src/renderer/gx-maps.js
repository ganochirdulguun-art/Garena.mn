// ══════════════════════════════════════════════════════════════
// GX Тоглоомууд → Warcraft III карт + Map-ын сан (2026-09-30).
// Сервер: /maps. Main: maps:* IPC (src/services/maps.js) — татаж SHA-256 шалгаад WC3-ийн Maps\Download(s) руу.
// Warcraft III тоглоомын өөрийн файлыг (Blizzard) ТАРААХГҮЙ — зөвхөн суулгацыг таньж, хувилбарыг шалгана.
// ══════════════════════════════════════════════════════════════
(function gxMaps() {
  if (new URLSearchParams(location.search).get('mode')) return;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => escHtml(t ?? '');
  const errMsg = (e) => String(e?.message || e || 'Алдаа гарлаа').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const toast = (m, t = 'info') => { try { showToast(m, t, 4500); } catch {} };
  const mb = (n) => `${(Number(n || 0) / 1048576).toFixed(1)} MB`;
  const CAT_COLOR = { DotA: '#e11d2e', LoD: '#7c3aed', IMBA: '#0891b2', Melee: '#16a34a', 'Tower Defense': '#d97706', RPG: '#db2777', Custom: '#475569' };
  let state = { maps: [], categories: [], can_upload: false, local: {}, wc3: null, cat: 'all', busy: new Map() };

  function wc3Card() {
    const box = $('gx-wc3'); if (!box) return;
    const p = state.wc3?.primary;
    if (!p) {
      box.innerHTML = `<div class="gx-wc3-ico"><svg><use href="#gx-i-games"/></svg></div>
        <div class="gx-wc3-main"><b>Warcraft III: The Frozen Throne бүртгэгдээгүй</b>
        <p>Компьютер дээрээ суулгасан Warcraft III-ийн <code>war3.exe</code> эсвэл <code>Frozen Throne.exe</code>-г нэмнэ. Платформ 1.26a хувилбарыг танина. Тоглоомыг өөрийг нь Blizzard-ийн зохиогчийн эрхийн улмаас платформ тараахгүй.</p></div>
        <div class="gx-wc3-act"><button type="button" class="btn btn-primary" data-gx-click="btn-add-game">war3.exe нэмэх</button></div>`;
      return;
    }
    const ok = p.exists; const v126 = p.is126;
    box.innerHTML = `<div class="gx-wc3-ico ${ok ? 'ok' : 'bad'}"><svg><use href="#gx-i-games"/></svg></div>
      <div class="gx-wc3-main"><b>Warcraft III: The Frozen Throne ${ok ? '<span class="gx-st open">Суулгасан</span>' : '<span class="gx-st full">Файл олдсонгүй</span>'}
        ${p.version ? `<span class="gx-st ${v126 ? 'open' : 'playing'}">${esc(p.version.replace(/,\s*/g, '.'))}${v126 ? ' · 1.26a ✓' : ' · 1.26a санал болгоно'}</span>` : ''}</b>
        <p class="gx-mono">${esc(p.exe)}</p>
        <p>Map хавтас: <span class="gx-mono">${esc(p.mapsDir)}</span></p></div>
      <div class="gx-wc3-act"><button type="button" class="btn btn-sm" id="gx-wc3-folder"><svg class="btn-icon-svg"><use href="#gx-i-folder"/></svg>Хавтас нээх</button></div>`;
    $('gx-wc3-folder')?.addEventListener('click', openFolder);
  }
  function statusOf(m) {
    const l = state.local[m.filename];
    if (!l) return 'none';
    return String(l.sha256) === String(m.sha256) ? 'installed' : 'update';
  }
  function row(m) {
    const st = statusOf(m); const busy = state.busy.get(String(m.id));
    const btn = busy != null
      ? `<div class="gx-prog"><i style="width:${busy}%"></i><span>${busy}%</span></div>`
      : st === 'installed' ? '<span class="gx-st open">Суусан ✓</span>'
        : `<button type="button" class="btn btn-sm ${st === 'update' ? '' : 'btn-primary'}" data-map-dl="${m.id}">${st === 'update' ? 'Шинэчлэх' : 'Татах'}</button>`;
    return `<div class="gx-map" data-map-id="${m.id}">
      <span class="gx-map-ico" style="--gc:${CAT_COLOR[m.category] || '#475569'}">${esc(String(m.category || 'M').slice(0, 2).toUpperCase())}</span>
      <div class="gx-map-main"><b>${esc(m.name)}${m.version ? ` <span class="gx-map-ver">${esc(m.version)}</span>` : ''}${m.featured ? ' <span class="gx-ranked">⭐ Онцлох</span>' : ''}</b>
        <small>${esc(m.description || m.filename)}</small></div>
      <span class="gx-mode">${esc(m.category || 'Custom')}</span>
      <span class="gx-map-meta">${mb(m.size)}</span>
      <span class="gx-map-meta" title="Татсан тоо">⬇ ${Number(m.downloads || 0).toLocaleString('en-US')}</span>
      <div class="gx-map-act">${btn}${state.can_upload ? `<button type="button" class="gx-x" title="Устгах" data-map-del="${m.id}">✕</button>` : ''}</div>
    </div>`;
  }
  function render() {
    wc3Card();
    const cats = ['all', ...new Set(state.maps.map((m) => m.category).filter(Boolean))];
    const cb = $('gx-maps-cats');
    if (cb) cb.innerHTML = cats.map((c) => `<button type="button" class="${state.cat === c ? 'on' : ''}" data-map-cat="${esc(c)}">${c === 'all' ? 'Бүгд' : esc(c)}</button>`).join('');
    $('gx-maps-add')?.classList.toggle('hidden', !state.can_upload);
    const q = ($('gx-maps-q')?.value || '').trim().toLowerCase();
    const list = state.maps.filter((m) => (state.cat === 'all' || m.category === state.cat) && (!q || `${m.name} ${m.version} ${m.filename}`.toLowerCase().includes(q)));
    const missing = list.filter((m) => statusOf(m) !== 'installed');
    const box = $('gx-maps-list'); if (!box) return;
    if (!state.maps.length) {
      box.innerHTML = `<div class="gx-empty"><svg><use href="#gx-i-folder"/></svg><b>Map-ын сан хоосон байна</b><span>${state.can_upload ? '«+ Map нэмэх» товчоор эхний map-аа оруулаарай.' : 'Удахгүй DotA, LoD, IMBA зэрэг map-ууд нэмэгдэнэ.'}</span></div>`;
      return;
    }
    box.innerHTML = (missing.length > 1 && state.wc3?.primary ? `<div class="gx-maps-all"><span>${missing.length} map суугаагүй эсвэл хуучирсан</span><button type="button" class="btn btn-primary btn-sm" data-map-all>Бүгдийг татах</button></div>` : '')
      + (list.map(row).join('') || '<p class="hint">Тохирох map олдсонгүй.</p>');
  }
  async function load() {
    try { const r = await window.api.request('get', '/maps'); state.maps = r?.maps || []; state.categories = r?.categories || []; state.can_upload = !!r?.can_upload; } catch { state.maps = []; }
    try { state.wc3 = await window.api.wc3Info?.(); } catch { state.wc3 = null; }
    try { const l = await window.api.mapsLocal?.(state.maps.map((m) => m.filename)); state.local = l?.files || {}; } catch { state.local = {}; }
    render();
  }
  async function refreshLocal() {
    try { const l = await window.api.mapsLocal?.(state.maps.map((m) => m.filename)); state.local = l?.files || {}; } catch {}
    render();
  }
  async function openFolder() {
    const r = await window.api.mapsOpenFolder?.().catch(() => false);
    if (r === false) toast('Warcraft III бүртгэгдээгүй байна', 'warning');
  }
  window.api.onMapsProgress?.((d) => {
    if (!state.busy.has(String(d.id))) return;
    state.busy.set(String(d.id), d.pct);
    const el = document.querySelector(`.gx-map[data-map-id="${CSS.escape(String(d.id))}"] .gx-prog`);
    if (el) { el.querySelector('i').style.width = `${d.pct}%`; el.querySelector('span').textContent = `${d.pct}%`; }
  });
  document.addEventListener('click', async (e) => {
    const cat = e.target.closest('[data-map-cat]'); if (cat) { state.cat = cat.dataset.mapCat; render(); return; }
    const dl = e.target.closest('[data-map-dl]');
    if (dl) {
      const m = state.maps.find((x) => String(x.id) === dl.dataset.mapDl); if (!m) return;
      state.busy.set(String(m.id), 0); render();
      try {
        const r = await window.api.mapsDownload({ id: m.id, filename: m.filename, sha256: m.sha256 });
        toast(`«${m.name}» суулгагдлаа ✅${r?.elevated ? ' (Windows зөвшөөрлөөр)' : ''}`, 'success');
      } catch (err) { toast(errMsg(err), 'error'); }
      state.busy.delete(String(m.id)); refreshLocal(); return;
    }
    if (e.target.closest('[data-map-all]')) {
      const todo = state.maps.filter((m) => statusOf(m) !== 'installed');
      todo.forEach((m) => state.busy.set(String(m.id), 0)); render();
      try {
        const r = await window.api.mapsDownloadMany(todo.map((m) => ({ id: m.id, filename: m.filename, sha256: m.sha256 })));
        toast(`${r?.count || todo.length} map суулгагдлаа ✅`, 'success');
      } catch (err) { toast(errMsg(err), 'error'); }
      todo.forEach((m) => state.busy.delete(String(m.id))); refreshLocal(); return;
    }
    const del = e.target.closest('[data-map-del]');
    if (del) {
      const m = state.maps.find((x) => String(x.id) === del.dataset.mapDel); if (!m) return;
      if (!await showConfirm('Map устгах', `«${m.name}»-г Map-ын сангаас устгах уу? (Хэрэглэгчдийн компьютер дээрх файлд нөлөөлөхгүй)`)) return;
      try { await window.api.request('delete', `/maps/${m.id}`); toast('Устгагдлаа', 'success'); load(); } catch (err) { toast(errMsg(err), 'error'); }
    }
  });
  $('gx-maps-q')?.addEventListener('input', render);
  $('gx-maps-folder')?.addEventListener('click', openFolder);

  // ── Map нэмэх (эзэн/админ) ──
  $('gx-maps-add')?.addEventListener('click', async () => {
    const picked = await window.api.mapsPickFile?.().catch(() => null);
    if (!picked) return;
    const guess = picked.filename.replace(/\.(w3x|w3m)$/i, '').replace(/[_]+/g, ' ');
    const vm = guess.match(/v?\d+\.\d+[a-z0-9.]*/i);
    const catGuess = /imba/i.test(guess) ? 'IMBA' : /lod/i.test(guess) ? 'LoD' : /dota/i.test(guess) ? 'DotA' : 'Custom';
    const cats = state.categories.length ? state.categories : ['DotA', 'LoD', 'IMBA', 'Melee', 'Tower Defense', 'RPG', 'Custom'];
    const body = $('gx-map-modal-body');
    body.innerHTML = `<h3 class="gx-modal-title">Map нэмэх</h3><div class="gx-form">
      <p class="hint">Файл: <b>${esc(picked.filename)}</b> · ${mb(picked.size)}. Зөвхөн чөлөөтэй тарааж болох community map оруулна.</p>
      <label><span>Нэр</span><input id="gx-mu-name" class="input" maxlength="80" value="${esc(guess.replace(vm?.[0] || '', '').trim())}" /></label>
      <label><span>Хувилбар</span><input id="gx-mu-ver" class="input" maxlength="40" value="${esc(vm?.[0] || '')}" /></label>
      <label><span>Ангилал</span><select id="gx-mu-cat" class="input">${cats.map((c) => `<option ${c === catGuess ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label><span>Тайлбар</span><textarea id="gx-mu-desc" class="input" rows="2" maxlength="300"></textarea></label>
      <p id="gx-mu-err" class="form-error"></p>
      <div class="gx-row-btns end"><button type="button" class="btn" data-gx-close>Болих</button><button type="button" class="btn btn-primary" id="gx-mu-go">Оруулах</button></div></div>`;
    $('gx-map-modal').classList.remove('hidden');
    $('gx-mu-go').onclick = async () => {
      const b = $('gx-mu-go'); b.disabled = true; b.textContent = 'Оруулж байна…';
      try {
        await window.api.mapsUpload({ name: $('gx-mu-name').value.trim(), version: $('gx-mu-ver').value.trim(), category: $('gx-mu-cat').value, description: $('gx-mu-desc').value.trim() });
        $('gx-map-modal').classList.add('hidden'); toast('Map нэмэгдлээ ✅', 'success'); load();
      } catch (err) { $('gx-mu-err').textContent = errMsg(err); b.disabled = false; b.textContent = 'Оруулах'; }
    };
  });

  const _st = showTab;
  showTab = function (name) { _st(name); if (name === 'games') load(); };
  window.gxMaps = { load };
})();
