const { app, BrowserWindow, ipcMain, shell, protocol, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const QRCode = require('qrcode');
const { autoUpdater } = require('electron-updater');

const axios = require('axios');
const authService = require('./src/services/auth');
const replayService = require('./src/services/replay');
const zerotierService = require('./src/services/zerotier');
const apiService = require('./src/services/api');
const gameRelayService = require('./src/services/gameRelay');

const SERVER_URL = process.env.SERVER_URL || 'https://garenamn-production.up.railway.app';

// ── Auto-updater тохиргоо ─────────────────────────────────
autoUpdater.autoDownload    = true;   // суллагдмагц дэвсгэрт татна
autoUpdater.autoInstallOnAppQuit = false; // гараар restart хийнэ

autoUpdater.on('update-available',  (info) => {
  mainWindow?.webContents.send('update:available', { version: info.version });
});
autoUpdater.on('download-progress', (p) => {
  mainWindow?.webContents.send('update:progress', Math.round(p.percent));
});
autoUpdater.on('update-downloaded', (info) => {
  mainWindow?.webContents.send('update:downloaded', { version: info.version });
});
autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater]', err.message);
  mainWindow?.webContents.send('update:error', err.message);
});

let mainWindow;
let roomWindow = null;
const dmWindows = new Map(); // userId -> BrowserWindow
let _ztSetupPromise = null;

// Event-ийг бүх цонх руу илгээх — өрөөний цонх тусдаа BrowserWindow тул
// зөвхөн mainWindow руу илгээвэл өрөөний logic (currentRoom) хүлээж авдаггүй
function broadcastToWindows(channel, data) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win.isDestroyed()) win.webContents.send(channel, data);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 800,
    minHeight: 600,
    title: 'Garena.mn',
    icon: path.join(__dirname, 'src/renderer/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    frame: true,
    autoHideMenuBar: true,
    backgroundColor: '#0c0b0f',
  });

  mainWindow.loadFile('src/renderer/index.html');
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

// ── ZeroTier автомат суулгалт & тохиргоо ─────────────────
async function initZeroTier() {
  try {
    // 1. Серверээс глобал network ID авах
    const { data } = await axios.get(`${SERVER_URL}/config`);
    const networkId = data?.zerotierNetworkId;
    if (!networkId) {
      console.warn('[ZT] Серверт глобал network тохируулаагүй байна');
      mainWindow?.webContents.send('zt:setup-complete', { ok: false, error: 'no-network-id' });
      return;
    }

    // 2. Апп эхлэхэд ZeroTier-г суулгах/асаах/join хийх/Firewall тохируулах.
    // Windows өөрөө UAC prompt харуулна; зөвшөөрвөл дараагийн launch-ууд promptгүй өнгөрнө.
    console.log('[ZT] Auto setup шалгаж байна... Network:', networkId);
    const result = await setupZerotierNetwork(networkId);
    console.log('[ZT] Auto setup result:', result);

    // 3. Settings-д хадгалах
    writeSettings({ zerotierNetworkId: networkId });

    // 4. Renderer-д мэдэгдэх
    mainWindow?.webContents.send('zt:setup-complete', result);
  } catch (e) {
    console.error('[ZT] Автомат тохиргоо алдаа:', e.message);
    mainWindow?.webContents.send('zt:setup-complete', { ok: false, error: e.message });
  }
}

