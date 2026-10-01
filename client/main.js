const { app, BrowserWindow, ipcMain, shell, protocol, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile, execFileSync } = require('child_process');
const QRCode = require('qrcode');
const { autoUpdater } = require('electron-updater');

const axios = require('axios');
const authService = require('./src/services/auth');
const replayService = require('./src/services/replay');
const firewallService = require('./src/services/firewall');
const apiService = require('./src/services/api');
const gameRelayService = require('./src/services/gameRelay');
const meshService = require('./src/services/mesh');   // Tailscale/Headscale mesh — чимээгүй суулгалт + нэгдэлт (Ш2, 2026-09-27)

const SERVER_URL = process.env.SERVER_URL || 'https://garenamn-production.up.railway.app';

// preload (getToken/request)-той цонхнуудыг хатууруулна: гаднын origin руу шилжих буюу
// popup нээхийг хориглоно — ингэснээр renderer-т ямар нэг script орлого гарсан ч JWT/API-г
// гаднын хост руу гаргах боломжгүй (зөвхөн локал file:// навигаци зөвшөөрнө).
function hardenWindow(win) {
  if (!win || !win.webContents) return;
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Гадаад http(s) холбоосыг системийн browser-т нээнэ, апп цонхонд БИШ
    if (/^https?:\/\//i.test(url)) { shell.openExternal(url).catch(() => {}); }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!/^file:\/\//i.test(url)) e.preventDefault();
  });
}

// ── Auto-updater тохиргоо ─────────────────────────────────
autoUpdater.autoDownload    = true;   // суллагдмагц дэвсгэрт татна
autoUpdater.autoInstallOnAppQuit = true; // апп хаагдах үед татагдсан шинэчлэлт чимээгүй суудаг

autoUpdater.on('update-available',  (info) => {
  mainWindow?.webContents.send('update:available', { version: info.version });
});
autoUpdater.on('download-progress', (p) => {
  mainWindow?.webContents.send('update:progress', Math.round(p.percent));
});
autoUpdater.on('update-downloaded', (info) => {
  _downloadedVersion = info.version;
  mainWindow?.webContents.send('update:downloaded', { version: info.version });
  const w = _downloadWaiters.splice(0); w.forEach((r) => r(info.version));
});

// ── Ямар ч хоцорсон хувилбараас ШУУД хамгийн сүүлийнх рүү (2026-09-03) ──
// Асуудал: апп асахдаа тухайн үеийн хамгийн сүүлийнхийг татчихдаг; хэрэглэгч хэдэн цагийн дараа
// хаахад тэр ТАТАГДСАН хувилбар суудаг тул тэр хооронд шинэ хувилбар гарсан бол 2 удаа шинэчилдэг байв.
// Засвар: (1) 30 мин тутам дахин шалгана (шинэ гарвал electron-updater дахин татна, сүүлд татагдсан нь суудаг),
// (2) суулгахын/хаахын өмнө дахин шалгаж, татагдсанаас илүү шинэ байвал түүнийг татаж дуусаад суулгана.
let _downloadedVersion = null;
const _downloadWaiters = [];
function cmpVer(a, b) {
  const pa = String(a || '0').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '0').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
// Дахин шалгаад, татагдсанаас шинэ хувилбар байвал татаж дуусахыг хүлээнэ (maxWaitMs хүртэл). Буцаана: суулгахад бэлэн хувилбар.
async function ensureLatestDownloaded(maxWaitMs) {
  if (!app.isPackaged) return _downloadedVersion;
  let latest = null;
  try { latest = (await autoUpdater.checkForUpdates())?.updateInfo?.version || null; } catch { return _downloadedVersion; }
  if (!latest || cmpVer(latest, _downloadedVersion) <= 0) return _downloadedVersion;
  console.log(`[AutoUpdater] татагдсан ${_downloadedVersion} < сүүлийн ${latest} — шинийг татаж байна`);
  const got = await new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), maxWaitMs);
    _downloadWaiters.push((v) => { clearTimeout(t); resolve(v); });
  });
  return got || _downloadedVersion;
}
autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater]', err.message);
  mainWindow?.webContents.send('update:error', err.message);
});

let mainWindow;
let roomWindow = null;
const dmWindows = new Map(); // userId -> BrowserWindow

// Event-ийг бүх цонх руу илгээх — өрөөний цонх тусдаа BrowserWindow тул
// зөвхөн mainWindow руу илгээвэл өрөөний logic (currentRoom) хүлээж авдаггүй
// GX (2.9.2): өрөө үндсэн цонхны iframe-д шигтгэгддэг тул дэд frame бүрт ч илгээнэ (preload subframe-д ажиллана)
function sendToAllFrames(win, channel, data) {
  if (!win || win.isDestroyed()) return;
  let sent = false;
  try {
    for (const f of win.webContents.mainFrame.framesInSubtree) { try { f.send(channel, data); sent = true; } catch {} }
  } catch {}
  if (!sent) { try { win.webContents.send(channel, data); } catch {} }
}
function broadcastToWindows(channel, data) {
  BrowserWindow.getAllWindows().forEach((win) => sendToAllFrames(win, channel, data));
}
// Өрөөг үндсэн цонхонд (GameRanger X шиг) шигтгэх эсэх — settings.roomWindowMode === 'separate' бол хуучин тусдаа цонх
function roomEmbedded() { try { return readSettings().roomWindowMode !== 'separate'; } catch { return true; } }

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 730,
    minWidth: 940,
    minHeight: 640,
    title: 'Garena.mn',
    icon: path.join(__dirname, 'src/renderer/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegrationInSubFrames: true,   // GX: шигтгэсэн өрөөний iframe-д preload (window.api) ажиллана
      nodeIntegration: false, backgroundThrottling: false, },
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#0c0b0f',
  });

  // Найзууд цонх БАРУУН талд багтахаар: гол цонх + найзууд-ыг нэг блок болгож дэлгэц голлоно
  try {
    const b = mainWindow.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    const combinedW = b.width + FRIENDS_W;
    const x = area.x + Math.max(0, Math.round((area.width - combinedW) / 2));
    const y = area.y + Math.max(0, Math.round((area.height - b.height) / 2));
    mainWindow.setPosition(x, y);
  } catch {}

  // Эзний хүсэлт (2026-09-30): апп нээгдэхдээ дэлгэц дүүрэн (maximize) — жижиг цонх биш
  try { mainWindow.maximize(); } catch {}

  mainWindow.loadFile('src/renderer/index.html');
  hardenWindow(mainWindow);
  // Найзууд цонх үндсэн цонхны хажууд наалдаж явна; үндсэн цонх хаагдахад хамт хаагдана
  mainWindow.on('moved', dockFriendsWindow);
  mainWindow.on('resized', dockFriendsWindow);
  mainWindow.on('closed', () => { closeFriendsWindow(); mainWindow = null; });
}

// Discord OAuth2 deep link: garenamn://auth?token=...
// Windows dev mode: execPath + argv[1] шаардлагатай
if (process.platform === 'win32') {
  app.setAsDefaultProtocolClient('garenamn', process.execPath, [
    path.resolve(process.argv[1] || '.'),
  ]);
} else {
  app.setAsDefaultProtocolClient('garenamn');
}

// Single instance — хоёр дахь instance нь deep link дамжуулна
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

// (ZeroTier бүрэн хасагдсан 2026-08-30 — бот-хост public IP тунел ашигладаг)

