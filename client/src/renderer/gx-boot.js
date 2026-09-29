// GX: сэдвийг CSS ачаалахаас өмнө тавина (анивчилтгүй). CSP-д inline script хориотой тул тусдаа файл.
try { document.documentElement.dataset.gxTheme = localStorage.getItem('gx_theme') || 'light'; } catch (e) { document.documentElement.dataset.gxTheme = 'light'; }