app.whenReady().then(() => {
  createWindow();

  // Апп эхлэхдээ argv-д deep link байгаа эсэх шалгах (Windows)
  const deepLinkUrl = process.argv.find(a => a.startsWith('garenamn://'));
  if (deepLinkUrl) handleDeepLink(deepLinkUrl);

  // Апп бэлэн болсноос 5 секундийн дараа update шалгах
  if (app.isPackaged) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  }

  // Startup дээр зөвхөн existing ZeroTier-ийг шалгана. Privileged setup нь user action-аар хийгдэнэ.
  setTimeout(() => initZeroTier(), 3000);

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
  try {
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
  } catch {}
  gameRelayService.stopAll();
  replayService.stopWatcher();
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Discord callback deep link Windows дээр
app.on('second-instance', (event, argv) => {
  const url = argv.find((arg) => arg.startsWith('garenamn://'));
  if (url) handleDeepLink(url);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// macOS deep link
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

function handleDeepLink(url) {
  const parsed = new URL(url);
  if (parsed.hostname === 'auth') {
    const token = parsed.searchParams.get('token');
    if (token) {
      authService.saveToken(token);
      // Серверээс бүрэн мэдээлэл (avatar_url г.м.) авах
      fetchAndSaveUser().then(() => {
        mainWindow?.webContents.send('auth:success', authService.getUser());
      });
    }
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
    webPreferences: { nodeIntegration: false, contextIsolation: true },
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
ipcMain.handle('update:install', () => {
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
  if (!allowed.includes(String(method || '').toLowerCase()) || typeof urlPath !== 'string' || !urlPath.startsWith('/')) {
    throw new Error('Буруу хүсэлт');
  }
  try { return await apiService.request(method, urlPath, body); } catch (err) { throw apiError(err); }
});

ipcMain.handle('rooms:create', async (event, { name, max_players, game_type, password, description, game_mode, background_url }) => {
  let room;
  try {
    room = await apiService.createRoom({ name, max_players, game_type, password, description, game_mode, background_url });
  } catch (err) { throw apiError(err); }
  // ZeroTier — server-аас автоматаар үүссэн network ID ашиглана
  try {
    if (room?.zerotier_network_id) {
      await setupZerotierNetwork(room.zerotier_network_id);
    }
  } catch {}
  try { replayService.startWatcher(room.id); } catch {}
  return room;
});

ipcMain.handle('rooms:join', async (event, roomId, password) => {
  try {
    const result = await apiService.joinRoom(roomId, password);
    let ztJoined = false;
    if (result?.room?.zerotier_network_id) {
      try {
        const setup = await setupZerotierNetwork(result.room.zerotier_network_id);
        ztJoined = !!setup?.ok;
      } catch (e) {
        console.warn('[ZT] join failed:', e.message);
      }
    }
    result.ztJoined = ztJoined;
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
  const target = (roomWindow && !roomWindow.isDestroyed()) ? roomWindow : mainWindow;
  target?.webContents.send('game:result', data);
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

async function setupZerotierNetwork(networkId) {
  if (!networkId) return { ok: false, error: 'no-network-id' };
  if (_ztSetupPromise) return _ztSetupPromise;
  _ztSetupPromise = zerotierService
    .autoSetup(networkId, configuredGamePaths())
    .finally(() => { _ztSetupPromise = null; });
  return _ztSetupPromise;
}

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

// ZeroTier Network ID хадгалах
ipcMain.handle('settings:setZerotierNetwork', (_, networkId) => {
  writeSettings({ zerotierNetworkId: networkId || '' });
  return true;
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
      nodeIntegration: false,
    },
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
      ztNetId: roomData.zerotierNetworkId || '',
      maxPlayers: String(roomData.maxPlayers || roomData.max_players || ''),
      backgroundUrl: roomData.backgroundUrl || roomData.background_url || '',
    },
  });
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
    width: 480, height: 560,
    minWidth: 380, minHeight: 400,
    title: `${username} — DM`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    backgroundColor: '#0d0d1a',
  });
  dmWin.loadFile('src/renderer/index.html', {
    query: { mode: 'dm', dmUserId: uid, dmUsername: username },
  });
  dmWin.on('closed', () => {
    dmWindows.delete(uid);
    mainWindow?.webContents.send('dm:window-closed', { userId: uid });
  });
  dmWindows.set(uid, dmWin);
});

// ── Найзуудын тусдаа цонх ─────────────────────────────────
let friendsWindow = null;
ipcMain.handle('friends:openWindow', () => {
  if (friendsWindow && !friendsWindow.isDestroyed()) { friendsWindow.focus(); return; }
  friendsWindow = new BrowserWindow({
    width: 420, height: 600,
    minWidth: 360, minHeight: 450,
    title: 'Найзууд — Garena.mn',
    icon: path.join(__dirname, 'src/renderer/icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    autoHideMenuBar: true,
    backgroundColor: '#0d0d1a',
  });
  friendsWindow.loadFile('src/renderer/index.html', { query: { mode: 'friends' } });
  friendsWindow.on('closed', () => { friendsWindow = null; });
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
ipcMain.handle('streamers:openUrl', async (_, url) => {
  if (/^https?:\/\/.+/i.test(url)) {
    await shell.openExternal(url);
  }
});

// ZeroTier статус & IP
ipcMain.handle('zt:status', (_, networkId) => zerotierService.getStatus(networkId));
ipcMain.handle('zt:ip',     (_, networkId) => zerotierService.getMyIp(networkId));
ipcMain.handle('zt:nodeId', ()             => zerotierService.getNodeId());
ipcMain.handle('zt:refresh', async () => {
  // Settings-аас network ID авах, эсвэл серверээс
  const s = migrateSettings(readSettings());
  let networkId = s.zerotierNetworkId;
  if (!networkId) {
    try {
      const { data } = await axios.get(`${SERVER_URL}/config`);
      networkId = data?.zerotierNetworkId;
    } catch {}
  }
  if (!networkId) return { ok: false, error: 'no-network-id', installed: false, running: false, ip: null, nodeId: null };
  const result = await setupZerotierNetwork(networkId);
  const nodeId = zerotierService.getNodeId();
  return { ...result, nodeId, networkId };
});

ipcMain.handle('zt:download', async () => {
  await shell.openExternal('https://www.zerotier.com/download/');
  return true;
});

// Firewall + сүлжээ тохиргоо (тусдаа товчноос)
ipcMain.handle('firewall:setup', async () => {
  const s = migrateSettings(readSettings());
  const gamePaths = (s.games || []).map(g => g.path).filter(p => p);
  const result = zerotierService.elevatedNetworkSetup(gamePaths, true);
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
ipcMain.handle('relay:addHostPlayer', (_, ip) => {
  gameRelayService.addHostPlayerIp(ip);
  return true;
});

// Тоглоом эхлүүлэх (gameType нэрээр тохирох exe хайна)
let _gameProc = null;

ipcMain.handle('game:launch', (_, gameType) => {
  const s = migrateSettings(readSettings());
  const games = s.games;
  if (!games.length) throw new Error('Тоглоом тохируулагдаагүй байна (Тохируулга таб)');

  const game = games.find(g => g.name === gameType) || games[0];
  if (!fs.existsSync(game.path)) {
    throw new Error(`"${game.name}" файл олдсонгүй: ${game.path}`);
  }
  try { replayService.addReplayDir(path.join(path.dirname(game.path), 'replay')); } catch {}
  const proc = spawn(game.path, [], { detached: false, stdio: 'ignore' });
  _gameProc = proc;

  // WC3 хаагдахад renderer-т мэдэгдэнэ (өрөөний цонх currentRoom-той тул бүх цонх руу)
  proc.on('exit', () => {
    _gameProc = null;
    broadcastToWindows('game:exited');
  });

  return true;
});

// WC3-г force kill хийх (host хаахад тоглогчдыг гаргах)
ipcMain.handle('game:kill', () => {
  if (_gameProc) {
    try { _gameProc.kill(); } catch {}
    _gameProc = null;
  }
  return true;
});
