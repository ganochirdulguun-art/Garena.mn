require('dotenv').config();
// JWT_SECRET заавал хэрэгтэй: байхгүй бол нэвтрэлт бүр 500 болдог байсан. Түр санамсаргүй нууц үүсгэж
// ажиллуулна (restart бүрт бүх нэвтрэлт хүчингүй болно) — Railway-д JWT_SECRET тохируулахыг лог-оор сануулна.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = require('crypto').randomBytes(48).toString('hex');
  console.warn('[Auth] ⚠ JWT_SECRET тохируулаагүй — түр санамсаргүй нууц үүсгэв. Railway → Variables → JWT_SECRET (урт санамсаргүй мөр) тохируулна уу!');
}
const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const authRoutes          = require('./routes/auth');
const roomRoutes          = require('./routes/rooms');
const statsRoutes         = require('./routes/stats');
const socialRoutes        = require('./routes/social');
const discordServerRoutes = require('./routes/discord_servers');
const streamerRoutes      = require('./routes/streamers');
const adminRoutes         = require('./routes/admin');
const warkeyRoutes        = require('./routes/warkey');
const membershipRoutes    = require('./routes/membership');
const botRoutes           = require('./routes/bot');
const lanHostRoutes       = require('./routes/lanhost');
const tierSync            = require('./services/tierSync');   // TierSystem → tier/rating автомат sync (D3)
const { setIO } = roomRoutes;
const { runMigrations } = require('./db/migrate');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
});

const PORT = process.env.PORT || 3000;

// Railway/reverse proxy-ийн ард ажилладаг тул жинхэнэ client IP-г
// X-Forwarded-For-оос авна — үгүй бол rate limiter бүх хэрэглэгчийг
// proxy-ийн ганц IP гэж үзээд нийтэд нь хязгаарлана
app.set('trust proxy', 1);

// Middleware
app.use(cors({ origin: process.env.CLIENT_URL || '*' }));
// rawBody — QPay webhook-ийн HMAC гарын үсэг шалгахад хэрэгтэй
app.use(express.json({ limit: '5mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Rate limiting — auth endpoint brute force хамгаалалт
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 20,                   // 15 минутад 20 оролдлого
  message: { error: 'Хэт олон оролдлого. 15 минутын дараа дахин оролдоно уу.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter); // base64 зураг байршуулахад хэрэг
// Нууц үг сэргээх имэйл — spam/өртөг хамгаалалт (15 минутад 10)
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Хэт олон оролдлого. 15 минутын дараа дахин оролдоно уу.' },
  standardHeaders: true, legacyHeaders: false,
});
app.use('/auth/forgot-password', forgotLimiter);
app.use('/auth/reset-password', forgotLimiter);
// Глобал аюулгүйн тор: нэг IP-ээс 5 минутад 3000 хүсэлт (интернэт кафе: ~20 клиент × polling багтана).
// Статик файл, ботын bridge (/bot, x-bot-key) болон QPay webhook үүнд орохгүй.
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 3000,
  message: { error: 'Хэт олон хүсэлт — түр хүлээгээд дахин оролдоно уу.' },
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path.startsWith('/bot/') || req.path === '/qpay/webhook' || req.path.startsWith('/assets/') || req.method === 'OPTIONS',
});
app.use(apiLimiter);

// REST Routes
app.use('/auth', authRoutes);
app.use('/rooms', botRoutes.roomRouter);   // бот хост (/rooms/:id/bot-host) — roomRoutes-оос ӨМНӨ
app.use('/rooms', lanHostRoutes.router);   // тоглогч-хост LAN (/rooms/:id/lan-host) — roomRoutes-оос ӨМНӨ
app.use('/rooms', roomRoutes);
app.use('/stats', statsRoutes);
app.use('/social', socialRoutes);
app.use('/discord-servers', discordServerRoutes);
app.use('/streamers', streamerRoutes);
app.use('/admin/api/bot', botRoutes.adminRouter);     // админ: бот хостын хяналт (C2) + мэдэгдлийн лог (B4)
app.use('/admin/api', membershipRoutes.adminRouter); // админ: 💎 олгох, гишүүнчлэл өгөх, дэвтэр (adminRoutes-оос ӨМНӨ)
app.use('/admin', adminRoutes);
app.use('/warkey', warkeyRoutes);
app.use('/membership', membershipRoutes.router);   // гишүүнчлэл, нэрийн эффект
app.use('/diamonds', membershipRoutes.diamondsRouter); // Diamond 💎 / XP / шилжүүлэг / худалдан авалт
app.post('/qpay/webhook', membershipRoutes.qpayWebhook); // QPay dashboard → payment.paid
app.use('/bot', botRoutes.botRouter);           // hostbot/bridge.js (x-bot-key)

