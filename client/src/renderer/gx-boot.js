// GX: сэдвийг CSS ачаалахаас өмнө тавина (анивчилтгүй). CSP-д inline script хориотой тул тусдаа файл.
try { document.documentElement.dataset.gxTheme = localStorage.getItem('gx_theme') || 'light'; } catch (e) { document.documentElement.dataset.gxTheme = 'light'; }
// Өөр хуудас (жиш: шигтгэсэн өрөө) сэдэв солиход энд ч дагана
window.addEventListener('storage', function (e) { if (e.key === 'gx_theme' && e.newValue) document.documentElement.dataset.gxTheme = e.newValue; });
// Шигтгэсэн өрөө (iframe): app.js-ийн window.close() → үндсэн цонх руу «хаагдлаа» мессеж (iframe-ийг устгана)
(function () {
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('mode') === 'room' && window.parent && window.parent !== window) {
      window.close = function () { try { window.parent.postMessage({ gx: true, type: 'closed', roomId: q.get('roomId') }, '*'); } catch (e) {} };
    }
  } catch (e) {}
})();