// ── Garena.mn WarKey-д зориулсан "платформ идэвхтэй" локал дохио ──
// Garena.mn WarKey (тусдаа апп) энэ файлын шинэлэг байдлаар платформ энэ PC дээр
// ажиллаж байгааг мэдэрнэ. GarenaSystem тэмцээний түүхгүй энгийн хэрэглэгч WarKey-г
// зөвхөн платформ нээлттэй (нэвтэрсэн) үед л ашиглаж чадна. Хоёр апп нэг ижил
// %LOCALAPPDATA%\Garena.mn\platform-session.json замыг мэднэ.
const PLATFORM_SESSION_FILE = path.join(
  process.env.LOCALAPPDATA || path.join(app.getPath('home'), 'AppData', 'Local'),
  'Garena.mn', 'platform-session.json'
);
let _presenceTimer = null;
function writePlatformPresence() {
  try {
    if (!authService.getToken()) return;   // зөвхөн платформд нэвтэрсэн үед дохио өгнө
    const user = (authService.getUser && authService.getUser()) || {};
    fs.mkdirSync(path.dirname(PLATFORM_SESSION_FILE), { recursive: true });
    fs.writeFileSync(PLATFORM_SESSION_FILE, JSON.stringify({
      ts: Date.now(),
      userId: user && user.id != null ? user.id : null,
      discord_id: user && user.discord_id != null ? user.discord_id : null,
    }));
  } catch { /* дохио эмзэг биш */ }
}
function stopPlatformPresence() {
  if (_presenceTimer) { clearInterval(_presenceTimer); _presenceTimer = null; }
  try { fs.unlinkSync(PLATFORM_SESSION_FILE); } catch {}
}

app.whenReady().then(() => {
  createWindow();

  // WarKey-д "платформ идэвхтэй" дохиог 5 сек тутам бичнэ
  writePlatformPresence();
  _presenceTimer = setInterval(writePlatformPresence, 5000);

  // MapHack хориотой процессын жагсаалтыг серверээс татаж, 10 мин тутам шинэчилнэ
  refreshMaphackList();
  setInterval(refreshMaphackList, 10 * 60 * 1000).unref?.();

  // Апп эхлэхдээ argv-д deep link байгаа эсэх шалгах (Windows)
  const deepLinkUrl = process.argv.find(a => a.startsWith('garenamn://'));
  if (deepLinkUrl) handleDeepLink(deepLinkUrl);

  // Mesh (Tailscale): нэвтэрсний дараа чимээгүй нэгдэнэ; 20с-д эхэлж 30 мин тутам дахин шалгана (блоклохгүй)
  setTimeout(() => meshEnsure().catch(() => {}), 20 * 1000);
  setInterval(() => meshEnsure().catch(() => {}), 30 * 60 * 1000).unref?.();

  // Апп бэлэн болсноос 5 секундийн дараа update шалгах
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
    // 30 мин тутам дахин шалгана — өдөрт олон хувилбар гарахад хэрэглэгч хоцрохгүй
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 30 * 60 * 1000).unref?.();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Апп хаагдахаас өмнө өрөөг цэвэрлэх
let _quitCleanupDone = false;
let _isInstallingUpdate = false; // quitAndInstall-д before-quit-г алгасах
app.on('before-quit', async (e) => {
  if (_quitCleanupDone || _isInstallingUpdate) return;
  e.preventDefault();
  _quitCleanupDone = true;
  // 2026-10-01: сервер (Railway) гацахад эдгээр хүсэлт хэдэн минут хүлээж, апп ЦОНХГҮЙ далд үлддэг байсан →
  // дахин дарахад single-instance lock-оос болж «алга болдог». Цэвэрлэгээг дээд тал нь 3 секунд хүлээнэ.
  const cleanup = (async () => {
    const token = authService.getToken();
    if (token) {
      const myRoom = await apiService.getMyRoom();
      const user   = authService.getUser();
      if (myRoom) {
        if (String(myRoom.host_id) === String(user?.id)) {
          await apiService.closeRoom(myRoom.id);
        } else {
          await apiService.leaveRoom(myRoom.id);
        }
      }
    }
  })().catch(() => {});
  await Promise.race([cleanup, new Promise((r) => setTimeout(r, 3000))]);
  // Хаахад чимээгүй суулгах шинэчлэлт татагдсан бол: илүү шинэ хувилбар гарсан эсэхийг 8 сек дотор шалгаж татна
  if (_downloadedVersion) { try { await ensureLatestDownloaded(8000); } catch {} }
  gameRelayService.stopAll();
  replayService.stopWatcher();
  stopPlatformPresence();
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Discord callback deep link Windows дээр
app.on('second-instance', (event, argv) => {
  const url = argv.find((arg) => arg.startsWith('garenamn://'));
  if (url) handleDeepLink(url);
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  } else if (!_quitCleanupDone && app.isReady()) {
    // Цонх ямар нэг шалтгаанаар алга болсон бол дахин дарахад шинээр нээнэ (2026-10-01)
    createWindow();
  }
});

// macOS deep link
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'auth') {
      const token = parsed.searchParams.get('token');
      if (token) {
        authService.saveToken(token); // гэмтэлтэй/хуурамч token бол throw хийнэ
        // Серверээс бүрэн мэдээлэл (avatar_url г.м.) авах
        fetchAndSaveUser().then(() => {
          mainWindow?.webContents.send('auth:success', authService.getUser());
        }).catch((e) => console.error('[DeepLink] fetchAndSaveUser', e?.message));
      }
    }
  } catch (e) {
    console.error('[DeepLink] буруу URL/токен:', e?.message);
  }
}

// ── IPC handlers ──────────────────────────────────────────

// Нэвтрэх — Discord-г системийн browser дээр нээгээд state polling-оор токен авна.
// Embedded Electron popup нь OAuth дээр хаагдах/redirect барихгүй байх эрсдэлтэй.
ipcMain.handle('auth:login', async () => {
  const sessionId = require('crypto').randomBytes(16).toString('hex');
  const url = `${apiService.SERVER_URL}/auth/discord?state=${sessionId}`;

  console.log('[Discord Login] Browser нээж байна:', url);
  startAuthPoll(sessionId, 'Discord Login');
  await shell.openExternal(url);

  return { ok: true, sessionId };
});

// QR кодны data URL үүсгэх + polling эхлүүлэх
let _qrPollInterval = null;
function startAuthPoll(sessionId, label = 'Auth') {
  if (_qrPollInterval) {
    clearInterval(_qrPollInterval);
    _qrPollInterval = null;
  }

  const axios = require('axios');
  let attempts = 0;
  _qrPollInterval = setInterval(async () => {
    attempts++;
    if (attempts > 200) {
      clearInterval(_qrPollInterval);
      _qrPollInterval = null;
      return;
    }
    try {
      const { data } = await axios.get(
        `${apiService.SERVER_URL}/auth/poll/${sessionId}`,
        { timeout: 2000 }
      );
      if (data.token) {
        clearInterval(_qrPollInterval);
        _qrPollInterval = null;
        authService.saveToken(data.token);
        fetchAndSaveUser().then(() => {
          mainWindow?.webContents.send('auth:success', authService.getUser());
        });
        console.log(`[${label}] Нэвтэрлээ!`);
      }
    } catch {}
  }, 3000);
}

ipcMain.handle('auth:qr', async () => {
  try {
    // Таамаглагдахгүй session ID (token хулгайлахаас хамгаална)
    const sessionId = require('crypto').randomBytes(16).toString('hex');
    const url = `${apiService.SERVER_URL}/auth/discord?state=${sessionId}`;

    console.log('[QR] Үүсгэж байна:', url);

    // Стандарт бараан-код-цагаан-дэвсгэр QR — урвуу өнгөтэй QR-ийг
    // утасны камер болон скан аппууд таньдаггүй!
    const dataUrl = await QRCode.toDataURL(url, {
      width: 240,
      margin: 2,
      color: { dark: '#16213e', light: '#ffffff' },
    });

    console.log('[QR] Амжилттай үүсгэлээ');

    // QR скан хийгдэх хүртэл polling хийнэ (10 минут — серверийн token TTL-тэй ижил)
    startAuthPoll(sessionId, 'QR');

    return { dataUrl, sessionId };
  } catch (err) {
    console.error('[QR] Алдаа:', err.message, err.stack);
    throw err;
  }
});

// Axios алдааны мессежийг ойлгомжтой болгох helper
function apiError(err) {
  const msg = err.response?.data?.error || err.response?.data?.message || err.message;
  return new Error(msg);
}