// Танилцуулга landing page (WarKey + Platform, татах товч, админ самбар руу орох).
app.get('/', (req, res) => {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    Pragma: 'no-cache',
    Expires: '0',
    'Surrogate-Control': 'no-store',
  });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check (өмнө нь / байсан) — deploy/monitoring-д хэрэглэнэ.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Garena.mn Server ажиллаж байна' });
});

// ZeroTier БҮРЭН ХАСАГДСАН (2026-08-30): бот-хост public-IP GProxy тунел +
// сервер API-гаар GAMEINFO дамжуулдаг тул виртуал LAN шаардлагагүй.

// Глобал тохиргоо (auth шаардахгүй)
app.get('/config', async (req, res) => {
  // Клиентийн толгойн реклам: олон реклам эргэлдэнэ (клиент ~8с тутам солино). env AD_IMAGE_URL/
  // AD_LINK_URL/AD_TEXT-ээр дарж болно; тохируулаагүй бол GarenaSystem-ийн анхдагч рекламууд.
  const adBase = `https://${req.get('host')}`;
  const gsLink = process.env.AD_LINK_URL || 'https://tiersystem-production.up.railway.app';
  const ads = (process.env.AD_IMAGE_URL || process.env.AD_TEXT)
    ? [{ image: process.env.AD_IMAGE_URL || null, link: process.env.AD_LINK_URL || null, text: process.env.AD_TEXT || null }]
    : [
        { image: `${adBase}/assets/gs-ad-1.png`, link: gsLink, text: 'GarenaSystem — Хиймэл оюунд суурилсан Discord серверийн менежментийн цогц систем' },
        { image: `${adBase}/assets/gmn-ad-warkey.png`, link: adBase, text: 'Garena.mn WarKey — WC3 товчлуур тохируулагч · Hotkey remapper · үнэгүй' },
        { image: `${adBase}/assets/gmn-ad-diamond.png`, link: adBase, text: 'Diamond · QPay — цэнэглээд Silver/Gold эрх, нэр эффект, фрэйм' },
      ];
  // Нэмэлт (жинхэнэ) рекламууд: env AD_EXTRA_JSON = [{image,link,text}, ...] JSON массив.
  // Зар сурталчлагч өөрийн баннер (1120×144) + линкийг өгсөн үед энд нэмнэ — код өөрчлөхгүй.
  try {
    const extra = JSON.parse(process.env.AD_EXTRA_JSON || '[]');
    if (Array.isArray(extra)) {
      for (const a of extra) {
        if (a && (a.image || a.text)) ads.push({ image: a.image || null, link: a.link || null, text: a.text || null });
      }
    }
  } catch {}
  // zerotierNetworkId: null — хуучин (≤v2.4.0) клиентүүд энэ талбарыг уншдаг тул хэлбэрийг хадгална
  res.json({ zerotierNetworkId: null, zerotierMode: 'off', serverVersion: require('../package.json').version, ad: ads[0], ads });
});

let dbForMigration;
try { dbForMigration = require('./config/db'); } catch {}
const shouldRunDbMigrations =
  process.env.SKIP_DB_MIGRATIONS !== 'true'
  && (process.env.NODE_ENV !== 'test' || process.env.RUN_DB_MIGRATIONS_IN_TESTS === 'true');

async function runStartupMigrations() {
  if (!dbForMigration || !shouldRunDbMigrations) return;
  try {
    await runMigrations(dbForMigration);
    console.log('[Migration] Database schema is up to date');
  } catch (e) {
    console.error('[Migration]', e.message);
  }
}

// Rooms router-т io дамжуулах (kick/close event илгээхэд хэрэг)
setIO(io);
// REST-ээр өрөө устгагдахад socket талын in-memory төлөвийг цэвэрлэх
roomRoutes.setRoomCleanup((roomId) => cleanupRoomState(roomId));
// Social router-т io дамжуулах (friend request мэдэгдэлд хэрэг)
socialRoutes.setIO(io);
// Бот хостын event-үүд (room:bot_*)
botRoutes.setIO(io);
lanHostRoutes.setIO(io);
tierSync.start();
// Diamond 💎 шилжүүлэг / олголтын мэдэгдэл (diamonds:received, membership:updated)
membershipRoutes.setIO(io);
// Admin router-т лоббийн онлайн жагсаалт авагч дамжуулах (onlineUsersList hoisted)
adminRoutes.setPresence(onlineUsersList);

