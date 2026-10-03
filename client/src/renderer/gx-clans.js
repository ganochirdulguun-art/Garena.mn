// ══════════════════════════════════════════════════════════════
// GX Кланууд (2026-09-30) + өрөөний баруун товчны цэс + «Lobby мэдээлэл» цонх.
// Сервер: /clans (server/src/routes/clans.js). app.js-ийн глобал функцүүдийг (openUserProfile, openDM,
// addFriendClick, blockUserClick, joinRoom, enterRoom, showToast, showConfirm) дахин ашиглана.
// ══════════════════════════════════════════════════════════════
(function gxClans() {
  if (new URLSearchParams(location.search).get('mode')) return;
  const $ = (id) => document.getElementById(id);
  const esc = (t) => escHtml(t ?? '');
  const api = (m, p, b) => window.api.request(m, p, b);
  const errMsg = (e) => String(e?.message || e || 'Алдаа гарлаа').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const toast = (m, t = 'info') => { try { showToast(m, t); } catch {} };
  const ROLE = { lord: 'Clan Lord', admin: 'Админ', member: 'Гишүүн' };
  let mine = { clans: [], can_create: false };
  let curClan = null;

  // ── Modal туслахууд ──
  function openModal(id, html) { const m = $(id); if (!m) return; m.querySelector('[id$="-body"]').innerHTML = html; m.classList.remove('hidden'); }
  function closeModal(id) { $(id)?.classList.add('hidden'); }
  document.addEventListener('click', (e) => {
    const m = e.target.closest('.gx-modal');
    if (m && (e.target === m || e.target.closest('[data-gx-close]'))) m.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('.gx-modal:not(.hidden)').forEach((m) => m.classList.add('hidden')); });

  function clanIcon(c, big, editable) {
    const cls = big ? 'gx-clan-ico big' : 'gx-clan-ico';
    const tag = esc(String(c.tag || '?').slice(0, 3).toUpperCase());
    const edit = editable ? '<button type="button" class="gx-ico-edit" data-clan-icon title="Кланы зураг солих"><svg class="btn-icon-svg"><use href="#ico-camera"/></svg></button>' : '';
    // Зураг ачаалагдахгүй бол (жиш: Discord дүрс солигдсон) таг харуулна — доорх 'error' сонсогч
    return `<span class="${cls}" style="--gc:${gameTypeColor(c.tag || c.name)}" data-tag="${tag}">${c.icon_url ? `<img src="${esc(c.icon_url)}" alt="">` : tag}${edit}</span>`;
  }
  document.addEventListener('error', (e) => {
    const img = e.target; if (!(img instanceof HTMLImageElement)) return;
    const box = img.closest('.gx-clan-ico'); if (!box) return;
    img.replaceWith(document.createTextNode(box.dataset.tag || '?'));
  }, true);
  // Кланы зураг оруулах (Clan Lord) — JPG/PNG/WebP ≤ 1MB
  const iconInput = document.createElement('input');
  iconInput.type = 'file'; iconInput.accept = 'image/jpeg,image/png,image/webp'; iconInput.style.display = 'none';
  document.body.appendChild(iconInput);
  iconInput.addEventListener('change', async () => {
    const f = iconInput.files && iconInput.files[0]; iconInput.value = '';
    if (!f || !curClan) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { toast('JPG/PNG/WebP зураг сонгоно уу', 'warning'); return; }
    if (f.size > 1024 * 1024) { toast('Зураг 1MB-с бага байх ёстой', 'warning'); return; }
    const dataUrl = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
    await run(() => api('post', `/clans/${curClan.id}/icon`, { image: dataUrl }), 'Кланы зураг солигдлоо ✅');
    openClan(curClan.id); loadMine();
  });
  function kindBadge(c) { return c.kind === 'discord' ? '<span class="gx-kind discord">Discord сервер</span>' : '<span class="gx-kind">Тоглогчийн клан</span>'; }
  function actionBtn(c) {
    if (c.my_role) return `<span class="gx-role ${c.my_role}">${ROLE[c.my_role]}</span>`;
    if (c.my_pending) return '<button type="button" class="btn btn-sm" data-clan-cancel="' + c.id + '">Хүсэлт илгээсэн · цуцлах</button>';
    return `<button type="button" class="btn btn-primary btn-sm" data-clan-join="${c.id}">${c.join_mode === 'open' ? 'Нэгдэх' : 'Хүсэлт илгээх'}</button>`;
  }
  function clanCard(c) {
    return `<article class="gx-clan-card" data-clan-open="${c.id}">
      ${clanIcon(c)}
      <div class="gx-clan-card-main">
        <div class="gx-clan-card-top"><b>${esc(c.name)}</b><span class="gx-tag">[${esc(c.tag)}]</span>${kindBadge(c)}</div>
        <p>${esc(c.description || 'Тайлбаргүй')}</p>
        <small><svg><use href="#gx-i-users"/></svg>${c.member_count || 0} гишүүн${c.pending_count ? ` · <b class="gx-pend">${c.pending_count} хүсэлт</b>` : ''}${c.owner_name ? ` · Lord: ${esc(c.owner_name)}` : ''}</small>
      </div>
      <div class="gx-clan-card-act">${actionBtn({ ...c, my_role: c.my_role || c.role })}</div>
    </article>`;
  }

  // ── Миний клан ──
  async function loadMine() {
    try { mine = await api('get', '/clans/mine'); } catch { mine = { clans: [], can_create: false }; }
    renderMine(); syncRoomClanSelect();
    const pend = (mine.clans || []).filter((c) => c.role === 'lord' || c.role === 'admin').reduce((a, c) => a + (c.pending_count || 0), 0);
    const b = $('gx-clan-badge'); if (b) { b.textContent = pend; b.classList.toggle('hidden', !pend); }
  }
  function renderMine() {
    const box = $('gx-clan-mine'); if (!box) return;
    const list = mine.clans || [];
    if (!list.length) {
      box.innerHTML = `<div class="gx-empty"><svg><use href="#gx-i-shield"/></svg><b>Та ямар ч кланд ороогүй байна</b>
        <span>Кланд нэгдэж, зөвхөн гишүүдэд зориулсан lobby-д тогло. Эсвэл GOLD гишүүн бол өөрийн кланаа байгуул.</span>
        <div class="gx-row-btns"><button type="button" class="btn btn-primary" data-clan-tab-go="discover">Кланууд үзэх</button><button type="button" class="btn" data-gx-click="gx-clan-create">Клан байгуулах</button></div></div>`;
      return;
    }
    box.innerHTML = `<div class="gx-clan-grid">${list.map((c) => clanCard({ ...c, my_role: c.role })).join('')}</div>`;
  }

  // ── Кланууд (Discover) ──
  let qTimer = null;
  async function loadDiscover() {
    const box = $('gx-clan-list'); if (!box) return;
    const q = ($('gx-clan-q')?.value || '').trim();
    try {
      const rows = await api('get', `/clans${q ? `?q=${encodeURIComponent(q)}` : ''}`);
      box.innerHTML = rows.length ? rows.map(clanCard).join('') : `<div class="gx-empty"><svg><use href="#gx-i-shield"/></svg><b>${q ? 'Клан олдсонгүй' : 'Одоогоор клан алга'}</b><span>Анхны кланыг та байгуулаарай.</span></div>`;
    } catch (e) { box.innerHTML = `<div class="gx-empty"><b>Ачаалж чадсангүй</b><span>${esc(errMsg(e))}</span></div>`; }
  }
  $('gx-clan-q')?.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(loadDiscover, 250); });

  // ── Дэд таб ──
  function subTab(name) {
    closeDetail();
    document.querySelectorAll('[data-clan-tab]').forEach((b) => b.classList.toggle('on', b.dataset.clanTab === name));
    document.querySelectorAll('[data-clan-panel]').forEach((p) => p.classList.toggle('on', p.dataset.clanPanel === name));
    if (name === 'mine') loadMine();
    if (name === 'discover') loadDiscover();
    if (name === 'discord' && typeof loadDiscordServers === 'function') loadDiscordServers();
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-clan-tab]'); if (t) { subTab(t.dataset.clanTab); return; }
    const g = e.target.closest('[data-clan-tab-go]'); if (g) { subTab(g.dataset.clanTabGo); }
  });

  // ── Кланы дэлгэрэнгүй ──
  function closeDetail() { $('gx-clan-detail')?.classList.add('hidden'); $('tab-clans')?.classList.remove('detail-open'); curClan = null; }
  async function openClan(id) {
    try { curClan = await api('get', `/clans/${id}`); } catch (e) { toast(errMsg(e), 'error'); return; }
    renderDetail();
  }
  function clanRooms(id) { return Object.values(roomsCache || {}).filter((r) => String(r.clan_id) === String(id)); }
  function renderDetail() {
    const c = curClan; const box = $('gx-clan-detail'); if (!c || !box) return;
    const mgr = c.my_role === 'lord' || c.my_role === 'admin';
    const rooms = clanRooms(c.id);
    const memberRow = (m) => {
      const canManage = (c.my_role === 'lord' && m.role !== 'lord') || (c.my_role === 'admin' && m.role === 'member');
      const me = String(m.id) === String(currentUser?.id);
      return `<li class="gx-mem" data-user-id="${esc(m.id)}">
        <span class="gx-mem-av">${m.avatar_url ? `<img src="${esc(m.avatar_url)}" alt="">` : esc(String(m.username || '?')[0].toUpperCase())}</span>
        <span class="clickable-name" data-user-id="${esc(m.id)}">${esc(withTier(m.username, m.tierbot_tier))}</span>
        <span class="gx-role ${m.role}">${ROLE[m.role]}</span>
        ${canManage && !me ? `<span class="gx-mem-act">
          ${c.my_role === 'lord' ? (m.role === 'admin' ? `<button type="button" class="btn btn-sm" data-clan-role="member" data-uid="${esc(m.id)}">Гишүүн болгох</button>` : `<button type="button" class="btn btn-sm" data-clan-role="admin" data-uid="${esc(m.id)}">Админ болгох</button>`) : ''}
          ${c.my_role === 'lord' ? `<button type="button" class="btn btn-sm" data-clan-role="lord" data-uid="${esc(m.id)}" title="Clan Lord эрхийг шилжүүлэх">Lord болгох</button>` : ''}
          <button type="button" class="btn btn-sm btn-danger-soft" data-clan-kick="${esc(m.id)}" data-name="${esc(m.username)}">Хасах</button></span>` : ''}
      </li>`;
    };
    box.innerHTML = `
      <button type="button" class="btn btn-sm gx-back" data-clan-back><svg class="btn-icon-svg"><use href="#gx-i-left"/></svg>Буцах</button>
      <div class="gx-clan-hero">
        <div class="gx-clan-banner"></div>
        <div class="gx-clan-hero-row">
          ${clanIcon(c, true, c.my_role === 'lord')}
          <div class="gx-clan-hero-text"><h2>${esc(c.name)} <span class="gx-tag">[${esc(c.tag)}]</span></h2>
            <div class="gx-clan-meta">${kindBadge(c)}<span>${c.member_count} гишүүн</span><span>Lord: ${esc(c.owner_name || '-')}</span><span>${c.join_mode === 'open' ? 'Нээлттэй элсэлт' : 'Хүсэлтээр элсэнэ'}</span></div></div>
          <div class="gx-clan-hero-act">
            ${c.invite_url ? `<button type="button" class="btn btn-sm" data-open-url="${esc(c.invite_url)}">Discord сервер</button>` : ''}
            ${c.my_role ? (c.my_role === 'lord' ? '' : '<button type="button" class="btn btn-sm btn-danger-soft" data-clan-leave>Кланаас гарах</button>') : (c.my_pending ? `<button type="button" class="btn btn-sm" data-clan-cancel="${c.id}">Хүсэлт илгээсэн · цуцлах</button>` : `<button type="button" class="btn btn-primary" data-clan-join="${c.id}">${c.join_mode === 'open' ? 'Нэгдэх' : 'Элсэх хүсэлт илгээх'}</button>`)}
            ${c.my_role === 'lord' ? '<button type="button" class="btn btn-sm" data-clan-edit>Тохиргоо</button><button type="button" class="btn btn-sm btn-danger-soft" data-clan-delete>Устгах</button>' : ''}
          </div>
        </div>
        ${c.description ? `<p class="gx-clan-desc">${esc(c.description)}</p>` : ''}
      </div>
      <div class="gx-clan-cols">
        <section class="gx-card">
          <div class="gx-card-head"><h3>🛡 Кланы lobby</h3>${c.my_role ? '<button type="button" class="btn btn-primary btn-sm" data-clan-room>+ Кланы өрөө үүсгэх</button>' : ''}</div>
          ${c.my_role ? (rooms.length ? `<div class="gx-group"><div class="gx-group-rows">${rooms.map((r) => window.gx.gxRow(r)).join('')}</div></div>` : '<p class="hint">Одоогоор кланы өрөө алга. Эхний өрөөг үүсгээрэй — зөвхөн гишүүд харж, нэгдэнэ.</p>')
            : '<div class="gx-lockbox"><svg><use href="#gx-i-lock"/></svg><b>Зөвхөн кланы гишүүдэд</b><span>Кланы lobby-г харж, өрөөнд нэгдэхийн тулд эхлээд кланд элсэнэ.</span></div>'}
        </section>
        <section class="gx-card">
          <div class="gx-card-head"><h3>Гишүүд · ${c.members.length}</h3></div>
          ${mgr ? `<div class="gx-addmem"><input id="gx-addmem-input" class="input input-sm" placeholder="Хэрэглэгчийн нэр эсвэл ID" /><button type="button" class="btn btn-sm btn-primary" data-clan-add>Нэмэх</button></div>` : ''}
          ${mgr && c.requests.length ? `<div class="gx-reqs"><div class="dm-section-label">Элсэх хүсэлт · ${c.requests.length}</div>${c.requests.map((q) => `<div class="gx-req"><span class="clickable-name" data-user-id="${esc(q.user_id)}">${esc(q.username)}</span>${q.discord_username ? `<small>Discord: ${esc(q.discord_username)}</small>` : ''}${q.message ? `<small>«${esc(q.message)}»</small>` : ''}<span class="gx-req-act"><button type="button" class="btn btn-sm btn-primary" data-req="${q.id}" data-act="accept">Батлах</button><button type="button" class="btn btn-sm btn-danger-soft" data-req="${q.id}" data-act="decline">Татгалзах</button></span></div>`).join('')}</div>` : ''}
          <ul class="gx-mems">${c.members.map(memberRow).join('')}</ul>
        </section>
      </div>`;
    box.classList.remove('hidden');
    $('tab-clans')?.classList.add('detail-open');
  }

  // ── Үйлдлүүд ──
  async function run(fn, okMsg) { try { await fn(); if (okMsg) toast(okMsg, 'success'); } catch (e) { toast(errMsg(e), 'error'); } }
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-clan-icon],[data-clan-join],[data-clan-cancel],[data-clan-open],[data-clan-back],[data-clan-leave],[data-clan-delete],[data-clan-edit],[data-clan-room],[data-clan-add],[data-clan-kick],[data-clan-role],[data-req],[data-open-url]');
    if (!el) return;
    if (el.dataset.clanJoin) {
      e.stopPropagation();
      await run(async () => { const r = await api('post', `/clans/${el.dataset.clanJoin}/join`, {}); toast(r.status === 'member' ? 'Кланд нэгдлээ 🎉' : 'Элсэх хүсэлт илгээлээ — Clan Lord/админ батална', 'success'); });
      await refreshAll(el.dataset.clanJoin); return;
    }
    if (el.dataset.clanCancel) { e.stopPropagation(); await run(() => api('delete', `/clans/${el.dataset.clanCancel}/join`), 'Хүсэлтээ цуцаллаа'); await refreshAll(el.dataset.clanCancel); return; }
    if (el.dataset.openUrl) { window.api.openExternal?.(el.dataset.openUrl); return; }
    if (el.hasAttribute('data-clan-back')) { closeDetail(); return; }
    if (el.dataset.clanOpen && !e.target.closest('button')) { openClan(el.dataset.clanOpen); return; }
    const c = curClan; if (!c) return;
    if (el.hasAttribute('data-clan-leave')) {
      if (!await showConfirm('Кланаас гарах', `«${c.name}» кланаас гарах уу?`)) return;
      await run(() => api('post', `/clans/${c.id}/leave`), 'Кланаас гарлаа'); closeDetail(); loadMine(); loadRooms?.(); return;
    }
    if (el.hasAttribute('data-clan-delete')) {
      if (!await showConfirm('Клан устгах', `«${c.name}» кланыг бүр мөсөн устгах уу? Гишүүд, хүсэлтүүд, хүлээлгийн өрөөнүүд хаагдана.`)) return;
      await run(() => api('delete', `/clans/${c.id}`), 'Клан устгагдлаа'); closeDetail(); loadMine(); loadRooms?.(); return;
    }
    if (el.hasAttribute('data-clan-edit')) { openEdit(c); return; }
    if (el.hasAttribute('data-clan-icon')) { iconInput.click(); return; }
    if (el.hasAttribute('data-clan-room')) { openClanRoomForm(c.id); return; }
    if (el.hasAttribute('data-clan-add')) {
      const v = ($('gx-addmem-input')?.value || '').trim(); if (!v) return;
      await run(() => api('post', `/clans/${c.id}/members`, /^\d+$/.test(v) ? { user_id: v } : { username: v }), 'Гишүүн нэмэгдлээ'); openClan(c.id); return;
    }
    if (el.dataset.clanKick) {
      if (!await showConfirm('Гишүүн хасах', `${el.dataset.name}-г кланаас хасах уу?`)) return;
      await run(() => api('delete', `/clans/${c.id}/members/${el.dataset.clanKick}`), 'Хасагдлаа'); openClan(c.id); return;
    }
    if (el.dataset.clanRole) {
      const r = el.dataset.clanRole;
      if (r === 'lord' && !await showConfirm('Clan Lord шилжүүлэх', 'Clan Lord эрхээ энэ гишүүнд шилжүүлэх үү? Та админ болно.')) return;
      await run(() => api('patch', `/clans/${c.id}/members/${el.dataset.uid}`, { role: r }), 'Эрх өөрчлөгдлөө'); openClan(c.id); loadMine(); return;
    }
    if (el.dataset.req) {
      await run(() => api('post', `/clans/${c.id}/requests/${el.dataset.req}/${el.dataset.act}`), el.dataset.act === 'accept' ? 'Хүсэлт батлагдлаа' : 'Татгалзлаа'); openClan(c.id); loadMine();
    }
  });
  async function refreshAll(id) { await loadMine(); if (document.querySelector('[data-clan-panel="discover"]')?.classList.contains('on')) loadDiscover(); if (curClan && String(curClan.id) === String(id)) openClan(id); }

  // ── Клан байгуулах modal ──
  async function openCreate(kindPreset) {
    if (!mine.can_create) {
      openModal('gx-clan-modal', `<div class="gx-upsell"><div class="gx-soon-ico"><svg><use href="#gx-i-crown"/></svg></div><h3>Клан байгуулах нь GOLD онцлог</h3>
        <p>Хамгийн өндөр Premium буюу <b>GOLD</b> гишүүнчлэлтэй тоглогч клан байгуулж Clan Lord болно. Discord серверээ клан болгоход мөн GOLD шаардлагатай.</p>
        <p class="hint">Кланд <b>нэгдэх</b> нь хүн бүрд үнэгүй.</p>
        <div class="gx-row-btns"><button type="button" class="btn btn-primary" data-goto-premium>GOLD болох</button><button type="button" class="btn" data-gx-close>Хаах</button></div></div>`);
      return;
    }
    let servers = [];
    try { servers = (await window.api.getDiscordServers()).filter((s) => mine.is_staff || String(s.added_by_id) === String(currentUser?.id)); } catch {}
    openModal('gx-clan-modal', `<h3 class="gx-modal-title">Клан байгуулах</h3>
      <div class="gx-seg gx-kind-seg"><button type="button" class="${kindPreset === 'discord' ? '' : 'on'}" data-kind="player">Тоглогчийн клан</button><button type="button" class="${kindPreset === 'discord' ? 'on' : ''}" data-kind="discord">Discord серверийн клан</button></div>
      <div class="gx-form">
        <label class="gx-dsel ${kindPreset === 'discord' ? '' : 'hidden'}"><span>Discord сервер</span><select id="gx-cc-ds" class="input">${servers.length ? servers.map((s) => `<option value="${s.id}" data-name="${esc(s.discord_meta?.guild_name || s.name)}">${esc(s.discord_meta?.guild_name || s.name)}</option>`).join('') : '<option value="">— Таны бүртгэсэн Discord сервер алга —</option>'}</select><small class="hint">Зөвхөн өөрийн бүртгэсэн серверээ клан болгоно. Серверээ эхлээд «Discord серверүүд» хэсэгт нэмнэ.</small></label>
        <label><span>Кланы нэр</span><input id="gx-cc-name" class="input" maxlength="32" placeholder="ж: Mongol Lords" /></label>
        <label><span>Таг (2–6)</span><input id="gx-cc-tag" class="input" maxlength="6" placeholder="MNL" /></label>
        <label><span>Тайлбар</span><textarea id="gx-cc-desc" class="input" rows="3" maxlength="300" placeholder="Кланы тухай, элсэх нөхцөл…"></textarea></label>
        <label><span>Элсэлт</span><select id="gx-cc-mode" class="input"><option value="request">Хүсэлтээр — Lord/админ батална</option><option value="open">Нээлттэй — хэн ч шууд нэгдэнэ</option></select></label>
        <p id="gx-cc-err" class="form-error"></p>
        <div class="gx-row-btns end"><button type="button" class="btn" data-gx-close>Болих</button><button type="button" class="btn btn-primary" id="gx-cc-submit">Байгуулах</button></div>
      </div>`);
    const setKind = (k) => {
      document.querySelectorAll('.gx-kind-seg [data-kind]').forEach((b) => b.classList.toggle('on', b.dataset.kind === k));
      document.querySelector('.gx-dsel')?.classList.toggle('hidden', k !== 'discord');
      if (k === 'discord') { const o = $('gx-cc-ds')?.selectedOptions[0]; if (o?.dataset.name && !$('gx-cc-name').value) $('gx-cc-name').value = o.dataset.name.slice(0, 32); }
    };
    document.querySelectorAll('.gx-kind-seg [data-kind]').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
    if (kindPreset === 'discord') setKind('discord');
    $('gx-cc-submit').onclick = async () => {
      const kind = document.querySelector('.gx-kind-seg .on')?.dataset.kind || 'player';
      const body = { name: $('gx-cc-name').value.trim(), tag: $('gx-cc-tag').value.trim(), description: $('gx-cc-desc').value.trim(), join_mode: $('gx-cc-mode').value, kind };
      if (kind === 'discord') body.discord_server_id = Number($('gx-cc-ds').value || 0);
      try { const c = await api('post', '/clans', body); closeModal('gx-clan-modal'); toast(`«${c.name}» клан байгуулагдлаа — та Clan Lord 🎉`, 'success'); await loadMine(); subTab('mine'); openClan(c.id); }
      catch (e) { $('gx-cc-err').textContent = errMsg(e); }
    };
  }
  function openEdit(c) {
    openModal('gx-clan-modal', `<h3 class="gx-modal-title">Кланы тохиргоо</h3><div class="gx-form">
      <label><span>Тайлбар</span><textarea id="gx-ce-desc" class="input" rows="3" maxlength="300">${esc(c.description || '')}</textarea></label>
      <label><span>Элсэлт</span><select id="gx-ce-mode" class="input"><option value="request" ${c.join_mode !== 'open' ? 'selected' : ''}>Хүсэлтээр</option><option value="open" ${c.join_mode === 'open' ? 'selected' : ''}>Нээлттэй</option></select></label>
      <div class="gx-row-btns end"><button type="button" class="btn" data-gx-close>Болих</button><button type="button" class="btn btn-primary" id="gx-ce-save">Хадгалах</button></div></div>`);
    $('gx-ce-save').onclick = async () => { await run(() => api('patch', `/clans/${c.id}`, { description: $('gx-ce-desc').value, join_mode: $('gx-ce-mode').value }), 'Хадгалагдлаа'); closeModal('gx-clan-modal'); openClan(c.id); };
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-goto-premium]')) { closeModal('gx-clan-modal'); showTab('premium'); } });
  $('gx-clan-create')?.addEventListener('click', () => openCreate('player'));
  $('gx-dclan-make')?.addEventListener('click', () => openCreate('discord'));

  // ── Өрөө үүсгэх формын кланы сонголт ──
  function syncRoomClanSelect() {
    const sel = $('room-clan'); if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">🌐 Нийтийн өрөө — бүгд харна</option>' + (mine.clans || []).map((c) => `<option value="${c.id}">🛡 [${esc(c.tag)}] ${esc(c.name)} — зөвхөн гишүүд</option>`).join('');
    sel.classList.toggle('hidden', !(mine.clans || []).length);
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }
  function openClanRoomForm(clanId) {
    showTab('lobby');
    const f = $('create-room-form'); if (f && f.style.display !== 'block') $('btn-create-room')?.click();
    setTimeout(() => { const s = $('room-clan'); if (s) s.value = String(clanId); }, 30);
  }

  // ── Таб холбох: showTab('clans'), хуучин 'discord' → Кланууд/Discord ──
  const _st = showTab;
  showTab = function (name) {
    if (name === 'discord') { _st('clans'); subTab('discord'); return; }
    _st(name);
    if (name === 'clans') { subTab(document.querySelector('[data-clan-tab].on')?.dataset.clanTab || 'mine'); }
  };
  // Socket: кланы өөрчлөлт (хүсэлт, батлалт, хасалт) → дахин ачаална
  setInterval(() => {
    if (typeof socket !== 'undefined' && socket && !socket.__gxClan) {
      socket.__gxClan = true;
      socket.on('clan:updated', (d) => {
        loadMine();
        if (d?.accepted) toast('Кланы элсэх хүсэлт тань батлагдлаа 🎉', 'success');
        // 🔔 мэдэгдлийн цэс (2026-10-03, эзэн): кланы хүсэлт ирсэн / батлагдсан / татгалзсан / нэмэгдсэн / хасагдсан
        try {
          const n = window.gxNotif; const cn = d?.clan_name ? `«${d.clan_name}»` : 'Клан';
          if (n && d) {
            if (d.request) n.push({ type: 'clan', icon: '🛡', clanId: d.clan_id, text: `${d.from_username || 'Хэн нэгэн'} ${cn} кланд элсэх хүсэлт илгээлээ`, sub: d.message || '', btn: 'Харах' });
            else if (d.accepted) n.push({ type: 'clan', icon: '🎉', clanId: d.clan_id, text: `${cn} кланд элсэх хүсэлт тань батлагдлаа`, sub: d.by_username ? `Баталсан: ${d.by_username}` : '', btn: 'Нээх' });
            else if (d.declined) { n.push({ type: 'info', icon: '✖', text: `${cn} кланд элсэх хүсэлт тань татгалзагдлаа` }); toast(`${cn} кланд элсэх хүсэлт тань татгалзагдлаа`, 'warning'); }
            else if (d.added) { n.push({ type: 'clan', icon: '🛡', clanId: d.clan_id, text: `Таныг ${cn} кланд нэмлээ`, sub: d.by_username ? `Нэмсэн: ${d.by_username}` : '', btn: 'Нээх' }); toast(`Таныг ${cn} кланд нэмлээ`, 'success'); }
            else if (d.removed) n.push({ type: 'info', icon: '🚪', text: `Таныг ${cn} клангаас хаслаа` });
            else if (d.role) n.push({ type: 'clan', icon: '⭐', clanId: d.clan_id, text: `${cn} кланд таны эрх: ${d.role === 'admin' ? 'Админ' : 'Гишүүн'}`, btn: 'Нээх' });
            else if (d.deleted) n.push({ type: 'info', icon: '🗑', text: 'Таны байсан клан устгагдлаа' });
          }
        } catch {}
        if (d?.removed || d?.deleted) { loadRooms?.(); if (curClan && String(curClan.id) === String(d.clan_id)) closeDetail(); }
        if (curClan && String(curClan.id) === String(d?.clan_id)) openClan(curClan.id);
      });
    }
  }, 2000);
  setTimeout(loadMine, 1200);

  // ══════════ Өрөөний баруун товчны цэс + Lobby мэдээлэл ══════════
  const ctx = $('gx-ctx');
  function hideCtx() { ctx?.classList.add('hidden'); }
  document.addEventListener('click', (e) => { if (!e.target.closest('#gx-ctx')) hideCtx(); });
  document.addEventListener('scroll', hideCtx, true);
  window.addEventListener('blur', hideCtx);
  document.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.gx-row[data-room-id]');
    if (!row || !ctx) return;
    e.preventDefault();
    const r = roomsCache[row.dataset.roomId]; if (!r) return;
    const me = String(r.host_id) === String(currentUser?.id);
    const friend = (myFriends || []).some((f) => String(f.id) === String(r.host_id));
    const item = (act, ico, label, cls = '') => `<button type="button" class="gx-ctx-i ${cls}" data-ctx="${act}"><svg><use href="#${ico}"/></svg>${label}</button>`;
    ctx.innerHTML = [
      item('info', 'gx-i-info', 'Lobby мэдээлэл'),
      item('host', 'gx-i-host', 'Хостын мэдээлэл'),
      me ? '' : '<hr>',
      me ? '' : item('dm', 'gx-i-msg', 'Мессеж илгээх'),
      me || friend ? '' : item('friend', 'gx-i-friends', 'Найзаар нэмэх', 'accent'),
      me ? '' : '<hr>',
      me ? '' : item('block', 'gx-i-block', 'Хэрэглэгч хаах', 'danger'),
    ].join('');
    ctx.dataset.roomId = r.id;
    ctx.classList.remove('hidden');
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = `${Math.min(e.clientX, innerWidth - w - 8)}px`;
    ctx.style.top = `${Math.min(e.clientY, innerHeight - h - 8)}px`;
  });
  ctx?.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ctx]'); if (!b) return;
    const r = roomsCache[ctx.dataset.roomId]; hideCtx(); if (!r) return;
    const hid = String(r.host_id), hname = r.host_name || '';
    if (b.dataset.ctx === 'info') showLobbyInfo(r);
    else if (b.dataset.ctx === 'host') openUserProfile(hid);
    else if (b.dataset.ctx === 'dm') openDM(hid, hname);
    else if (b.dataset.ctx === 'friend') addFriendClick(hid, hname);
    else if (b.dataset.ctx === 'block') blockUserClick(hid, hname);
  });
  const fmtDT = (v) => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toLocaleString('mn-MN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
  function showLobbyInfo(r) {
    const playing = r.status === 'playing';
    const full = (r.player_count || 0) >= (r.max_players || 0);
    const st = playing ? ['playing', 'Тоглож буй'] : full ? ['full', 'Дүүрсэн'] : ['open', 'Нээлттэй'];
    const row = (k, v) => `<div class="gx-kv"><span>${k}</span><b>${v}</b></div>`;
    const members = r.members || [];
    const isMine = String(r.host_id) === String(currentUser?.id) || members.some((m) => String(m.id) === String(currentUser?.id));
    openModal('gx-info-modal', `<h3 class="gx-modal-title">${esc(r.name)}</h3>
      <div class="gx-kvs">
        ${row('Тоглоом', `<i class="gx-gi sm" style="--gc:${gameTypeColor(r.game_type)}"></i>${esc(r.game_type || '-')}`)}
        ${row('Холболт', 'LAN relay · шууд mesh (v2.9+)')}
        ${row('Горим', esc((r.game_mode || 'Custom').toUpperCase()) + (r.ranked ? ' · 🏆 Ranked' : ''))}
        ${row('Төлөв', `<span class="gx-st ${st[0]}">${st[1]}</span>`)}
        ${r.clan_id ? row('Клан', `🛡 [${esc(r.clan_tag || '')}] ${esc(r.clan_name || '')} — зөвхөн гишүүд`) : ''}
        ${row('Нээгдсэн', fmtDT(r.created_at) || '—')}
        ${row('Тоглолт эхэлсэн', playing && fmtDT(r.playing_since) ? fmtDT(r.playing_since) : 'эхлээгүй')}
        ${row('Нууц үг', r.has_password ? '<span class="gx-warn">🔒 Тийм</span>' : 'Үгүй')}
      </div>
      <div class="dm-section-label">Тоглогчид (${r.player_count || members.length}/${r.max_players || '-'})</div>
      <ul class="gx-mems">${members.map((m) => `<li class="gx-mem"><span class="gx-mem-av">${esc(String(m.name || '?')[0].toUpperCase())}</span><span class="clickable-name" data-user-id="${esc(m.id)}">${esc(withTier(m.name, m.tier))}</span>${String(m.id) === String(r.host_id) ? '<svg class="gx-host-ico"><use href="#gx-i-host"/></svg>' : ''}</li>`).join('') || '<li class="hint">Тоглогч алга</li>'}</ul>
      <div class="gx-row-btns end"><button type="button" class="btn" data-gx-close>Хаах</button>${isMine ? '' : `<span data-gx-close>${roomActionButton(r, playing, false, String(currentUser?.id))}</span>`}</div>`);
  }
  window.gxClans = { loadMine, openClan, showLobbyInfo };
})();