// Серверээс хэрэглэгчийн бүрэн мэдээлэл авч локал хадгалах
async function fetchAndSaveUser() {
  const token = authService.getToken();
  if (!token) return null;
  try {
    const axios = require('axios');
    const { data } = await axios.get(`${apiService.SERVER_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (data) authService.updateUser(data);
    return data;
  } catch { return null; }
}

// Имэйл бүртгэл
ipcMain.handle('auth:register', async (_, { username, email, password }) => {
  const axios = require('axios');
  try {
    const { data } = await axios.post(`${apiService.SERVER_URL}/auth/register`, { username, email, password });
    if (data.token) authService.saveToken(data.token, data.user);
    return data;
  } catch (err) { throw apiError(err); }
});

// Имэйл нэвтрэх
ipcMain.handle('auth:emailLogin', async (_, { email, password }) => {
  const axios = require('axios');
  try {
    const { data } = await axios.post(`${apiService.SERVER_URL}/auth/login`, { email, password });
    if (data.token) authService.saveToken(data.token, data.user);
    return data;
  } catch (err) { throw apiError(err); }
});

// Discord холбох (одоо байгаа хэрэглэгчтэй)
ipcMain.handle('auth:linkDiscord', () => {
  const user = authService.getUser();
  const token = authService.getToken();
  if (!user || !token) return;
  const authWin = new BrowserWindow({
    width: 520, height: 700, title: 'Discord холбох',
    parent: mainWindow, modal: true,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, },
  });
  authWin.loadURL(`${apiService.SERVER_URL}/auth/discord?link=1&token=${encodeURIComponent(token)}`);
  const handleRedirect = (url) => {
    if (url.startsWith('garenamn://')) {
      authWin.close();
      handleDeepLink(url);
      return true;
    }
    return false;
  };
  authWin.webContents.on('will-redirect', (e, url) => { if (handleRedirect(url)) e.preventDefault(); });
  authWin.webContents.on('will-navigate',  (e, url) => { if (handleRedirect(url)) e.preventDefault(); });
});

ipcMain.handle('auth:changePassword', async (_, { oldPassword, newPassword }) => {
  const axios = require('axios');
  const token = authService.getToken();
  if (!token) throw new Error('Нэвтрэх хугацаа дууссан');
  try {
    const { data } = await axios.put(
      `${apiService.SERVER_URL}/auth/password`,
      { oldPassword, newPassword },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return data;
  } catch (err) { throw apiError(err); }
});

// Update суулгаж restart хийх
ipcMain.handle('update:install', async () => {
  // Суулгахын өмнө дахин шалгана: татагдсанаас шинэ гарсан бол түүнийг татаж (≤2 мин) дараа нь суулгана
  try { await ensureLatestDownloaded(120000); } catch {}
  _isInstallingUpdate = true; // before-quit cleanup алгасах
  // Цонхыг нуухын тулд UAC dialog харагдана
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  if (roomWindow && !roomWindow.isDestroyed()) roomWindow.hide();
  // isSilent=false: installer UI харагдана (SmartScreen bypass боломжтой)
  // isForceRunAfter=true: суулгасны дараа апп дахин нээнэ
  setTimeout(() => autoUpdater.quitAndInstall(false, true), 300);
});

// App хувилбар буцаах
ipcMain.handle('update:version', () => app.getVersion());

// Гараар шинэчлэл шалгах
ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) return { error: 'dev' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { version: result?.updateInfo?.version || null };
  } catch (e) {
    return { error: e.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  closeFriendsWindow();
  // User-ийн өрөөг сервер дээр хаах/гарах
  try {
    const myRoom = await apiService.getMyRoom();
    const user   = authService.getUser();
    if (myRoom) {
      if (String(myRoom.host_id) === String(user?.id)) {
        await apiService.closeRoom(myRoom.id);
      } else {
        await apiService.leaveRoom(myRoom.id);
      }
    }
  } catch {}
  // Өрөөний цонхыг хаах
  if (roomWindow && !roomWindow.isDestroyed()) {
    roomWindow.destroy();
    roomWindow = null;
  }
  // DM цонхнуудыг хаах
  for (const [, win] of dmWindows) {
    if (!win.isDestroyed()) win.destroy();
  }
  dmWindows.clear();
  authService.clearToken();
  replayService.stopWatcher();
  return true;
});

ipcMain.handle('auth:getUser',  () => authService.getUser());
ipcMain.handle('auth:refreshUser', () => fetchAndSaveUser());
ipcMain.handle('auth:getToken', () => authService.getToken());

// Өрөөнүүд
ipcMain.handle('rooms:list',       async () => apiService.getRooms());
ipcMain.handle('rooms:quickmatch', async (_, game_type) => {
  try { return await apiService.quickMatch(game_type); } catch (err) { throw apiError(err); }
});
ipcMain.handle('rooms:mine', async () => {
  try { return await apiService.getMyRoom(); } catch { return null; }
});

// Ерөнхий нэвтэрсэн API хүсэлт (Банк, гишүүнчлэл гэх мэт шинэ endpoint-ууд)
ipcMain.handle('api:request', async (_event, { method, path: urlPath, body } = {}) => {
  const allowed = ['get', 'post', 'put', 'patch', 'delete'];
  // urlPath заавал нэг '/'-ээр эхэлж, дараа нь '/' эсвэл '\' БИШ байх ёстой.
  // "//host" эсвэл "/\host" нь axios-т protocol-relative абсолют URL болж, baseURL-ыг
  // тойрч JWT-г гаднын хост руу илгээх эрсдэлтэй. Абсолют URL (scheme://)-г мөн хаана.
  const badPath = typeof urlPath !== 'string'
    || !/^\/(?![/\\])/.test(urlPath)
    || /^[a-z][a-z\d+.-]*:\/\//i.test(urlPath);
  if (!allowed.includes(String(method || '').toLowerCase()) || badPath) {
    throw new Error('Буруу хүсэлт');
  }
  try { return await apiService.request(method, urlPath, body); } catch (err) { throw apiError(err); }
});

ipcMain.handle('rooms:create', async (event, { name, max_players, game_type, password, description, game_mode, background_url, ranked, clan_id }) => {
  let room;
  try {
    room = await apiService.createRoom({ name, max_players, game_type, password, description, game_mode, background_url, ranked: !!ranked, clan_id: clan_id || null });
  } catch (err) { throw apiError(err); }
  try { replayService.startWatcher(room.id); } catch {}
  return room;
});

ipcMain.handle('rooms:join', async (event, roomId, password) => {
  try {
    const result = await apiService.joinRoom(roomId, password);
    try { replayService.startWatcher(roomId); } catch {}
    return result;
  } catch (err) { throw apiError(err); }
});

ipcMain.handle('rooms:start', async (event, roomId) => {
  try { return await apiService.startRoom(roomId); } catch (err) { throw apiError(err); }
});

ipcMain.handle('rooms:end', async (event, roomId) => {
  try { return await apiService.endRoom(roomId); } catch (err) { throw apiError(err); }
});

ipcMain.handle('rooms:update', async (event, roomId, updates) => {
  try { return await apiService.updateRoom(roomId, updates); } catch (err) { throw apiError(err); }
});

ipcMain.handle('rooms:close', async (event, roomId) => {
  gameRelayService.stopAll();
  try { return await apiService.closeRoom(roomId); } catch (err) { throw apiError(err); }
});

ipcMain.handle('rooms:kick', async (event, roomId, targetUserId) => {
  try { return await apiService.kickPlayer(roomId, targetUserId); } catch (err) { throw apiError(err); }
});

ipcMain.handle('rooms:leave', async (event, roomId) => {
  const result = await apiService.leaveRoom(roomId);
  gameRelayService.stopAll();
  replayService.stopWatcher();
  return result;
});

// Статистик
ipcMain.handle('stats:player', async (_, discordId) => {
  return apiService.getPlayerStats(discordId);
});
ipcMain.handle('stats:playerById', async (_, userId) => {
  return apiService.getPlayerStatsById(userId);
});
ipcMain.handle('stats:history', async (_, userId, page) => {
  return apiService.getGameHistory(userId, page);
});
ipcMain.handle('stats:ranking', async (_, { sort, page } = {}) => {
  try { return await apiService.getRanking({ sort, page }); } catch (err) { throw apiError(err); }
});
ipcMain.handle('stats:tierbotSync', async (_, payload = {}) => {
  try { return await apiService.syncTierBot(payload); } catch (err) { throw apiError(err); }
});

// Auth utilities
ipcMain.handle('auth:forgotPassword', async (_, email) => {
  try { return await apiService.forgotPassword(email); } catch (err) { throw apiError(err); }
});
ipcMain.handle('auth:resetPassword', async (_, token, newPassword) => {
  try { return await apiService.resetPassword(token, newPassword); } catch (err) { throw apiError(err); }
});
ipcMain.handle('auth:unlinkDiscord', async () => {
  try { return await apiService.unlinkDiscord(); } catch (err) { throw apiError(err); }
});

// Replay watcher — тоглоом дуусахад renderer руу мэдэгдэх
// Өрөөний цонх нээлттэй бол түүнд (хэрэглэгч тэнд байгаа), үгүй бол main цонхонд
replayService.onResult((data) => {
  if (roomWindow && !roomWindow.isDestroyed()) roomWindow.webContents.send('game:result', data);
  else sendToAllFrames(mainWindow, 'game:result', data);   // шигтгэсэн өрөө (iframe) эсвэл үндсэн цонх
});

// Өрөөний гишүүдийг replay service-д дамжуулах (player matching)
ipcMain.handle('replay:setMembers', (_, members) => {
  replayService.setMembers(members);
  return true;
});

// ── Cache цэвэрлэх ────────────────
ipcMain.handle('cache:getSize', async () => {
  const userDataPath = app.getPath('userData');
  const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'blob_storage',
    'Session Storage', 'Service Worker', 'WebStorage', 'Shared Dictionary', 'Network'];
  let totalSize = 0;
  for (const dir of cacheDirs) {
    const dirPath = path.join(userDataPath, dir);
    try {
      const files = fs.readdirSync(dirPath, { recursive: true, withFileTypes: true });
      for (const f of files) {
        if (f.isFile()) {
          try { totalSize += fs.statSync(path.join(f.parentPath || f.path, f.name)).size; } catch {}
        }
      }
    } catch {}
  }
  return totalSize;
});

ipcMain.handle('app:relaunch', () => {
  app.relaunch();
  app.quit();
});

ipcMain.handle('cache:clear', async () => {
  const userDataPath = app.getPath('userData');
  const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'blob_storage',
    'Session Storage', 'Service Worker', 'WebStorage', 'Shared Dictionary', 'Network', 'SharedStorage'];
  let cleared = 0;
  for (const dir of cacheDirs) {
    const dirPath = path.join(userDataPath, dir);
    try { fs.rmSync(dirPath, { recursive: true, force: true }); cleared++; } catch {}
  }
  return cleared;
});

// ── Тохируулга (settings.json in userData) ────────────────
function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(data) {
  const current = readSettings();
  fs.writeFileSync(getSettingsPath(), JSON.stringify({ ...current, ...data }, null, 2));
}

// Хуучин wc3Path-г games жагсаалт руу шилжүүлэх helper
function migrateSettings(s) {
  if (!s.games && s.wc3Path) {
    s.games = [{ id: 'legacy', name: 'Warcraft 3', path: s.wc3Path }];
  }
  if (!s.games) s.games = [];
  return s;
}

function configuredGamePaths() {
  const s = migrateSettings(readSettings());
  return (s.games || [])
    .map((g) => g.path)
    .filter((p) => typeof p === 'string' && p.trim());
}

// ── Map-ын сан (2026-09-30): WC3 хувилбар, Maps\Download, татах/оруулах — бүгд async ──
const mapsService = require('./src/services/maps');
let _mapsPicked = null;   // зөвхөн maps:pickFile-аар сонгосон файлыг upload хийнэ
async function wc3Primary() { return (await mapsService.wc3Info(configuredGamePaths())).primary; }
ipcMain.handle('maps:wc3Info', () => mapsService.wc3Info(configuredGamePaths()));
ipcMain.handle('maps:local', async (_e, files) => {
  const p = await wc3Primary();
  return { mapsDir: p?.mapsDir || null, files: await mapsService.localStatus(p?.mapsDir, files) };
});
ipcMain.handle('maps:download', async (e, m) => {
  const p = await wc3Primary();
  try {
    return await mapsService.download({ client: apiService.getClient(), id: m?.id, filename: m?.filename, sha256: m?.sha256, mapsDir: p?.mapsDir,
      onProgress: (pct) => { try { e.sender.send('maps:progress', { id: m?.id, pct }); } catch {} } });
  } catch (err) { throw apiError(err); }
});
ipcMain.handle('maps:downloadMany', async (e, maps) => {
  const p = await wc3Primary();
  try {
    return await mapsService.downloadMany({ client: apiService.getClient(), maps: (Array.isArray(maps) ? maps : []).slice(0, 50), mapsDir: p?.mapsDir,
      onProgress: (id, pct) => { try { e.sender.send('maps:progress', { id, pct }); } catch {} } });
  } catch (err) { throw apiError(err); }
});
ipcMain.handle('maps:openFolder', async () => {
  const p = await wc3Primary(); if (!p?.mapsDir) return false;
  await fs.promises.mkdir(p.mapsDir, { recursive: true }).catch(() => {});
  return shell.openPath(p.mapsDir);
});
ipcMain.handle('maps:pickFile', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { title: 'Map файл сонгох', filters: [{ name: 'Warcraft III map', extensions: ['w3x', 'w3m'] }], properties: ['openFile'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const st = await fs.promises.stat(r.filePaths[0]);
  _mapsPicked = r.filePaths[0];
  return { filename: path.basename(_mapsPicked), size: st.size };
});
ipcMain.handle('maps:upload', async (_e, meta = {}) => {
  if (!_mapsPicked) throw new Error('Эхлээд map файлаа сонгоно уу');
  const buf = await fs.promises.readFile(_mapsPicked);
  const q = new URLSearchParams({ filename: path.basename(_mapsPicked), name: String(meta.name || ''), version: String(meta.version || ''), category: String(meta.category || ''), description: String(meta.description || '') });
  try {
    const { data } = await apiService.getClient().post(`/maps/upload?${q}`, buf, { headers: { 'Content-Type': 'application/octet-stream' }, maxBodyLength: 40 * 1024 * 1024, timeout: 180000 });
    _mapsPicked = null;
    return data;
  } catch (err) { throw apiError(err); }
});

// ── IP-ээр холбогддог тоглоом (CS 1.6 / Quake III, 2026-09-30 Ш1) — mesh IP + listen сервер / +connect ──
const ipGames = require('./src/services/ipgames');
function findGame(gameType) { const s = migrateSettings(readSettings()); return (s.games || []).find((g) => g.name === gameType) || null; }
ipcMain.handle('ipgame:kind', (_e, gameType) => { const g = findGame(gameType); return g ? ipGames.kindOf(g) : null; });
async function myMeshIp() {
  try { const st = meshService.installed() ? await meshService.status() : meshService.last(); return st?.state === 'Running' && st.ip ? st.ip : null; } catch { return null; }
}
ipcMain.handle('ipgame:host', async (_e, { gameType, map, maxPlayers } = {}) => {
  const g = findGame(gameType); const kind = g && ipGames.kindOf(g);
  if (!kind) throw new Error('Энэ өрөөний тоглоом CS 1.6 / Quake III биш эсвэл тохируулагдаагүй');
  const ip = await myMeshIp();
  if (!ip) throw new Error('Mesh холбогдоогүй байна — Тохиргоо → Апп → «Дахин холбох»');
  const port = ipGames.KINDS[kind].port;
  await ipGames.launch(g, ipGames.hostArgs(kind, { map, maxPlayers, port }));
  return { kind, ip, port, map: map || ipGames.KINDS[kind].defaultMap };
});
ipcMain.handle('ipgame:join', async (_e, { gameType, ip, port } = {}) => {
  const g = findGame(gameType); const kind = g && ipGames.kindOf(g);
  if (!kind) throw new Error('Энэ тоглоомыг тохируулаагүй байна (Тохиргоо → Тоглоом)');
  if (!ipGames.isMeshIp(ip)) throw new Error('Буруу серверийн хаяг');
  if (!await myMeshIp()) throw new Error('Mesh холбогдоогүй байна — Тохиргоо → Апп → «Дахин холбох»');
  await ipGames.launch(g, ipGames.joinArgs(kind, { ip, port }));
  return true;
});
ipcMain.handle('ipgame:myIp', () => myMeshIp());
// Профайлын дэвсгэр (GOLD, 2026-09-30): renderer файлын байтыг өгнө → серверт raw илгээнэ
ipcMain.handle('profile:uploadBanner', async (_e, bytes) => {
  const buf = Buffer.from(bytes || []);
  if (!buf.length || buf.length > 5 * 1024 * 1024) throw new Error('Зураг 5MB-с ихгүй байх ёстой');
  try {
    const { data } = await apiService.getClient().post('/profile/banner', buf, { headers: { 'Content-Type': 'application/octet-stream' }, maxBodyLength: 6 * 1024 * 1024, timeout: 120000 });
    return data;
  } catch (err) { throw apiError(err); }
});

ipcMain.handle('settings:get', () => {
  const s = readSettings();
  return migrateSettings(s);
});

// Тоглоомын exe файл сонгох (нэр + зам буцаана, хадгалдаггүй)
ipcMain.handle('settings:selectGameExe', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Тоглоомын exe файл сонгох',
    filters: [{ name: 'Executable', extensions: ['exe'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const suggestedName = path.basename(filePath, path.extname(filePath));
  return { path: filePath, suggestedName };
});

// Тоглоом нэмэх
ipcMain.handle('settings:addGame', async (_, { name, path: exePath }) => {
  try {
    const s = migrateSettings(readSettings());
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    s.games.push({ id, name: String(name).trim(), path: String(exePath) });
    writeSettings({ games: s.games });
    return s.games;
  } catch (err) {
    console.error('[settings:addGame]', err);
    throw new Error('Тохируулга хадгалахад алдаа гарлаа: ' + err.message);
  }
});

// Тоглоом устгах
ipcMain.handle('settings:removeGame', async (_, id) => {
  const s = migrateSettings(readSettings());
  const games = s.games.filter(g => g.id !== id);
  writeSettings({ games });
  return games;
});

// Өрөөний шинэ цонх нээх
ipcMain.handle('room:openWindow', (event, roomData) => {
  // GX: үндсэн цонхны агуулгад шигтгэнэ — renderer iframe үүсгэнэ (өрөөний логик ижил index.html?mode=room)
  if (roomEmbedded() && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('room:embed', {
      mode: 'room', roomId: String(roomData.id), roomName: roomData.name, gameType: roomData.gameType,
      isHost: roomData.isHost ? '1' : '0', hostId: String(roomData.hostId || ''), status: roomData.status || '',
      maxPlayers: String(roomData.maxPlayers || roomData.max_players || ''), backgroundUrl: roomData.backgroundUrl || roomData.background_url || '',
      kind: roomData.kind || '', visibleCap: String(roomData.visibleCap || ''),
    });
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return { embedded: true };
  }
  if (roomWindow && !roomWindow.isDestroyed()) {
    roomWindow.focus();
    return;
  }
  roomWindow = new BrowserWindow({
    width: 920,
    height: 660,
    minWidth: 720,
    minHeight: 520,
    title: `${roomData.name} — Garena.mn`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, },
    autoHideMenuBar: true,
    backgroundColor: '#0d0d1a',
  });
  roomWindow.loadFile('src/renderer/index.html', {
    query: {
      mode:    'room',
      roomId:  String(roomData.id),
      roomName: roomData.name,
      gameType: roomData.gameType,
      isHost:  roomData.isHost ? '1' : '0',
      hostId:  String(roomData.hostId || ''),
      status:  roomData.status || '',
      maxPlayers: String(roomData.maxPlayers || roomData.max_players || ''),
      backgroundUrl: roomData.backgroundUrl || roomData.background_url || '',
      kind: roomData.kind || '', visibleCap: String(roomData.visibleCap || ''),
    },
  });
  hardenWindow(roomWindow);
  // Тоглолт явагдаж байхад санамсаргүй хаахаас сэргийлнэ — цонх хаагдвал
  // өрөөнөөс гарч (host бол өрөө устаж), relay зогсож холболт тасарна
  roomWindow.on('close', (e) => {
    if (!_gameProc) return;
    const choice = dialog.showMessageBoxSync(roomWindow, {
      type: 'warning',
      buttons: ['Хаах', 'Болих'],
      defaultId: 1,
      cancelId: 1,
      title: 'Тоглолт явагдаж байна',
      message: 'WC3 тоглолт ажиллаж байна!',
      detail: roomData.isHost
        ? 'Өрөөний цонхыг хаавал өрөө хаагдаж, бүх тоглогчийн холболт тасарна.'
        : 'Өрөөний цонхыг хаавал өрөөнөөс гарч, тоглоомын холболт тасарна.',
    });
    if (choice !== 0) e.preventDefault();
  });
  roomWindow.on('closed', () => {
    roomWindow = null;
    // Үндсэн цонхонд өрөөний жагсаалт шинэчлэх мэдэгдэл
    mainWindow?.webContents.send('room:window-closed');
  });
});

// ── DM тусдаа цонх нээх ────────────────────────────────────
ipcMain.handle('dm:openWindow', (event, { userId, username }) => {
  const uid = String(userId);
  // Аль хэдийн нээлттэй бол focus
  if (dmWindows.has(uid)) {
    const existing = dmWindows.get(uid);
    if (!existing.isDestroyed()) { existing.focus(); return; }
    dmWindows.delete(uid);
  }
  const dmWin = new BrowserWindow({
    width: 540, height: 600,
    minWidth: 470, minHeight: 460,
    title: `${username} — DM`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, },
    autoHideMenuBar: true,
    backgroundColor: '#0d0d1a',
  });
  dmWin.loadFile('src/renderer/index.html', {
    query: { mode: 'dm', dmUserId: uid, dmUsername: username },
  });
  hardenWindow(dmWin);
  dmWin.on('closed', () => {
    dmWindows.delete(uid);
    mainWindow?.webContents.send('dm:window-closed', { userId: uid });
  });
  dmWindows.set(uid, dmWin);
});

// ── 📡 Радар цонх (2.8.11): жижиг, ҮРГЭЛЖ ДЭЭР — тоглоомын дэлгэцийн буланд тавьж LIVE радар харна.
// Тоглоомын замд хүрэхгүй: тусдаа renderer, зөвхөн 5 с тутмын HTTP poll. Нэг л цонх (дахин нээвэл шинэ тоглолт руу шилжинэ).
let radarWindow = null;
ipcMain.handle('radar:openWindow', (_, data) => {
  const token = String((data && data.token) || '').replace(/[^0-9a-f]/gi, '').slice(0, 64);
  if (!token) return false;
  const title = `Радар — ${String((data && data.title) || 'LIVE').slice(0, 60)}`;
  if (radarWindow && !radarWindow.isDestroyed()) {
    radarWindow.setTitle(title);
    radarWindow.webContents.send('radar:switch', { token });
    radarWindow.focus();
    return true;
  }
  const area = screen.getPrimaryDisplay().workArea;
  radarWindow = new BrowserWindow({
    width: 400, height: 480, minWidth: 280, minHeight: 320,
    x: area.x + area.width - 410, y: area.y + 10,
    title, icon: path.join(__dirname, 'src/renderer/icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, },
    autoHideMenuBar: true, alwaysOnTop: true, backgroundColor: '#000000',
  });
  radarWindow.setAlwaysOnTop(true, 'screen-saver');
  radarWindow.loadFile('src/renderer/index.html', { query: { mode: 'radar', token } });
  hardenWindow(radarWindow);
  radarWindow.on('closed', () => { radarWindow = null; });
  return true;
});
ipcMain.handle('radar:onTop', (e, on) => { const w = BrowserWindow.fromWebContents(e.sender); if (w && !w.isDestroyed()) w.setAlwaysOnTop(!!on, 'screen-saver'); return !!on; });

// ── Найзуудын тусдаа цонх ─────────────────────────────────
// ── Найзууд цонх (1.8.5: үндсэн цонхтой ХАМТ нээгдэж, баруун хажууд нь наалддаг хоёр дахь үндсэн цонх) ──
// Профайл чип + чат/тохиргоо/гарах товчнууд энд байдаг тул дангаар нь хаагдахгүй (closable: false);
// үндсэн цонх хаагдах / гарах үед main.js хаана.
let friendsWindow = null;
const FRIENDS_W = 440;
function dockFriendsWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || !friendsWindow || friendsWindow.isDestroyed()) return;
  try {
    const b = mainWindow.getBounds();
    const area = screen.getDisplayMatching(b).workArea;
    let x = b.x + b.width;                              // баруун хажууд
    if (x + FRIENDS_W > area.x + area.width) x = Math.max(area.x, b.x - FRIENDS_W);   // багтахгүй бол зүүн талд
    friendsWindow.setBounds({ x, y: b.y, width: FRIENDS_W, height: b.height });
  } catch {}
}
function openFriendsWindow() {
  if (friendsWindow && !friendsWindow.isDestroyed()) { dockFriendsWindow(); return friendsWindow; }
  friendsWindow = new BrowserWindow({
    width: FRIENDS_W, height: 730,
    minWidth: 380, minHeight: 450,
    title: 'Найзууд — Garena.mn',
    icon: path.join(__dirname, 'src/renderer/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, },
    autoHideMenuBar: true,
    closable: false,
    backgroundColor: '#0d0d1a',
  });
  friendsWindow.loadFile('src/renderer/index.html', { query: { mode: 'friends' } });
  hardenWindow(friendsWindow);
  friendsWindow.on('closed', () => { friendsWindow = null; });
  friendsWindow.once('ready-to-show', dockFriendsWindow);
  dockFriendsWindow();
  return friendsWindow;
}
function closeFriendsWindow() {
  if (friendsWindow && !friendsWindow.isDestroyed()) { try { friendsWindow.destroy(); } catch {} }
  friendsWindow = null;
}
ipcMain.handle('friends:openWindow', () => { openFriendsWindow()?.focus(); });
ipcMain.handle('ui:mainShown', () => { openFriendsWindow(); mainWindow?.focus(); });
// Найзууд цонхны товчнууд → үндсэн цонх (таб солих, тохиргоо, гарах)
ipcMain.handle('ui:mainAction', (_, a) => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send('ui:action', a || {});
  if (a?.action !== 'logout') { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
  return true;
});
// Реклам: сервер /config → ad { image, link, text } (env AD_IMAGE_URL / AD_LINK_URL / AD_TEXT)
ipcMain.handle('config:ad', async () => {
  try {
    const { data } = await axios.get(`${SERVER_URL}/config`, { timeout: 8000 });
    return data?.ads?.length ? data.ads : (data?.ad ? [data.ad] : []);   // массив (эргэлдэх)
  } catch { return null; }   // null = сервер хүрэхгүй (renderer дахин оролдоно); [] = реклам алга
});

ipcMain.handle('dm:isWindowOpen', (_, userId) => {
  const uid = String(userId);
  return dmWindows.has(uid) && !dmWindows.get(uid).isDestroyed();
});

// ── Профайл зураг оруулах ──────────────────────────────────
ipcMain.handle('auth:uploadAvatar', async () => {
  const axios = require('axios');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Профайл зураг сонгох',
    filters: [{ name: 'Зураг', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;

  const filePath = result.filePaths[0];
  const stats = fs.statSync(filePath);
  if (stats.size > 2 * 1024 * 1024) throw new Error('Зургийн хэмжээ 2MB-аас их байж болохгүй');

  const fileData = fs.readFileSync(filePath);
  const ext  = path.extname(filePath).toLowerCase().replace('.', '');
  const mime = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
             : ext === 'png'  ? 'image/png'
             : ext === 'gif'  ? 'image/gif'
             : ext === 'webp' ? 'image/webp'
             : 'image/jpeg';
  const base64 = `data:${mime};base64,${fileData.toString('base64')}`;

  const token = authService.getToken();
  if (!token) throw new Error('Нэвтрэх хугацаа дууссан. Гарч дахин нэвтэрнэ үү.');
  try {
    const { data } = await axios.put(
      `${apiService.SERVER_URL}/auth/avatar`,
      { avatar_url: base64 },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (data.token) authService.saveToken(data.token);
    authService.updateUser({ avatar_url: base64 });
    return { avatar_url: base64 };
  } catch (err) { throw apiError(err); }
});

// ── Нийгмийн функцүүд (friends / block) ───────────────────
ipcMain.handle('social:friends',       async () => apiService.getFriends());
ipcMain.handle('social:pending',       async () => apiService.getPendingRequests());
ipcMain.handle('social:friendRequest', async (_, toUserId) => {
  try { return await apiService.sendFriendRequest(toUserId); } catch (err) { throw apiError(err); }
});
ipcMain.handle('social:friendAccept',  async (_, fromUserId) => {
  try { return await apiService.acceptFriendRequest(fromUserId); } catch (err) { throw apiError(err); }
});
ipcMain.handle('social:friendDecline', async (_, fromUserId) => {
  try { return await apiService.declineFriendRequest(fromUserId); } catch (err) { throw apiError(err); }
});
ipcMain.handle('social:friendRemove',  async (_, friendId) => {
  try { return await apiService.removeFriend(friendId); } catch (err) { throw apiError(err); }
});
ipcMain.handle('social:block',         async (_, targetUserId) => {
  try { return await apiService.blockUser(targetUserId); } catch (err) { throw apiError(err); }
});
ipcMain.handle('social:unblock',       async (_, targetUserId) => {
  try { return await apiService.unblockUser(targetUserId); } catch (err) { throw apiError(err); }
});
ipcMain.handle('social:blocked',       async () => apiService.getBlockedUsers());
ipcMain.handle('social:search',        async (_, query) => {
  try { return await apiService.searchUsers(query); } catch { return []; }
});

// DM түүх & уншаагүй тоо
ipcMain.handle('social:dmHistory', async (_, userId) => {
  try { return await apiService.getDMHistory(userId); } catch { return []; }
});
ipcMain.handle('social:dmHistory:before', async (_, userId, beforeId) => {
  try { return await apiService.getDMHistory(userId, beforeId); } catch { return []; }
});
ipcMain.handle('social:unread', async () => {
  try { return await apiService.getUnreadCount(); } catch { return {}; }
});
ipcMain.handle('social:markRead', async (_, fromUserId) => {
  try { return await apiService.markDMRead(fromUserId); } catch { return { ok: false }; }
});

// ── Discord Servers ────────────────────────────────────────
ipcMain.handle('discord:getServers', async () => {
  try { return await apiService.getDiscordServers(); } catch { return []; }
});
ipcMain.handle('discord:addServer', async (_, data) => {
  try { return await apiService.addDiscordServer(data); } catch (err) { throw apiError(err); }
});
ipcMain.handle('discord:editServer', async (_, id, data) => {
  try { return await apiService.editDiscordServer(id, data); } catch (err) { throw apiError(err); }
});
ipcMain.handle('discord:deleteServer', async (_, id) => {
  try { return await apiService.deleteDiscordServer(id); } catch (err) { throw apiError(err); }
});
ipcMain.handle('discord:openInvite', async (_, url) => {
  // Main process талд дахин шалгаж Discord URL-г нээнэ
  if (/^https?:\/\/(discord\.gg|discord\.com\/invite)\/[\w-]+$/.test(url)) {
    await shell.openExternal(url);
  }
});

// ── Streamers ──────────────────────────────────────────────
ipcMain.handle('streamers:getAll', async () => {
  try { return await apiService.getStreamers(); } catch { return []; }
});
ipcMain.handle('streamers:add', async (_, data) => {
  try { return await apiService.addStreamer(data); } catch (err) { throw apiError(err); }
});
ipcMain.handle('streamers:edit', async (_, id, data) => {
  try { return await apiService.editStreamer(id, data); } catch (err) { throw apiError(err); }
});
ipcMain.handle('streamers:delete', async (_, id) => {
  try { return await apiService.deleteStreamer(id); } catch (err) { throw apiError(err); }
});
// Ерөнхий https холбоос нээх (админ самбар, QPay төлбөрийн холбоос)
ipcMain.handle('app:openExternal', async (_, url) => {
  if (typeof url === 'string' && /^https:\/\/[^\s]+$/i.test(url)) { await shell.openExternal(url); return true; }
  return false;
});

ipcMain.handle('streamers:openUrl', async (_, url) => {
  if (/^https?:\/\/.+/i.test(url)) {
    await shell.openExternal(url);
  }
});

// ── Mesh (Tailscale ↔ Headscale) ──────────────────────────────────────────
let _meshLoginServer = null;
let _meshRetryTimer = null;   // сервер /config → mesh.login_server (null = mesh унтраалттай)
async function meshEnsure(force = false) {
  if (!authService.getToken()) return meshService.last();   // нэвтрээгүй бол хүлээнэ
  if (!_meshLoginServer) {
    try { const { data } = await axios.get(`${apiService.SERVER_URL}/config`, { timeout: 10000 }); _meshLoginServer = data?.mesh?.login_server || null; }
    catch {
      // 2026-10-01: Railway түр унахад /config авч чадахгүй → 30 мин хүлээлгүй 1 минутын дараа дахин оролдоно
      if (!_meshRetryTimer) _meshRetryTimer = setTimeout(() => { _meshRetryTimer = null; meshEnsure().catch(() => {}); }, 60 * 1000);
    }
  }
  const msiPath = app.isPackaged ? path.join(process.resourcesPath, 'tailscale-setup.msi') : path.join(__dirname, 'resources', 'tailscale-setup.msi');
  return meshService.ensure({
    loginServer: _meshLoginServer,
    msiPath,
    force,
    getAuthKey: () => apiService.request('post', '/mesh/authkey'),
    report: (rec) => apiService.request('post', '/mesh/report', rec),
    onStatus: (st) => broadcastToWindows('mesh:status', st),
  });
}
ipcMain.handle('mesh:status', async () => { try { if (meshService.installed()) await meshService.status(); } catch {} return meshService.last(); });
ipcMain.handle('mesh:ensure', async () => { try { return await meshEnsure(true); } catch (e) { return { ...meshService.last(), error: e.message }; } });

// Firewall + сүлжээ тохиргоо (тусдаа товчноос) — ZeroTier хасагдсан, зөвхөн галт хана
ipcMain.handle('firewall:setup', async () => {
  const s = migrateSettings(readSettings());
  const gamePaths = (s.games || []).map(g => g.path).filter(p => p);
  const result = firewallService.elevatedNetworkSetup(gamePaths, true);
  return result;
});

// Game Relay — Host: capture+forward, Player: search+rebroadcast
ipcMain.handle('relay:startHost', (_, playerIps) => {
  gameRelayService.startHost(playerIps);
  return true;
});
ipcMain.handle('relay:startFinder', (_, hostIp) => {
  gameRelayService.startFinder(hostIp);
  return true;
});
ipcMain.handle('relay:stop', () => {
  gameRelayService.stopAll();
  return true;
});
ipcMain.handle('relay:startBotBridge', (_, opts) => gameRelayService.startBotBridge(opts || {}));
ipcMain.handle('relay:stopBotBridge', () => { gameRelayService.stopBotBridge(); return true; });
ipcMain.handle('relay:updateBotBridge', (_, opts) => gameRelayService.updateBotBridge(opts || {}));

// ── Тоглогч-хост LAN (relay) ──
// Хост тал: локал WC3 GAMEINFO баригдмагц onGameInfo → renderer руу 'lan:gameinfo' event
ipcMain.handle('relay:startLanHost', async (_, opts) => {
  // Ш3: mesh (Tailscale) холбогдсон бол Tailscale IP дээр шууд joiner хүлээн авна (renderer announce-д direct-ийг илгээнэ)
  let meshIp = null;
  // 2026-10-01: сервер mesh-ийг унтраасан (login_server алга) бол bot1-ийн үеийнх шиг ЗӨВХӨН relay — mesh listener нээхгүй
  try { const st = meshService.installed() ? await meshService.status() : meshService.last(); if (_meshLoginServer && st.state === 'Running' && st.ip) meshIp = st.ip; } catch {}
  const r = gameRelayService.startLanHost({ ...(opts || {}), meshIp, onGameInfo: (b64) => broadcastToWindows('lan:gameinfo', { gameinfo_b64: b64 }), onGameStarted: () => broadcastToWindows('lan:started', {}) });
  return { ok: true, direct: r?.direct || null };
});
ipcMain.handle('relay:stopLanHost', () => { gameRelayService.stopLanHost(); return true; });
ipcMain.handle('relay:startLanJoin', (_, opts) => gameRelayService.startLanJoin(opts || {}));
ipcMain.handle('relay:updateLanJoin', (_, opts) => gameRelayService.updateLanJoin(opts || {}));
ipcMain.handle('relay:stopLanJoin', () => { gameRelayService.stopLanJoin(); return true; });

// WC3-ийн LAN нэр — registry HKCU\Software\Blizzard Entertainment\Warcraft III\String\userlocal.
// GHost++ зөвхөн autohost_owner-тэй ижил нэртэй тоглогчийн !start-ыг зөвшөөрдөг, дүн ч энэ нэрээр ирдэг тул
// платформын нэр биш WC3 нэрийг серверт мэдэгдэнэ. (PowerShell: кирилл нэрийг UTF-8-аар зөв уншина.)
let _wc3NameCache = { at: 0, name: null };
function readWc3LocalName() {
  if (process.platform !== 'win32') return null;
  if (Date.now() - _wc3NameCache.at < 15000) return _wc3NameCache.name;
  let name = null;
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "[Console]::OutputEncoding=[Text.Encoding]::UTF8; (Get-ItemProperty -Path 'HKCU:\\Software\\Blizzard Entertainment\\Warcraft III\\String' -ErrorAction SilentlyContinue).userlocal",
    ], { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    name = String(out || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 31) || null;
  } catch {}
  _wc3NameCache = { at: Date.now(), name };
  return name;
}
ipcMain.handle('wc3:name', () => readWc3LocalName());
// WC3 ботын lobby руу REQJOIN явуулахад бодит нэрийг бүх цонх руу (өрөөний цонх тусдаа)
gameRelayService.setBotJoinListener((name) => broadcastToWindows('bot:wc3-join', { name }));
// Relay сүлжээний чанар (RTT/loss) → renderer → сервер → өрөөнд тоглогч бүрийн ping
gameRelayService.setLatencyListener((d) => broadcastToWindows('net:latency', d));

ipcMain.handle('relay:addHostPlayer', (_, ip) => {
  gameRelayService.addHostPlayerIp(ip);
  return true;
});

// Тоглоом эхлүүлэх (gameType нэрээр тохирох exe хайна)
let _gameProc = null;

// WC3-ийн автомат replay хадгалалтыг АСААНА (HKCU ...\Warcraft III\autosaveReplay=1).
// Унтраалттай бол тоглолт дуусахад LastReplay.w3g хадгалагдахгүй → replay задлагдахгүй →
// K/D/A / XP / wins / 💎 олгогдохгүй. WC3 асахаасаа өмнө уншдаг тул launch-аас өмнө тавина.
function ensureAutosaveReplay() {
  try {
    spawn('reg', ['add', 'HKCU\\Software\\Blizzard Entertainment\\Warcraft III',
      '/v', 'autosaveReplay', '/t', 'REG_DWORD', '/d', '1', '/f'],
      { stdio: 'ignore', windowsHide: true });
  } catch {}
}

// ── MapHack анти-чит ────────────────────────────────────────────────
// Тоглолт эхлэхээс өмнө ажиллаж буй процессуудыг скан хийж, maphack хэрэгсэл
// (xenon, zodcraft, …) илэрвэл WC3-г НЭЭХГҮЙ, серверт мэдэгдэж сануулга авна.
// 3 сануулгын дараа сервер платформоос бандана. Жагсаалт серверээс шинэчлэгдэнэ.
const DEFAULT_MAPHACK = ['xenon', 'zodcraft'];
let _maphackList = DEFAULT_MAPHACK.slice();
async function refreshMaphackList() {
  try {
    const r = await apiService.request('get', '/anticheat/blocklist');
    if (Array.isArray(r?.processes) && r.processes.length) {
      _maphackList = r.processes.map((x) => String(x).toLowerCase()).filter(Boolean);
    }
  } catch { /* серверт холбогдоогүй — сүүлийн жагсаалт хэвээр */ }
}
// Main process-ыг ХЭЗЭЭ Ч блоклохгүй async exec. LAN proxy (gameRelay) яг энэ process дээр
// ажилладаг тул синхрон tasklist нь WC3-ийн пакетийг зогсоож "Waiting for players" гацалт
// үүсгэдэг байв (v2.7.7: tasklist /V нь WC3 ажиллаж байхад 20с+ үргэлжилдэг → 6с timeout
// бүрт main process царцаж, 25с тутам ~6с lag өгч байсныг relay capture-аас баталсан).
function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...opts },
        (err, stdout) => resolve(err ? null : String(stdout || '')));
    } catch { resolve(null); }
  });
}
// tasklist /V — процессын нэр + цонхны гарчгийг шалгана (нэр сольсныг ч барих гэж оролдоно).
// Удаан (20с+) тул async + давхар скан хамгаалалт — тоглоомын урсгалд огт нөлөөлөхгүй.
let _mhScanBusy = false;
async function scanForMaphack() {
  if (_mhScanBusy) return null;
  _mhScanBusy = true;
  try {
    const out = await execFileAsync('tasklist', ['/V', '/FO', 'CSV', '/NH'], { timeout: 45000 });
    if (out == null) return null;   // tasklist алдаа/timeout — блоклохгүй (false negative)
    const low = out.toLowerCase();
    for (const sig of _maphackList) {
      if (sig && low.includes(sig)) return sig;
    }
  } catch { /* блоклохгүй */ }
  finally { _mhScanBusy = false; }
  return null;
}
async function reportMaphack(tool) {
  try { return await apiService.request('post', '/anticheat/report', { tool }); }
  catch { return null; }
}
// WC3 ажиллаж байх хугацаанд үе үе скан (тоглолтын дундуур асаасныг барих)
let _maphackWatch = null;
let _maphackReported = null;
function startMaphackWatch() {
  if (_maphackWatch) return;
  _maphackReported = null;
  _maphackWatch = setInterval(async () => {
    if ((await isWar3Running()) !== true) { stopMaphackWatch(); return; }
    const tool = await scanForMaphack();   // async — LAN proxy-г блоклохгүй
    if (tool && tool !== _maphackReported) {
      _maphackReported = tool;
      const rep = await reportMaphack(tool);
      broadcastToWindows('game:maphack', { tool, warnings: rep?.warnings ?? null, banned: !!rep?.banned, max: rep?.max ?? 3, midgame: true });
    }
  }, 40000);
  if (_maphackWatch.unref) _maphackWatch.unref();
}
function stopMaphackWatch() {
  if (_maphackWatch) { clearInterval(_maphackWatch); _maphackWatch = null; }
  _maphackReported = null;
}

ipcMain.handle('game:launch', async (_, gameType) => {
  // MapHack скан — тоглолт эхлэхээс ӨМНӨ. Илэрвэл WC3 нээхгүй, сануулга авна.
  const mh = await scanForMaphack();
  if (mh) {
    const rep = await reportMaphack(mh);
    broadcastToWindows('game:maphack', { tool: mh, warnings: rep?.warnings ?? null, banned: !!rep?.banned, max: rep?.max ?? 3, midgame: false });
    return { blocked: true, tool: mh, banned: !!rep?.banned };
  }

  const s = migrateSettings(readSettings());
  const games = s.games;
  if (!games.length) throw new Error('Тоглоом тохируулагдаагүй байна (Тохируулга таб)');

  ensureAutosaveReplay();   // тоглолт бүрийн replay хадгалагдахыг баталгаажуулна

  const game = games.find(g => g.name === gameType) || games[0];
  if (!fs.existsSync(game.path)) {
    throw new Error(`"${game.name}" файл олдсонгүй: ${game.path}`);
  }
  // WC3 аль хэдийн ажиллаж байвал 2 дахь instance нээхгүй — эхнийх нь UDP 6112-ыг барьсан тул
  // 2 дахь цонхны LAN жагсаалт үүрд хоосон харагддаг. Байгаа WC3-ийг ашиглаж exit хяналтыг залгана.
  if ((await isWar3Running()) === true) { watchWar3Exit(); startMaphackWatch(); return true; }
  try { replayService.addReplayDir(path.join(path.dirname(game.path), 'replay')); } catch {}
  const proc = spawn(game.path, [], { detached: false, stdio: 'ignore' });
  _gameProc = proc;
  const launchedAt = Date.now();
  startMaphackWatch();   // тоглолтын дундуур maphack асаасныг барих

  // WC3 хаагдахад renderer-т мэдэгдэнэ (өрөөний цонх currentRoom-той тул бүх цонх руу).
  // "Frozen Throne.exe"/"Warcraft III.exe" нь launcher — war3.exe-г асаагаад өөрөө шууд гардаг тул
  // түргэн гарвал war3.exe ажиллаж байгаа эсэхийг tasklist-ээр хянаж, жинхэнэ хаагдахад л мэдэгдэнэ.
  proc.on('exit', () => {
    _gameProc = null;
    if (Date.now() - launchedAt > 20000 || process.platform !== 'win32') { broadcastToWindows('game:exited'); return; }
    watchWar3Exit();
  });

  return true;
});

let _war3Watch = null;
// true/false/null — null = tasklist алдаа/timeout ("мэдэгдэхгүй", exited гэж тооцохгүй).
// Async (v2.7.7) — 3с тутам дуудагддаг тул синхрон байхад LAN proxy-г ~150мс тутам зогсоож байв.
async function isWar3Running() {
  const out = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq war3.exe', '/NH'], { timeout: 5000 });
  if (out == null) return null;
  return /war3\.exe/i.test(out);
}
// WC3 UDP 6112-г эзэлсэн эсэх — ботын bridge 6112-т bind хийхээсээ ӨМНӨ WC3 эзэлсэн байх ёстой,
// эс бөгөөс WC3 өөрөө 6112-т bind хийж чадахгүй LAN алдаа гаргадаг (v1.8.8-ийн гаж нөлөө).
function isUdp6112InUse() {
  // ЗӨВХӨН war3.exe өөрөө 6112-ыг эзэлсэн үед true — өөр процесс эзэлсэн бол WC3 bind хийж
  // чадаагүй гэсэн үг (тэр процесс GAMEINFO-г булаадаг) тул "бэлэн" гэж тооцох нь буруу.
  try {
    const ns = execFileSync('netstat', ['-ano', '-p', 'UDP'], { encoding: 'utf8', timeout: 6000, windowsHide: true });
    const pids = new Set();
    for (const line of ns.split('\n')) {
      const m = line.match(/^\s*UDP\s+\S+:6112\s+\S+\s+(\d+)\s*$/i);
      if (m) pids.add(m[1]);
    }
    if (!pids.size) return false;
    const tl = execFileSync('tasklist', ['/FI', 'IMAGENAME eq war3.exe', '/NH', '/FO', 'CSV'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    return [...pids].some((pid) => new RegExp(`"war3\\.exe","${pid}"`).test(tl));
  } catch { return false; }
}
ipcMain.handle('wc3:lanReady', () => isUdp6112InUse());
ipcMain.handle('wc3:running', async () => (await isWar3Running()) === true);
function watchWar3Exit() {
  if (_war3Watch) return;
  const startedAt = Date.now();
  let seen = false;
  let misses = 0;   // дараалсан false тоолуур — tasklist нэг удаа гацахад худал exited гаргахгүй
  let busy = false;   // tasklist удаан бол давхар tick үүсгэхгүй
  _war3Watch = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const running = await isWar3Running();   // async — LAN proxy-г блоклохгүй
      if (running === true) { seen = true; misses = 0; return; }
      if (running === null) return;   // tasklist алдаа/timeout — exited гэж тооцохгүй, дараагийн шалгалтыг хүлээнэ
      // 15 сек дотор war3.exe огт гарч ирээгүй бол launcher өөрөө хаагдсан гэж үзнэ
      if (!seen && Date.now() - startedAt < 15000) return;
      misses += 1;
      if (misses < 2) return;   // 2 дараалсан false (~6с) = жинхэнэ exit
      clearInterval(_war3Watch); _war3Watch = null;
      broadcastToWindows('game:exited');
    } finally { busy = false; }
  }, 3000);
}

// WC3-г force kill хийх (host хаахад тоглогчдыг гаргах)
ipcMain.handle('game:kill', () => {
  if (_gameProc) {
    try { _gameProc.kill(); } catch {}
    _gameProc = null;
  }
  return true;
});