// XSS хамгаалалт: escape-ыг client render үед хийдэг (escHtml) —
// энд давхар escape хийвэл хэрэглэгчид "&lt;" гэх мэт зүйл харагдана

// ── Socket rate limiting ──────────────────────────────────
function checkRateLimit(socket) {
  const now = Date.now();
  // 30 секундийн хоригтой эсэх
  if (socket.data.rateLimitUntil && now < socket.data.rateLimitUntil) {
    return true;
  }
  // 500ms cooldown
  if (socket.data.lastMessageTime && now - socket.data.lastMessageTime < 500) {
    return true;
  }
  // 1 минутад 30 мессеж хязгаар
  if (!socket.data.messageWindowStart || now - socket.data.messageWindowStart > 60000) {
    socket.data.messageCount = 0;
    socket.data.messageWindowStart = now;
  }
  socket.data.messageCount = (socket.data.messageCount || 0) + 1;
  if (socket.data.messageCount > 30) {
    socket.data.rateLimitUntil = now + 30000;
    socket.data.messageCount = 0;
    console.log(`[RateLimit] ${socket.user?.username || socket.id} хаагдлаа (30 секунд)`);
    return true;
  }
  socket.data.lastMessageTime = now;
  return false;
}

// Тухайн өрөөнд in_game статустай идэвхтэй socket байгаа эсэх
function roomHasInGamePlayer(roomId) {
  return [...onlineUsers.entries()].some(([socketId, user]) => {
    if (user?.status !== 'in_game') return false;
    const sock = io.sockets.sockets.get(socketId);
    return sock && String(sock.data.roomId) === String(roomId);
  });
}

// Өрөөний in-memory төлөвийг бүрэн цэвэрлэх (устгагдсан өрөөнд)
function cleanupRoomState(roomId) {
  const id = String(roomId);
  delete roomMessages[id];
  delete roomReady[id];
  delete roomMembers[id];
  try { lanHostRoutes.clearRoom(id); } catch {}   // өрөө устахад LAN тоглоомуудыг цэвэрлэнэ
}

async function setRoomWaitingIfNoPlayersInGame(roomId) {
  if (!roomId) return false;
  if (roomHasInGamePlayer(roomId)) return false;

  if (dbForMigration) {
    try {
      await dbForMigration.query(
        "UPDATE rooms SET status='waiting' WHERE id=$1 AND status='playing'",
        [roomId]
      );
    } catch (e) {
      console.error('[RoomStatusFallback]', e.message);
    }
  }

  const memRoom = roomRoutes.memRooms.get(String(roomId));
  if (memRoom && memRoom.status === 'playing') memRoom.status = 'waiting';

  io.emit('rooms:updated');
  return true;
}

// ── Socket.io — Чат & өрөөний event ─────────────────────
// roomId → Map<username, userId>
const roomMembers = {};
// Helper: Map-аас [{id, name, ready}] массив үүсгэх
function membersArray(roomId) {
  if (!roomMembers[roomId]) return [];
  const readySet = roomReady[roomId] || new Set();
  return [...roomMembers[roomId].entries()].map(([name, id]) => ({ id, name, ready: readySet.has(id) }));
}
// socketId → { username, userId, status } (лобби дахь онлайн тоглогчид)
const onlineUsers = new Map();
// Нэг хэрэглэгч олон цонхноос (main, өрөө, DM, найзууд) тус тусдаа socket-оор
// холбогддог тул userId-гаар нэгтгэж, хамгийн идэвхтэй статусыг нь харуулна —
// үгүй бол лоббид нэг хүн 2-3 удаа давхардаж харагдана
const STATUS_PRIORITY = { in_game: 3, in_room: 2, online: 1 };
function onlineUsersList() {
  const byUser = new Map();
  for (const user of onlineUsers.values()) {
    const prev = byUser.get(user.userId);
    if (!prev || (STATUS_PRIORITY[user.status] || 0) > (STATUS_PRIORITY[prev.status] || 0)) {
      byUser.set(user.userId, user);
    }
  }
  return [...byUser.values()];
}
// String(userId) → socketId (private мессеж илгээхэд хэрэг)
const userSockets = new Map();
// Лобби чатын түүх (сүүлийн 100)
const lobbyHistory = [];
const LOBBY_HISTORY_MAX = 100;
// Өрөөний чатын түүх (roomId → [{username, text, time}, ...])
const roomMessages = {};
// Rejoin grace period: userId → { timer, roomId, username }
const disconnectTimers = {};
const REJOIN_GRACE_MS = 45000; // 45 секунд
// Тоглогчдын бэлэн төлөв (roomId → Set<userId>)
const roomReady = {};

