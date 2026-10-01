// ── WarKey / Ranked мэдээллийн табууд — татах линк, вэб хуудас, Ranked өрөө үүсгэх товч ──
(function () {
  'use strict';
  const WARKEY_DOWNLOAD = 'https://github.com/ganochirdulguun-art/GarenaWarKey/releases/latest/download/GarenaWarKey.exe';
  const SITE = 'https://garenamn-production.up.railway.app/#warkey';
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    document.getElementById('wk-download')?.addEventListener('click', () => window.api.openExternal(WARKEY_DOWNLOAD));
    document.getElementById('wk-open-site')?.addEventListener('click', () => window.api.openExternal(SITE));
    // 🏆 Ranked зөвхөн нийтийн WC3 Room 1–5 (2026-10-02) — товч нь хамгийн тохиромжтой Ranked Room руу оруулна
    document.getElementById('rk-create')?.addEventListener('click', () => {
      if (window.gxJoinRanked) window.gxJoinRanked(); else showTab('lobby');
    });
    document.getElementById('rk-profile')?.addEventListener('click', () => showTab('profile'));
  }
  window.infoTabs = { wire };
})();
