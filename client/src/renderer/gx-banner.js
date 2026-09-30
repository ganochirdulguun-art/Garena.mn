// ══════════════════════════════════════════════════════════════
// Профайлын дэвсгэр (GOLD, 2026-09-30) — GIF/WebP хөдөлгөөнт, PNG/JPG, ≤5MB.
// Өөрийн профайл: «Дэвсгэр солих» / «Устгах» (Bronze/Silver → GOLD санал). Бусдын профайл цонх: дэвсгэр харагдана.
// Сервер: POST/DELETE /profile/banner, GET /profile/banner/:id (нээлттэй).
// ══════════════════════════════════════════════════════════════
(function gxBanner() {
  if (new URLSearchParams(location.search).get('mode')) return;
  const $ = (id) => document.getElementById(id);
  const errMsg = (e) => String(e?.message || e || 'Алдаа гарлаа').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const toast = (m, t = 'info') => { try { showToast(m, t, 4500); } catch {} };
  const url = (id, ver) => window.__BANNER_TEST__ || `${SERVER}/profile/banner/${encodeURIComponent(id)}${ver ? `?v=${ver}` : ''}`;   // __BANNER_TEST__ = dev урьдчилан харах
  const isGold = () => !!(currentUser && (currentUser.is_owner || currentUser.tier === 'gold'));

  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/gif,image/webp,image/png,image/jpeg'; input.style.display = 'none';
  document.body.appendChild(input);

  function mount() {
    const card = document.querySelector('#tab-profile .profile-summary-card'); if (!card || !currentUser) return;
    let b = card.querySelector('.gx-banner');
    if (!b) {
      b = document.createElement('div'); b.className = 'gx-banner';
      b.innerHTML = '<img class="gx-banner-img" alt="" draggable="false" /><div class="gx-banner-acts"><button type="button" class="gx-banner-btn" data-banner="set"><svg class="btn-icon-svg"><use href="#ico-camera"/></svg><span>Дэвсгэр солих</span></button><button type="button" class="gx-banner-btn ghost" data-banner="del" title="Дэвсгэр устгах">✕</button></div>';
      card.insertBefore(b, card.firstChild); card.classList.add('has-banner');
      b.querySelector('img').addEventListener('error', () => b.classList.remove('has-img'));
      b.querySelector('img').addEventListener('load', () => b.classList.add('has-img'));
    }
    const img = b.querySelector('img');
    const ver = currentUser.banner_ver;
    if (ver) { const src = url(currentUser.id, ver); if (img.getAttribute('src') !== src) img.src = src; }
    else { img.removeAttribute('src'); b.classList.remove('has-img'); }
    b.querySelector('[data-banner="set"] span').textContent = isGold() ? 'Дэвсгэр солих' : 'Дэвсгэр · GOLD';
    b.querySelector('[data-banner="del"]').classList.toggle('hidden', !ver);
  }
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-banner]'); if (!btn) return;
    if (btn.dataset.banner === 'set') {
      if (!isGold()) {
        if (await showConfirm('GOLD онцлог', 'Профайлын хөдөлгөөнт дэвсгэр (GIF/WebP) зөвхөн GOLD гишүүнд нээлттэй. Premium хуудас руу очих уу?')) showTab('premium');
        return;
      }
      input.click();
    } else if (btn.dataset.banner === 'del') {
      if (!await showConfirm('Дэвсгэр устгах', 'Профайлын дэвсгэрээ устгах уу?')) return;
      try { await window.api.request('delete', '/profile/banner'); currentUser.banner_ver = null; mount(); toast('Дэвсгэр устгагдлаа', 'success'); }
      catch (err) { toast(errMsg(err), 'error'); }
    }
  });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0]; input.value = '';
    if (!f) return;
    if (!/^image\/(gif|webp|png|jpeg)$/.test(f.type)) { toast('GIF, WebP, PNG эсвэл JPG зураг сонгоно уу', 'warning'); return; }
    if (f.size > 5 * 1024 * 1024) { toast('Зураг 5MB-с ихгүй байх ёстой', 'warning'); return; }
    const card = document.querySelector('#tab-profile .gx-banner'); card?.classList.add('busy');
    try {
      const r = await window.api.uploadBanner(new Uint8Array(await f.arrayBuffer()));
      currentUser.banner_ver = r.banner_ver; mount();
      toast(`Дэвсгэр солигдлоо ✅${f.type === 'image/gif' || f.type === 'image/webp' ? ' — хөдөлгөөнтэй' : ''}`, 'success');
    } catch (err) { toast(errMsg(err), 'error'); }
    finally { card?.classList.remove('busy'); }
  });

  // Бусдын профайл цонх (user-profile-modal) — дэвсгэр байвал дээд талд
  const _open = openUserProfile;
  openUserProfile = async function (userId) {
    const r = await _open(userId);
    const box = document.querySelector('#user-profile-modal .user-profile-box');
    if (box) {
      let b = box.querySelector('.gx-pop-banner');
      if (!b) { b = document.createElement('img'); b.className = 'gx-pop-banner'; b.alt = ''; box.insertBefore(b, box.firstChild); b.addEventListener('error', () => { b.classList.remove('on'); }); b.addEventListener('load', () => b.classList.add('on')); }
      b.classList.remove('on'); b.src = `${url(userId)}?t=${Math.floor(Date.now() / 300000)}`;
    }
    return r;
  };

  const _st = showTab;
  showTab = function (name) { _st(name); if (name === 'profile') { mount(); setTimeout(mount, 800); } };
  window.gxBanner = { mount };
})();