// ── Socket.io JWT middleware ──────────────────────────────
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Authentication required'));
  try {
    socket.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

async function ensureRoomMembership(socket, roomId) {
  if (!roomId || !socket.user?.id) return false;

  const allowed = await roomRoutes.isUserInRoom(socket.user.id, roomId);
  if (!allowed) {
    socket.emit('room:error', { roomId: String(roomId), error: 'Room access denied' });
    return false;
  }

  return true;
}

async function ensureSocketRoomState(socket, roomId) {
  if (!roomId || !socket.user?.id) return false;
  const roomKey = String(roomId);
  const activeRoomId = socket.data.roomId ? String(socket.data.roomId) : '';
  if (activeRoomId === roomKey) return true;
  if (activeRoomId) return false;
  if (!await ensureRoomMembership(socket, roomKey)) return false;

  const username = socket.user.username;
  const userId   = String(socket.user.id);

  socket.join(roomKey);
  socket.data.roomId   = roomKey;
  socket.data.username = username;

  if (!roomMembers[roomKey]) roomMembers[roomKey] = new Map();
  if (!roomMembers[roomKey].has(username)) {
    roomMembers[roomKey].set(username, userId);
    io.to(roomKey).emit('room:members', membersArray(roomKey));
  }

  return true;
}

io.on('connection', (socket) => {
  console.log(`[Socket] холбогдлоо: ${socket.id} (${socket.user?.username})`);

  // Лоббид бүртгүүлэх (апп нээгдэхэд дуудагдана)
  // JWT-ийн мэдээллийг ашиглана — client-ийн утгыг хэрэглэхгүй
  socket.on('lobby:register', () => {
    const username = socket.user.username;
    const userId   = String(socket.user.id);
    socket.data.username = username;
    socket.data.userId   = userId;
    onlineUsers.set(socket.id, { username, userId, status: 'online' });
    if (userId) {
      userSockets.set(userId, socket.id);
      socket.join(`user:${userId}`);
    }
    io.emit('lobby:online_users', onlineUsersList());
    // Лобби чатын сүүлийн 50 мессеж илгээх
    socket.emit('lobby:history', lobbyHistory.slice(-50));
    console.log(`[Socket] ${username} онлайн (нийт: ${onlineUsers.size})`);
  });

  // Нийтийн лобби чат (бүх хэрэглэгчид харна)
  socket.on('lobby:chat', ({ text }) => {
    if (!text?.trim()) return;
    if (checkRateLimit(socket)) return;
    const msg = {
      userId: socket.user.id,
      username: socket.user.username,
      text: text.trim().slice(0, 500),
      time: new Date().toISOString(),
    };
    // Түүхэнд хадгалах
    lobbyHistory.push(msg);
    if (lobbyHistory.length > LOBBY_HISTORY_MAX) lobbyHistory.shift();
    io.emit('lobby:chat', msg);
  });

  // Хувийн мессеж (private message)
  socket.on('private:message', async ({ toUserId, text }) => {
    if (!text?.trim()) return;
    if (checkRateLimit(socket)) return;
    const userId   = String(socket.user.id);
    const username = socket.user.username;
    // Хүлээн авагч илгээгчийг хаасан эсэх шалгах
    if (await socialRoutes.isUserBlocked(String(toUserId), userId)) return;
    const safeText = text.trim().slice(0, 1000);
    // DB-д хадгалах
    const saved = await socialRoutes.saveMessage(socket.user.id, toUserId, safeText);
    const msg = {
      fromUsername: username,
      fromUserId:   userId,
      text:         safeText,
      time:         saved?.created_at?.toISOString() || new Date().toISOString(),
      id:           saved?.id || null,
    };
    // user:<id> room-оор бүх цонх руу илгээнэ (main, DM, өрөөний цонх өөр socket-той)
    io.to(`user:${String(toUserId)}`).emit('private:message', msg);
    // Илгээгчид баталгаа буцаах
    socket.emit('private:sent', { ...msg, toUserId: String(toUserId) });
  });

  // Өрөөнд нэгдэх
  socket.on('room:join', async ({ roomId }) => {
    const username = socket.user.username;
    const userId   = String(socket.user.id);
    if (!await ensureRoomMembership(socket, roomId)) return;

    // ── Хуучин өрөөнөөс бүрэн гарах (room isolation) ──
    const prevRoom = socket.data.roomId;
    if (prevRoom && String(prevRoom) !== String(roomId)) {
      socket.leave(prevRoom);
      if (roomMembers[prevRoom]) {
        roomMembers[prevRoom].delete(username);
        io.to(prevRoom).emit('room:user_left', { username });
        io.to(prevRoom).emit('room:members', membersArray(prevRoom));
      }
      if (roomReady[prevRoom]) roomReady[prevRoom].delete(userId);
    }

    socket.join(roomId);
    socket.data.roomId   = roomId;
    socket.data.username = username;

    if (!roomMembers[roomId]) roomMembers[roomId] = new Map();

    // Хэрэв өөр өрөөний grace period байвал цуцлаад тэр өрөөнөөс гарна
    if (disconnectTimers[userId] && disconnectTimers[userId].roomId !== String(roomId)) {
      const prev = disconnectTimers[userId];
      clearTimeout(prev.timer);
      delete disconnectTimers[userId];
      if (roomMembers[prev.roomId]) {
        roomMembers[prev.roomId].delete(prev.username);
        io.to(prev.roomId).emit('room:user_left', { username: prev.username });
        io.to(prev.roomId).emit('room:members', membersArray(prev.roomId));
      }
    }

    // Rejoin шалгах: grace period дотор буцаж ирсэн эсэх
    const isRejoin = !!(disconnectTimers[userId]?.roomId === String(roomId) && roomMembers[roomId].has(username));
    if (isRejoin) {
      clearTimeout(disconnectTimers[userId].timer);
      delete disconnectTimers[userId];
      socket.to(roomId).emit('room:user_rejoined', { username });
      console.log(`[Rejoin] ${username} дахин нэгдлээ → өрөө ${roomId}`);
    } else {
      roomMembers[roomId].set(username, userId);
      socket.to(roomId).emit('room:user_joined', { username });
      console.log(`[Socket] ${username} → өрөө ${roomId}`);
    }

    // Онлайн статус шинэчлэх
    if (onlineUsers.has(socket.id)) {
      onlineUsers.set(socket.id, { username, userId, status: 'in_room' });
      io.emit('lobby:online_users', onlineUsersList());
    }

    io.to(roomId).emit('room:members', membersArray(roomId));
    // Өрөөний чатын түүх илгээх (хожуу нэгдсэн тоглогчид)
    socket.emit('room:history', roomMessages[roomId] || []);
  });

  // Өрөөний урилга
  socket.on('room:invite', ({ toUserId, roomId, roomName }) => {
    if (checkRateLimit(socket)) return;   // урилгын spam
    io.to(`user:${String(toUserId)}`).emit('room:invited', {
      fromUsername: socket.user.username,
      fromUserId:   String(socket.user.id),
      roomId,
      roomName,
    });
  });

  // Өрөөний чат мессеж
  socket.on('chat:message', async ({ roomId, text }) => {
    if (!text?.trim() || !roomId) return;
    if (checkRateLimit(socket)) return;
    if (!await ensureSocketRoomState(socket, roomId)) return;
    if (!await ensureRoomMembership(socket, roomId)) return;
    const msg = {
      userId: socket.user.id,
      username: socket.user.username,
      text: text.trim().slice(0, 500),
      time: new Date().toISOString(),
    };
    // Өрөөний чат түүхэнд хадгалах (max 100)
    if (!roomMessages[roomId]) roomMessages[roomId] = [];
    roomMessages[roomId].push(msg);
    if (roomMessages[roomId].length > 100) roomMessages[roomId].shift();
    io.to(String(roomId)).emit('chat:message', msg);
  });

  // Өрөөний чат мессеж устгах (зөвхөн өөрийн)
  socket.on('chat:delete', async ({ roomId, time }, ack) => {
    const reply = (payload) => {
      if (typeof ack === 'function') ack(payload);
    };
    if (!roomId || !time) { reply({ ok: false, error: 'missing-data' }); return; }
    const roomKey = String(roomId);
    if (!await ensureSocketRoomState(socket, roomKey)) {
      reply({ ok: false, error: 'room-not-joined' });
      return;
    }

    const userId = String(socket.user.id);
    const messages = roomMessages[roomKey] || [];
    const idx = messages.findIndex(m => m.time === time && String(m.userId) === userId);
    if (idx === -1) {
      reply({ ok: false, error: 'message-not-found' });
      return;
    }

    messages[idx].text = '[Устгагдсан мессеж]';
    io.to(roomKey).emit('chat:deleted', { time });
    reply({ ok: true });
  });

  // Лобби чат мессеж устгах (зөвхөн өөрийн)
  socket.on('lobby:delete', ({ time }, ack) => {
    const reply = (payload) => {
      if (typeof ack === 'function') ack(payload);
    };
    if (!time) { reply({ ok: false, error: 'missing-data' }); return; }
    const userId = String(socket.user.id);
    const idx = lobbyHistory.findIndex(m => m.time === time && String(m.userId) === userId);
    if (idx === -1) {
      reply({ ok: false, error: 'message-not-found' });
      return;
    }

    lobbyHistory[idx].text = '[Устгагдсан мессеж]';
    io.emit('lobby:deleted', { time });
    reply({ ok: true });
  });

  // Host-ын IP хаягийг өрөөний тоглогчдод дамжуулах
  socket.on('room:host_ip', async ({ roomId, ip }) => {
    if (!ip || !roomId) return;
    // Socket тухайн өрөөнд байгаа эсэх шалгах (room isolation)
    if (String(socket.data.roomId) !== String(roomId)) return;
    // Зөвхөн тухайн өрөөнд байгаа тоглогчдод broadcast
    if (!await ensureRoomMembership(socket, roomId)) return;
    socket.to(String(roomId)).emit('room:host_ip', {
      ip,
      hostUsername: socket.user.username,
      hostUserId: String(socket.user.id),
    });
  });

  // (zt:authorize, room:zt_ip хэсгүүд хасагдсан — ZeroTier 2026-08-30-нд бүрэн хасагдав.
  //  Хуучин клиентийн эдгээр event-үүд хариугүй үлдэнэ — гэмтэл учруулахгүй.)

  // Тоглогчийн бэлэн/бэлэн биш төлөв
  socket.on('room:ready', async ({ roomId, ready }) => {
    if (!roomId || String(socket.data.roomId) !== String(roomId)) return;
    if (!await ensureRoomMembership(socket, roomId)) return;
    const userId = String(socket.user.id);
    if (!roomReady[roomId]) roomReady[roomId] = new Set();
    if (ready) roomReady[roomId].add(userId);
    else roomReady[roomId].delete(userId);
    io.to(String(roomId)).emit('room:members', membersArray(roomId));
  });

  // Тоглолт эхлэхэд статус 'in_game' болгох
  socket.on('room:game_started', () => {
    const username = socket.user.username;
    const userId   = String(socket.user.id);
    if (onlineUsers.has(socket.id)) {
      onlineUsers.set(socket.id, { username, userId, status: 'in_game' });
      io.emit('lobby:online_users', onlineUsersList());
    }
  });

  // Host WC3 хаагдсан — бүх тоглогчдод мэдэгдэх, room status → waiting
  socket.on('room:host_game_ended', async ({ roomId }) => {
    if (!roomId) return;
    const userId = String(socket.user.id);
    // Host эсэхийг шалгах
    if (dbForMigration) {
      try {
        const rr = await dbForMigration.query(
          'SELECT host_id FROM rooms WHERE id=$1', [roomId]
        );
        if (!rr.rows[0] || String(rr.rows[0].host_id) !== userId) return;
        // Room status → waiting (дахин эхлүүлэх боломжтой)
        await dbForMigration.query(
          "UPDATE rooms SET status='waiting' WHERE id=$1", [roomId]
        );
      } catch (e) { console.error('[HostGameEnded] DB:', e.message); }
    }
    // In-memory fallback мөн шинэчлэх
    const memRoom = roomRoutes.memRooms.get(String(roomId));
    if (memRoom) memRoom.status = 'waiting';
    // Бүх тоглогчдод broadcast
    socket.to(String(roomId)).emit('room:host_game_ended');
    io.emit('rooms:updated');
    // Онлайн статус шинэчлэх
    const username = socket.user.username;
    if (onlineUsers.has(socket.id)) {
      onlineUsers.set(socket.id, { username, userId, status: 'in_room' });
      io.emit('lobby:online_users', onlineUsersList());
    }
    console.log(`[HostGameEnded] ${username} → room ${roomId} waiting`);
  });

  // Тоглогч (host биш) тоглоом хаагдсан → online статус in_room болгох
  socket.on('room:game_ended_player', async ({ roomId } = {}) => {
    const username = socket.user.username;
    const userId   = String(socket.user.id);
    if (onlineUsers.has(socket.id)) {
      onlineUsers.set(socket.id, { username, userId, status: 'in_room' });
      io.emit('lobby:online_users', onlineUsersList());
    }
    await setRoomWaitingIfNoPlayersInGame(roomId || socket.data.roomId);
  });

  // Typing indicator (DM)
  socket.on('typing:start', ({ toUserId }) => {
    io.to(`user:${String(toUserId)}`).emit('typing:start', { fromUserId: String(socket.user.id), fromUsername: socket.user.username });
  });

  socket.on('typing:stop', ({ toUserId }) => {
    io.to(`user:${String(toUserId)}`).emit('typing:stop', { fromUserId: String(socket.user.id) });
  });

  // Өрөөнөөс гарах
  socket.on('room:leave', ({ roomId }) => {
    const username = socket.user.username;
    const userId   = String(socket.user.id);
    // Grace period байвал цуцлах (санаатай гарч байна)
    if (disconnectTimers[userId]) {
      clearTimeout(disconnectTimers[userId].timer);
      delete disconnectTimers[userId];
    }
    socket.leave(roomId);
    socket.data.roomId = null;
    if (roomMembers[roomId]) {
      roomMembers[roomId].delete(username);
      io.to(roomId).emit('room:user_left', { username });
      io.to(roomId).emit('room:members', membersArray(roomId));
    }
    // Гарсан тоглогчийн ready state устгах
    if (roomReady[roomId]) roomReady[roomId].delete(userId);
    // Гарсан тоглогчийн LAN тоглоомуудыг өрөөнөөс устгах (room:lan_lobby_gone)
    try { lanHostRoutes.removeUserGames(roomId, userId); } catch {}
    // Онлайн статус шинэчлэх
    if (onlineUsers.has(socket.id)) {
      onlineUsers.set(socket.id, { username, userId, status: 'online' });
      io.emit('lobby:online_users', onlineUsersList());
    }
    setRoomWaitingIfNoPlayersInGame(roomId);
  });

  // Унтрах үед
  socket.on('disconnect', () => {
    const { roomId } = socket.data;
    const username = socket.user?.username || socket.data.username;
    const userId   = String(socket.user?.id || socket.data.userId || '');

    // Socket mapping-уудыг шууд устгах — userSockets-ыг зөвхөн энэ socket
    // эзэмшиж байсан бол устгана (өөр цонхны socket idэвхтэй үлдэж болно)
    onlineUsers.delete(socket.id);
    if (userId && userSockets.get(userId) === socket.id) userSockets.delete(userId);
    io.emit('lobby:online_users', onlineUsersList());

    // Өрөөнд байсан бол grace period эхлүүлэх
    if (roomId && username && roomMembers[roomId]) {
      // Өмнө нь grace period байсан бол цуцлах
      if (disconnectTimers[userId]) {
        clearTimeout(disconnectTimers[userId].timer);
      }
      // Бусдад мэдэгдэх: дахин холбогдохыг хүлээж байна
      io.to(roomId).emit('room:user_reconnecting', { username });

      // Grace period таймер
      disconnectTimers[userId] = {
        roomId: String(roomId),
        username,
        timer: setTimeout(async () => {
          delete disconnectTimers[userId];
          // Хугацаа дуусав — өрөөнөөс бүрмөсөн гарна
          if (roomMembers[roomId]) {
            roomMembers[roomId].delete(username);
            io.to(roomId).emit('room:user_left', { username });
            io.to(roomId).emit('room:members', membersArray(roomId));
          }
          // Тоглогчийн ready state устгах (room isolation)
          if (roomReady[roomId]) roomReady[roomId].delete(userId);
          // Салсан тоглогчийн LAN тоглоомуудыг цэвэрлэх (relay control ч тасарна)
          try { lanHostRoutes.removeUserGames(roomId, userId); } catch {}
          // Хост байсан бол DB-с өрөөг автоматаар устгах
          if (dbForMigration && userId) {
            try {
              const rr = await dbForMigration.query(
                `SELECT id FROM rooms
                 WHERE host_id=$1 AND id=$2 AND status IN ('waiting','playing')`,
                [userId, roomId]
              );
              if (rr.rows[0]) {
                await dbForMigration.query("UPDATE bot_jobs SET status='cancelled', updated_at=NOW() WHERE room_id=$1 AND status IN ('queued','hosting','lobby')", [roomId]).catch(() => {});
                await dbForMigration.query('DELETE FROM rooms WHERE id=$1', [roomId]);
                io.to(roomId).emit('room:closed', { reason: 'Өрөөний эзэн гарлаа' });
                cleanupRoomState(roomId);
                io.emit('rooms:updated');
                console.log(`[AutoClose] Host timeout → room ${roomId} хаагдлаа`);
              }
            } catch (e) { console.error('[AutoClose]', e.message); }
          }
          console.log(`[Rejoin] ${username} grace period дууссан, өрөөнөөс гарлаа`);
        }, REJOIN_GRACE_MS),
      };
      console.log(`[Socket] салгагдлаа: ${socket.id} (${username}) — ${REJOIN_GRACE_MS / 1000}с grace period`);
      setRoomWaitingIfNoPlayersInGame(roomId);
    } else {
      console.log(`[Socket] салгагдлаа: ${socket.id} (${username})`);
    }
  });
});

// ── Өрөөний auto-expire (2 цаг тутам) ───────────────────
// Зөвхөн ИДЭВХГҮЙ өрөөг цэвэрлэнэ: дотор нь холбогдсон гишүүн эсвэл
// тоглож буй хүн байвал хуучирсан ч хүрэхгүй. Устгахдаа room:closed +
// rooms:updated мэдэгдэж, in-memory төлөвийг цэвэрлэнэ.
function roomHasActiveMembers(roomId) {
  const members = roomMembers[String(roomId)];
  return !!(members && members.size > 0);
}

const autoExpireInterval = setInterval(async () => {
  if (!dbForMigration) return;
  try {
    let changed = false;

    // 6+ цаг хүлээж буй өрөө — гишүүнгүй бол устгана
    const oldWaiting = await dbForMigration.query(
      "SELECT id FROM rooms WHERE status='waiting' AND created_at < NOW() - INTERVAL '6 hours'"
    );
    for (const row of oldWaiting.rows) {
      if (roomHasActiveMembers(row.id)) continue;
      await dbForMigration.query("UPDATE bot_jobs SET status='cancelled', updated_at=NOW() WHERE room_id=$1 AND status IN ('queued','hosting','lobby')", [row.id]).catch(() => {});
      await dbForMigration.query('DELETE FROM rooms WHERE id=$1', [row.id]);
      io.to(String(row.id)).emit('room:closed', { reason: 'Өрөө удаан идэвхгүй байсан тул хаагдлаа' });
      cleanupRoomState(row.id);
      changed = true;
    }

    // 12+ цаг playing өрөө — тоглож буй хүн байвал орхино,
    // гишүүдтэй бол waiting болгоно, хоосон бол устгана
    const oldPlaying = await dbForMigration.query(
      "SELECT id FROM rooms WHERE status='playing' AND created_at < NOW() - INTERVAL '12 hours'"
    );
    for (const row of oldPlaying.rows) {
      if (roomHasInGamePlayer(row.id)) continue;
      if (roomHasActiveMembers(row.id)) {
        await dbForMigration.query("UPDATE rooms SET status='waiting' WHERE id=$1", [row.id]);
      } else {
        await dbForMigration.query("UPDATE bot_jobs SET status='cancelled', updated_at=NOW() WHERE room_id=$1 AND status IN ('queued','hosting','lobby')", [row.id]).catch(() => {});
        await dbForMigration.query('DELETE FROM rooms WHERE id=$1', [row.id]);
        io.to(String(row.id)).emit('room:closed', { reason: 'Өрөө удаан идэвхгүй байсан тул хаагдлаа' });
        cleanupRoomState(row.id);
      }
      changed = true;
    }

    // Хуучин 'done' мөрүүдийг устгах (DB бөглөрөхөөс сэргийлнэ)
    await dbForMigration.query("DELETE FROM rooms WHERE status='done' AND created_at < NOW() - INTERVAL '7 days'");

    if (changed) {
      io.emit('rooms:updated');
      console.log('[AutoExpire] Идэвхгүй өрөөнүүдийг цэвэрлэлээ');
    }
  } catch (e) { console.error('[AutoExpire]', e.message); }
}, 2 * 60 * 60 * 1000);
if (typeof autoExpireInterval.unref === 'function') autoExpireInterval.unref();

async function start(port = PORT) {
  if (server.listening) return server;
  await runStartupMigrations();
  return new Promise((resolve) => {
    server.listen(port, () => {
      console.log(`Server http://localhost:${port} дээр ажиллаж байна`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error('[Startup]', error);
    process.exit(1);
  });
}

module.exports = { app, server, io, start, runStartupMigrations };
