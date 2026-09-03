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
    document.getElementById('rk-create')?.addEventListener('click', () => {
      showTab('lobby');
      document.getElementById('btn-create-room')?.click();
      const rk = document.getElementById('room-ranked');
      if (rk) rk.checked = true;
      document.getElementById('room-name')?.focus();
    });
    document.getElementById('rk-profile')?.addEventListener('click', () => showTab('profile'));
  }
  window.infoTabs = { wire };
})();
