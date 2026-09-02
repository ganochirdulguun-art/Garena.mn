const SERVER = 'https://garenamn-production.up.railway.app';

// Богино туслах (локал const el-ууд үүнийг өөрсдийн scope-д shadow хийнэ)
function el(id) { return document.getElementById(id); }

// ── Socket.io ─────────────────────────────────────────────
let socket = null;
let currentRoom = null;
let currentUser = null;
// WC3 энэ цонхноос нээгдэж одоо ажиллаж байгаа эсэх —
// reconnect үед in_game статусыг серверт сэргээхэд ашиглана
let _gameRunning = false;
// Өрөөний мэдээлэл кэш (grid/detail action-д ашиглана)
let roomsCache = {}; // id → room object
let selectedRoomId = null;

// ── Garena сүлжээ IP хадгалалт ────────────────────────────────

// ── Sound + Notification систем ─────────────────────────
let _audioCtx = null;
function _getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return _audioCtx;
}

function playSound(type) {
  if (localStorage.getItem('sound_enabled') === 'false') return;
  try {
    const ctx = _getAudioCtx();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.15, now);

    const tones = {
      dm:        [{ f: 880, t: 0, d: 0.1 }, { f: 1174, t: 0.12, d: 0.15 }],
      notify:    [{ f: 1047, t: 0, d: 0.18 }],
      gameStart: [{ f: 523, t: 0, d: 0.12 }, { f: 659, t: 0.14, d: 0.12 }, { f: 784, t: 0.28, d: 0.25 }],
      ready:     [{ f: 660, t: 0, d: 0.1 }, { f: 880, t: 0.1, d: 0.15 }],
      join:      [{ f: 700, t: 0, d: 0.06 }],
    };

    const notes = tones[type] || tones.notify;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.f, now + n.t);
      osc.connect(gain);
      osc.start(now + n.t);
      osc.stop(now + n.t + n.d);
    }
    gain.gain.setValueAtTime(0.15, now + notes[notes.length - 1].t + notes[notes.length - 1].d - 0.02);
    gain.gain.linearRampToValueAtTime(0, now + notes[notes.length - 1].t + notes[notes.length - 1].d);
  } catch {}
}

function showDesktopNotif(title, body) {
  if (localStorage.getItem('desktop_notif_enabled') === 'false') return;
  if (!document.hidden) return; // window focus байвал харуулахгүй
  try {
    if (Notification.permission === 'granted') {
      const n = new Notification(title, { body, silent: true });
      n.onclick = () => { window.focus(); n.close(); };
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission();
    }
  } catch {}
}

// ── Чат төлөв ─────────────────────────────────────────────
const dmConversations = {};
let activeDmUserId = null;
let chatUnreadCount = 0;

// ── DM Popup төлөв ────────────────────────────────────────
const MAX_DM_POPUPS = 3;
const activePopups = new Map(); // userId -> { element, minimized, emojiOpen, typingTimer, isTyping }

// ── Emoji Data ────────────────────────────────────────────
const EMOJI_DATA = {
  smileys: ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','🙃','😉','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🤐','🤨','😐','😑','😶','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥴','😵','🤯','🥳','🥸','😎','🤓','🧐','😕','😟','🙁','☹️','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','😈','👿','💀','☠️','💩','🤡','👹','👺','👻','👽','👾','🤖'],
  people:  ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','🦾','🦿','🦵','🦶','👂','👃','🧠','🦷','🦴','👀','👁️','👅','👄'],
  animals: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🐣','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏'],
  food:    ['🍕','🍔','🍟','🌭','🍿','🥓','🥚','🍳','🥞','🧇','🍞','🧀','🥗','🥙','🥪','🌮','🌯','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🍤','🍙','🍚','🍘','🍥','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍩','🍪','🍯','🥛','☕','🍵','🧃','🥤','🧋','🍶','🍺','🍻','🥂','🍷'],
  activities: ['⚽','🏀','🏈','⚾','🎾','🏐','🏉','🎱','🏓','🏸','🏒','🏑','🏏','⛳','🏹','🎣','🥊','🥋','🎽','🛹','🛷','⛸️','🥌','🎿','🏂','🏇','🏋️','🤸','⛹️','🤾','🏌️','🏄','🏊','🤽','🚣','🧗','🚴','🚵','🎮','🕹️','🎲','♟️','🎯','🎳','🎸','🎹','🥁','🎷','🎺','🎻'],
  objects: ['💡','🔦','🕯️','📱','💻','⌨️','🖥️','🖨️','💾','💿','📷','📹','🎥','📞','📺','📻','🎙️','🧭','⏱️','⏰','⌛','⏳','📡','🔋','🔌','💰','💴','💵','💶','💷','💳','💎','⚖️','🔧','🔩','⚙️','🔗','📎','📏','📐','✂️','🗑️','🔒','🔑','🗝️'],
  symbols: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','☯️','✅','✔️','☑️','❌','❎','➕','➖','➗','✖️','♾️','‼️','⁉️','❓','❗','💯','🔥','⭐','🌟','✨','💫','🎉','🎊'],
  flags:   ['🏳️','🏴','🏁','🚩','🏳️‍🌈','🇲🇳','🇺🇸','🇬🇧','🇫🇷','🇩🇪','🇯🇵','🇰🇷','🇨🇳','🇷🇺','🇦🇺','🇨🇦','🇧🇷','🇮🇳','🇮🇹','🇪🇸','🇲🇽','🇹🇷','🇸🇪','🇳🇴']
};

// ── Нийгмийн төлөв (friends / block) ──────────────────────
let myFriends        = [];   // { id, username, avatar_url }
let pendingRequests  = [];   // { id, username, avatar_url }
let blockedUsers     = [];   // { id, username, avatar_url }
let onlineUserIds    = new Set(); // онлайн хэрэглэгчийн userId-ийн Set

// Чат хэсгийн идэвхтэй tab
let activeDmTab = 'friends';

// ── Sidebar нээх / хаах ──────────────────────────────────
localStorage.removeItem('theme');

function setSidebarCollapsed(collapsed) {
  const pageMain = document.getElementById('page-main');
  const toggleBtn = document.getElementById('btn-sidebar-toggle');
  const toggleIcon = document.getElementById('sidebar-toggle-icon');
  pageMain?.classList.toggle('sidebar-collapsed', collapsed);
  localStorage.setItem('sidebar_collapsed', collapsed ? '1' : '0');
  if (toggleBtn) {
    toggleBtn.title = collapsed ? 'Sidebar нээх' : 'Sidebar хаах';
    toggleBtn.setAttribute('aria-label', toggleBtn.title);
    toggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  }
  toggleIcon?.setAttribute('href', collapsed ? '#ico-sidebar-expand' : '#ico-sidebar-collapse');
}

setSidebarCollapsed(localStorage.getItem('sidebar_collapsed') === '1');

document.getElementById('btn-sidebar-toggle')?.addEventListener('click', () => {
  const pageMain = document.getElementById('page-main');
  setSidebarCollapsed(!pageMain?.classList.contains('sidebar-collapsed'));
});

function initBackgroundLightning() {
  const lightningEl = document.querySelector('.bg-lightning');
  if (!lightningEl) return;
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  const schedule = () => {
    const delay = 3800 + Math.random() * 7200;
    window.setTimeout(() => {
      const x = 18 + Math.random() * 74;
      const y = 86 + Math.random() * 10;
      const rotate = -7 + Math.random() * 14;
      const duration = 650 + Math.random() * 300;
      const strength = 0.92 + Math.random() * 0.08;
      const branchA = -64 + Math.random() * 16;
      const branchB = 38 + Math.random() * 22;
      const branchC = -48 + Math.random() * 18;

      lightningEl.style.setProperty('--strike-x', `${x}%`);
      lightningEl.style.setProperty('--strike-y', `${y}vh`);
      lightningEl.style.setProperty('--strike-angle', `${rotate}deg`);
      lightningEl.style.setProperty('--flash-duration', `${duration}ms`);
      lightningEl.style.setProperty('--flash-strength', strength.toFixed(2));
      lightningEl.style.setProperty('--branch-a-top', `${17 + Math.random() * 9}vh`);
      lightningEl.style.setProperty('--branch-a-height', `${24 + Math.random() * 12}vh`);
      lightningEl.style.setProperty('--branch-a-rotate', `${branchA}deg`);
      lightningEl.style.setProperty('--branch-b-top', `${31 + Math.random() * 12}vh`);
      lightningEl.style.setProperty('--branch-b-height', `${22 + Math.random() * 12}vh`);
      lightningEl.style.setProperty('--branch-b-rotate', `${branchB}deg`);
      lightningEl.style.setProperty('--branch-c-top', `${50 + Math.random() * 12}vh`);
      lightningEl.style.setProperty('--branch-c-height', `${18 + Math.random() * 10}vh`);
      lightningEl.style.setProperty('--branch-c-rotate', `${branchC}deg`);
      lightningEl.classList.remove('flash');
      void lightningEl.offsetWidth;
      lightningEl.classList.add('flash');
      schedule();
    }, delay);
  };

  schedule();
}

// initBackgroundLightning(); // 1.8.9: аянга цахилгааны эффект хассан (маскот watermark-аар сольсон)

// ── Цонх горимууд ────────────────────────────────────────
function isRoomMode() {
  return new URLSearchParams(window.location.search).get('mode') === 'room';
}
function isDMMode() {
  return new URLSearchParams(window.location.search).get('mode') === 'dm';
}
function isFriendsMode() {
  return new URLSearchParams(window.location.search).get('mode') === 'friends';
}

async function connectSocket() {
  if (socket) socket.disconnect();
  const token = await window.api.getToken().catch(() => null);
  socket = io(SERVER, {
    transports: ['websocket'],
    auth: { token },
  });

  socket.on('connect', () => {
    console.log('Socket холбогдлоо');
    updateConnectionStatus('online');
    if (currentUser) {
      socket.emit('lobby:register');
      // Өрөөнд байсан бол автоматаар дахин нэгдэх (reconnect)
      if (currentRoom) {
        console.log(`[Rejoin] Дахин холбогдлоо, өрөө ${currentRoom.id} руу дахин нэгдэж байна`);
        socket.emit('room:join', { roomId: currentRoom.id });
        // WC3 ажилласаар байвал in_game статусыг сэргээх — үгүй бол сервер
        // тоглолт дуусаагүй байхад өрөөг waiting болгож магадгүй
        if (_gameRunning) socket.emit('room:game_started');
      }
    }
  });

  // Найз хүсэлт ирэх
  socket.on('friend:request', ({ fromUserId, fromUsername }) => {
    const exists = pendingRequests.find(p => String(p.id) === String(fromUserId));
    if (!exists) {
      pendingRequests.push({ id: fromUserId, username: fromUsername, avatar_url: null });
      updatePendingBadge();
      renderFriendsTab();
      playSound('notify');
      showDesktopNotif('👋 Найзын хүсэлт', `${fromUsername} найз болохыг хүсэж байна`);
      showDMNotification(`${fromUsername} найз болохыг хүсэж байна`);
    }
  });

  // Найз хүсэлт зөвшөөрөгдсөн
  socket.on('friend:accepted', ({ byUserId, byUsername }) => {
    const exists = myFriends.find(f => String(f.id) === String(byUserId));
    if (!exists) {
      myFriends.push({ id: byUserId, username: byUsername, avatar_url: null });
      renderFriendsTab();
      playSound('notify');
      showDMNotification(`${byUsername} найз болохыг зөвшөөрлөө`);
    }
  });

  // Өрөөнд урих
  socket.on('room:invited', ({ fromUsername, fromUserId, roomId, roomName }) => {
    playSound('notify');
    showDesktopNotif('🎮 Өрөөний урилга', `${fromUsername} "${roomName}" өрөөнд урив`);
    showRoomInvite(fromUsername, roomId, roomName);
  });

  socket.on('disconnect', (reason) => {
    console.log('Socket салгагдлаа:', reason);
    updateConnectionStatus('offline');
    if (currentRoom) {
      appendSysMsg('⚠ Холболт тасарлаа. Дахин холбогдож байна...');
    }
  });
  socket.on('reconnecting', () => updateConnectionStatus('reconnecting'));

  // Өрөөний чат
  socket.on('chat:message',         (msg)        => appendMessage(msg));
  socket.on('chat:deleted', ({ time }) => {
    const box = document.getElementById('chat-messages');
    if (!box) return;
    const el = box.querySelector(`.msg[data-time="${time}"]`);
    if (el) { el.classList.add('msg-deleted'); el.querySelector('.msg-bubble').textContent = '[Устгагдсан мессеж]'; el.querySelector('.msg-delete')?.remove(); }
  });
  socket.on('lobby:deleted', ({ time }) => {
    const box = document.getElementById('lobby-chat-messages');
    if (!box) return;
    const el = box.querySelector(`.msg[data-time="${time}"]`);
    if (el) { el.classList.add('msg-deleted'); el.querySelector('.msg-bubble').textContent = '[Устгагдсан мессеж]'; el.querySelector('.msg-delete')?.remove(); }
  });
  socket.on('room:members',         (members)    => {
    if (currentRoom) {
      currentRoom.members = members;
      // Replay service-д гишүүдийг дамжуулах (player matching)
      window.api.setReplayMembers?.(members.map(m => ({
        id: m.id !== undefined ? m.id : null,
        name: m.name !== undefined ? m.name : String(m),
      }))).catch(() => {});
    }
    renderMembers(members);
  });
  socket.on('room:user_joined',     ({ username }) => { playSound('join'); appendSysMsg(`${username} нэгдлээ`); });
  socket.on('room:user_left',       ({ username }) => appendSysMsg(`${username} гарлаа`));
  socket.on('room:user_reconnecting', ({ username }) => appendSysMsg(`⚠ ${username} холболт тасарлаа, дахин холбогдохыг хүлээж байна...`));
  socket.on('room:user_rejoined',   ({ username }) => appendSysMsg(`✓ ${username} дахин нэгдлээ`));

  // Өрөөний тохиргоо шинэчлэгдсэн
  socket.on('room:updated', (room) => {
    if (currentRoom) {
      if (room.name) {
        currentRoom.name = room.name;
        document.getElementById('room-title').textContent = room.name;
      }
      if (room.max_players) {
        currentRoom.maxPlayers = room.max_players;
        const sel = document.getElementById('select-max-players');
        if (sel) {
          sel.value = String(room.max_players);
          syncMaxPlayersPicker(sel.value);
        }
      }
      updateRoomChrome(currentRoom.members?.length || 0);
      appendSysMsg(`⚙ Өрөөний тохиргоо шинэчлэгдлээ`);
    }
  });

  // Баг солигдсон
  socket.on('room:team_changed', ({ userId, team }) => {
    appendSysMsg(`Тоглогч баг ${team} руу шилжлээ`);
  });

  // Лобби өрөөний жагсаалт автоматаар шинэчлэгдэх
  let _roomsRefreshTimer = null;
  socket.on('rooms:updated', () => {
    clearTimeout(_roomsRefreshTimer);
    _roomsRefreshTimer = setTimeout(() => {
      const lobbyTab = document.getElementById('tab-lobby');
      if (lobbyTab?.classList.contains('active')) loadRooms();
    }, 300);
  });

  // Онлайн тоглогчид (лобби)
  socket.on('lobby:online_users', (users) => {
    const prevOnlineIds = new Set(onlineUserIds);
    onlineUserIds = new Set(users.map(u => String(typeof u === 'object' ? u.userId : u)));
    renderOnlineUsers(users);
    renderFriendsTab();
    if (isFriendsMode()) renderFriendsWindow();
    // Найз онлайн болсон мэдэгдэл
    myFriends.forEach(f => {
      const uid = String(f.id);
      if (!prevOnlineIds.has(uid) && onlineUserIds.has(uid)) {
        showDMNotification(`${f.username} онлайн боллоо`);
      }
    });
  });

  // Нийтийн лобби чат
  socket.on('lobby:chat', (msg) => appendLobbyMessage(msg));

  // Лобби чатын түүх (нэвтрэхэд нэг удаа ирнэ)
  socket.on('lobby:history', (msgs) => {
    lobbyMessages.length = 0; // Хуучин мессежүүдийг цэвэрлэх
    const box = document.getElementById('lobby-chat-messages');
    if (box) box.innerHTML = '';
    msgs.forEach(msg => appendLobbyMessage(msg, true));
  });

  // Өрөөний чатын түүх
  socket.on('room:history', (msgs) => {
    msgs.forEach(msg => appendMessage(msg));
  });

  // Typing indicator (DM)
  socket.on('typing:start', ({ fromUserId, fromUsername }) => {
    const uid = String(fromUserId);
    if (isDMMode()) {
      if (activeDmUserId !== uid) return;
      const indicator = document.getElementById('dm-window-typing');
      if (indicator) {
        indicator.textContent = `${fromUsername} бичиж байна...`;
        indicator.style.display = 'block';
        clearTimeout(indicator._hideTimer);
        indicator._hideTimer = setTimeout(() => { indicator.style.display = 'none'; }, 2000);
      }
      return;
    }
    // Popup-д typing indicator харуулах
    if (activePopups.has(uid)) {
      const state = activePopups.get(uid);
      const typingEl = state.element.querySelector('.dm-popup-typing');
      if (typingEl) {
        typingEl.textContent = `${fromUsername} бичиж байна...`;
        typingEl.style.display = 'block';
        clearTimeout(typingEl._hideTimer);
        typingEl._hideTimer = setTimeout(() => { typingEl.style.display = 'none'; }, 2000);
      }
    }
  });

  socket.on('typing:stop', ({ fromUserId }) => {
    const uid = String(fromUserId);
    if (isDMMode()) {
      if (activeDmUserId !== uid) return;
      const indicator = document.getElementById('dm-window-typing');
      if (indicator) indicator.style.display = 'none';
      return;
    }
    if (activePopups.has(uid)) {
      const state = activePopups.get(uid);
      const typingEl = state.element.querySelector('.dm-popup-typing');
      if (typingEl) typingEl.style.display = 'none';
    }
  });

  // Хувийн мессеж
  socket.on('private:message', (msg) => handleIncomingDM(msg));
  socket.on('private:sent',    (msg) => handleSentDM(msg));

  // Өрөөний эзэн өрөөг хаасан
  socket.on('room:closed', ({ reason }) => {
    if (!currentRoom) return;
    appendSysMsg(`⚠️ ${reason || 'Өрөө хаагдлаа'}`);
    _hostRelayStarted = false;
    try { window.api.stopRelay(); } catch {}
    setTimeout(() => {
      currentRoom = null;
      if (isRoomMode()) { window.close(); }
      else { showPage('page-main'); loadRooms(); }
    }, 1500);
  });

  // Kick хийгдсэн
  socket.on('room:kicked', ({ userId }) => {
    if (!currentUser || String(userId) !== String(currentUser.id)) return;
    appendSysMsg('⚠️ Та өрөөнөөс гаргагдлаа!');
    _hostRelayStarted = false;
    try { window.api.stopRelay(); } catch {}
    setTimeout(() => {
      currentRoom = null;
      if (isRoomMode()) { window.close(); }
      else { showPage('page-main'); loadRooms(); }
    }, 1500);
  });

  // Тоглолт эхэлсэн (эзэн биш тоглогчдод) — WC3 автомат нээгдэнэ
  socket.on('room:started', async () => {
    // Host аль хэдийн WC3 нээсэн (btn-launch-wc3 handler-ээс) — давхар нээхгүй
    if (currentRoom?.isHost) return;
    _hostEndedHandled = false; // дахин тоглоом эхэлж байгаа тул reset
    playSound('gameStart');
    showDesktopNotif('▶ Тоглолт эхэллээ!', `${currentRoom?.name || 'Өрөө'} — WC3 нээж байна...`);
    appendSysMsg('▶ Тоглолт эхэллээ! WC3 нээж байна...');
    // "Дахин нэвтрэх" товчийг харуулах
    const launchBtn = document.getElementById('btn-launch-wc3');
    if (launchBtn) launchBtn.style.display = '';
    setLaunchBtnRejoin();
    try {
      await window.api.launchGame(currentRoom?.gameType || '');
      // Зөвхөн WC3 амжилттай нээгдсэний ДАРАА in_game болгоно —
      // үгүй бол launch fail болоход 'in_game' гэж гацна
      _gameRunning = true;
      socket.emit('room:game_started');
      appendSysMsg('✓ Тоглоом нээгдлээ. Тоглоом хайж байна...');
    } catch (err) {
      appendSysMsg(`⚠️ WC3 нээхэд алдаа: ${err.message}`);
    }
  });

  // (room:host_ip / room:zt_ips / room:do_refresh_zt хэсгүүд хасагдсан —
  //  ZeroTier болон өөрөө-хостлох зам 2026-08-30-нд бүрэн хасагдав; бот-хост л үлдсэн)

  // WC3 хаагдсан
  let _hostKilledGame = false; // host хаасан учир game:exited давхар харуулахгүй
  window.api.onGameExited(async () => {
    _gameRunning = false;
    if (!currentRoom) return;
    if (currentRoom.isHost) {
      if (socket) socket.emit('room:game_ended_player', { roomId: currentRoom.id });
      // HOST: тоглогчдод мэдэгдэж, дахин эхлүүлэх товч харуулах
      if (socket) socket.emit('room:host_game_ended', { roomId: currentRoom.id });
      // REST API fallback — socket алдагдсан ч room status waiting болно
      try { await window.api.endRoom(currentRoom.id); } catch {}
      _hostRelayStarted = false;
      try { window.api.stopRelay(); } catch {}
      appendSysMsg('⚠ WC3 хаагдлаа. "▶ Тоглолт эхлүүлэх" дарж дахин эхлүүлнэ үү.');
      resetLaunchBtn(true);
      const launchBtn = document.getElementById('btn-launch-wc3');
      if (launchBtn) launchBtn.style.display = '';
    } else {
      // PLAYER: host хаасан үед killGame() → game:exited гарна, давхардуулахгүй
      if (_hostKilledGame) { _hostKilledGame = false; return; }
      if (socket) socket.emit('room:game_ended_player', { roomId: currentRoom.id });
      appendSysMsg('⚠ WC3 хаагдлаа. Дахин нэвтрэхийн тулд доорх товчийг дарна уу.');
      setLaunchBtnRejoin();
      showToast('WC3 хаагдлаа — "↩ Дахин нэвтрэх" дарж буцаж орно уу', 'warning', 8000);
    }
  });

  // Host WC3 хаагдсан — тоглогчийн WC3-г автомат хаах
  let _hostEndedHandled = false;
  socket.on('room:host_game_ended', async () => {
    if (!currentRoom || currentRoom.isHost) return;
    if (_hostEndedHandled) return; // давхар event-ээс хамгаалах
    _hostEndedHandled = true;
    _hostKilledGame = true; // game:exited давхар handler-г зогсоох
    _gameRunning = false;
    appendSysMsg('⚠ Host тоглоомыг хаалаа. Таны WC3 хаагдаж байна...');
    showToast('Host тоглоомыг хаалаа', 'warning', 5000);
    // WC3 kill + relay зогсоох
    try { await window.api.killGame(); } catch {}
    try { window.api.stopRelay(); } catch {}
    // Тоглогчийн online статусыг in_room руу шинэчлэх
    socket.emit('room:game_ended_player');
    // Товчийг нуух — host дахин эхлүүлэхэд автомат нээгдэнэ
    const launchBtn = document.getElementById('btn-launch-wc3');
    if (launchBtn) launchBtn.style.display = 'none';
    appendSysMsg('⏳ Host дахин тоглоом эхлүүлэхийг хүлээж байна...');
  });

  return socket;
}

// ── Хуудас шилжилт ────────────────────────────────────────
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  if (name === 'lobby')    loadRooms();
  if (name === 'ranking')  loadRanking();
  if (name === 'profile')  loadProfile();
  if (name === 'settings') loadSettings();
  if (name === 'discord')  loadDiscordServers();
  if (name === 'streamers') loadStreamers();
  if (name === 'chat') {
    chatUnreadCount = 0;
    updateChatBadge();
    loadSocialData();
    rerenderLobbyMessages();
    setTimeout(() => {
      const box = document.getElementById('lobby-chat-messages');
      if (box) box.scrollTop = box.scrollHeight;
    }, 50);
  }
}

// ── Auth tab UI ───────────────────────────────────────────
document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const which = btn.dataset.auth;
    // classList ашиглах — style.display нь 'hidden' CSS классыг устгадаггүй учраас
    document.getElementById('auth-login').classList.toggle('hidden', which !== 'login');
    document.getElementById('auth-register').classList.toggle('hidden', which !== 'register');
    document.getElementById('auth-forgot').classList.add('hidden');
  };
});

// ── Эхлүүлэх ─────────────────────────────────────────────
// MapHack илрэхэд гарах анхааруулга — main процессоос game:maphack event-ээр ирнэ.
function showMaphackModal(data) {
  const d = data || {};
  const max = d.max ?? 3;
  document.getElementById('maphack-overlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'maphack-overlay';
  ov.className = 'maphack-overlay';
  const body = d.banned
    ? `<p class="mh-ban">🚫 Та MapHack ${max} удаа ашигласан тул платформоос <b>ХОРИГЛОГДЛОО</b>.</p>`
    : `<p class="mh-warn">Сануулга <b>${d.warnings ?? '?'}/${max}</b> — MapHack-аа <b>унтраагаад</b> дахин оролдоно уу.<br>Нийт <b>${max}</b> удаа бол платформоос <b>бан</b> авна.</p>`;
  ov.innerHTML = `
    <div class="maphack-card">
      <div class="mh-icon">🛡️</div>
      <h2>MapHack илрэв</h2>
      <p class="mh-tool">Илрсэн хэрэгсэл: <code>${escHtml(d.tool || '?')}</code></p>
      ${body}
      <p class="mh-note">Шударга тоглоомын төлөө MapHack хатуу хориотой. Хэрэгслээ бүрэн хаагаад (гарах) дахин тогло.</p>
      <button class="btn btn-primary" id="mh-close">Ойлголоо</button>
    </div>`;
  document.body.appendChild(ov);
  document.getElementById('mh-close').onclick = () => ov.remove();
}

async function init() {
  // MapHack анхааруулгыг бүх цонхонд сонсоно (тоглолт эхлүүлэхэд илэрвэл)
  window.api.onMaphack?.(showMaphackModal);

  // Найзуудын тусдаа цонх горим
  if (isFriendsMode()) {
    document.getElementById('page-login').classList.remove('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const user = await window.api.getUser();
    if (!user) { window.close(); return; }
    currentUser = user;
    await connectSocket();
    document.getElementById('friends-fullpage').classList.add('active');
    initFriendsWindowMode();
    // Профайл чип (аватар/нэр/LV/tier/💎) — Найзууд цонхны улаан толгойд
    setUserUI(user);
    window.__premium?.refreshMe?.();
    return;
  }

  // DM тусдаа цонх горим
  if (isDMMode()) {
    document.getElementById('page-login').classList.remove('active');
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const user = await window.api.getUser();
    if (!user) { window.close(); return; }
    currentUser = user;
    await connectSocket();
    const p = new URLSearchParams(window.location.search);
    document.getElementById('dm-fullpage').classList.add('active');
    initDMWindowMode(p.get('dmUserId'), p.get('dmUsername'));
    window.addEventListener('beforeunload', () => {
      if (socket && activeDmUserId) socket.emit('typing:stop', { toUserId: activeDmUserId });
    });
    return;
  }

  // Өрөөний цонх горим: URL-аас params унших
  if (isRoomMode()) {
    // Нэвтрэх хуудас харагдахаас урьдчилан сэргийлэх
    document.getElementById('page-login').classList.remove('active');
    const user = await window.api.getUser();
    if (!user) { window.close(); return; }
    currentUser = user;
    await connectSocket();

    // Тоглолтын үр дүн (replay watcher) — өрөөний цонхонд харуулна
    window.api.onGameResult((data) => showGameResult(data));

    const p       = new URLSearchParams(window.location.search);
    const id      = p.get('roomId');
    const name    = p.get('roomName') || 'Өрөө';
    const gameType= p.get('gameType') || 'DotA';
    const isHost  = p.get('isHost') === '1';
    const hostId  = p.get('hostId') || '';
    const status  = p.get('status') || '';
    const maxPlayers = Number(p.get('maxPlayers') || 10);

    _enterRoomUI(id, name, gameType, isHost, hostId, status, maxPlayers);

    // Цонх хаагдахад өрөөнөөс гарах + relay зогсоох
    window.addEventListener('beforeunload', () => {
      if (currentRoom) {
        if (socket) {
          socket.emit('room:leave', { roomId: currentRoom.id });
        }
        window.api.stopRelay().catch(() => {});
        window.api.leaveRoom(currentRoom.id).catch(() => {});
      }
    });
    return;
  }

  // Тохируулгыг урьдчилан ачаалах (тоглоомуудын жагсаалт)
  loadSettings().catch(() => {});

  // Ердийн горим
  const user = await window.api.getUser();
  if (user) {
    currentUser = user;
    setUserUI(user);
    showPage('page-main');
    loadRooms();
    connectSocket();
    loadUnreadDMCounts();
    // Серверээс бүрэн мэдээлэл (avatar_url г.м.) шинэчлэх
    window.api.refreshUser?.().then(async () => {
      const fresh = await window.api.getUser();
      if (fresh) { currentUser = fresh; setUserUI(fresh); }
    }).catch(() => {});
  } else {
    showPage('page-login');
    loadQR();
  }

  window.api.onAuthSuccess((user) => {
    currentUser = user;
    setUserUI(user);
    showPage('page-main');
    loadRooms();
    connectSocket();
    loadUnreadDMCounts();
    if (!localStorage.getItem('onboarding_done')) setTimeout(() => startOnboarding(), 600);
  });

  window.api.onGameResult((data) => showGameResult(data));

  // Өрөөний цонх хаагдахад lobby шинэчлэх
  window.api.onRoomWindowClosed(() => loadRooms());

  // ── Auto-update мэдэгдлүүд ─────────────────────────────
  window.api.onUpdateAvailable(({ version }) => {
    showUpdateBar(`v${version} шинэ хувилбар байна. Татаж байна...`, null);
    setUpdateMsg(`v${version} шинэ хувилбар олдлоо. Татаж байна...`, 'info');
  });
  window.api.onUpdateProgress((pct) => {
    showUpdateBar(`Шинэ хувилбар татаж байна... ${pct}%`, null, pct);
    setUpdateMsg(`Татаж байна... ${pct}%`, 'info');
  });
  window.api.onUpdateDownloaded(({ version }) => {
    showUpdateBar(`v${version} бэлэн боллоо!`, true);
    setUpdateMsg(`v${version} татагдлаа! Дээрх "Суулгаж дахин эхлүүлэх" дарна уу.`, 'success');
  });
  window.api.onUpdateError?.((msg) => {
    setUpdateMsg(`Шинэчлэлийн алдаа: ${msg}`, 'error');
    showToast(`Шинэчлэлийн алдаа: ${msg}`, 'error', 6000);
  });

  // ── Хувилбар харуулах + гараар шалгах ─────────────────
  window.api.getAppVersion?.().then(v => {
    const el = document.getElementById('app-version');
    if (el) el.textContent = v || '—';
  });

  document.getElementById('btn-check-update')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-check-update');
    btn.disabled = true;
    btn.textContent = 'Шалгаж байна...';
    setUpdateMsg('', '');
    try {
      const res = await window.api.checkForUpdates();
      if (res?.error === 'dev') {
        setUpdateMsg('Dev горимд update шалгах боломжгүй.', 'warn');
      } else if (res?.error) {
        setUpdateMsg('Шалгах үед алдаа гарлаа: ' + res.error, 'error');
      } else {
        setUpdateMsg('Шалгаж байна — шинэ хувилбар байвал автоматаар татна.', 'info');
      }
    } catch {
      setUpdateMsg('Серверт холбогдож чадсангүй.', 'error');
    }
    btn.disabled = false;
    btn.innerHTML = `<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Шинэчлэл шалгах`;
  });
}

function setUpdateMsg(msg, type) {
  const el = document.getElementById('update-check-msg');
  if (!el) return;
  const colors = { info: 'var(--accent,#7c5cbf)', success: 'var(--success,#4caf50)', warn: '#f0a500', error: 'var(--danger,#e53935)' };
  el.textContent = msg;
  el.style.color = colors[type] || '';
}

function userDisplayName(user) {
  const base = String(
    user?.discord_username ||
    user?.discord_display_name ||
    user?.discord_global_name ||
    user?.username ||
    ''
  ).trim();
  // Tier nickname — "3-1 Нэр" (Discord серверийн tier nickname шиг). Tier байхгүй бол зүгээр нэр.
  return withTier(base, user?.tierbot_tier);
}

function setUserUI(user) {
  // Профайл чип одоо Найзууд цонхонд байна (1.8.5) — үндсэн цонхонд элемент байхгүй байж болно
  const nameEl = document.getElementById('user-name');
  if (nameEl) nameEl.textContent = userDisplayName(user) || user.username;
  const av = document.getElementById('user-avatar');
  if (av && user.avatar_url) { av.src = user.avatar_url; av.style.display = 'block'; }
}

// ── Имэйл нэвтрэх ────────────────────────────────────────
document.getElementById('btn-email-login').onclick = async (e) => {
  const btn     = e.currentTarget;
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  errEl.textContent = '';
  if (!email || !password) { errEl.textContent = 'Бүх талбарыг бөглөнө үү'; return; }
  btn.disabled = true; btn.textContent = 'Нэвтэрч байна...';
  try {
    const { token, user } = await window.api.emailLogin({ email, password });
    currentUser = user;
    setUserUI(user);
    showPage('page-main');
    loadRooms();
    connectSocket();
    loadUnreadDMCounts();
    if (!localStorage.getItem('onboarding_done')) setTimeout(() => startOnboarding(), 600);
  } catch (err) {
    errEl.textContent = err.message || 'Нэвтрэхэд алдаа гарлаа';
    btn.disabled = false; btn.textContent = 'Нэвтрэх';
  }
};

document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-email-login').click();
});

// ── Нууц үг сэргээх (Forgot Password) ───────────────────
function showLoginForm()  { showAuthPanel('auth-login');  }
function showForgotForm() { showAuthPanel('auth-forgot'); }

function showAuthPanel(id) {
  ['auth-login', 'auth-register', 'auth-forgot'].forEach(p => {
    const el = document.getElementById(p);
    if (el) el.classList.toggle('hidden', el.id !== id);
  });
}

document.getElementById('btn-forgot-password').onclick = () => {
  showForgotForm();
  document.getElementById('forgot-step-1').classList.remove('hidden');
  document.getElementById('forgot-step-2').classList.add('hidden');
  document.getElementById('forgot-error').textContent = '';
};

document.getElementById('btn-back-to-login').onclick = () => showLoginForm();

document.getElementById('btn-forgot-send').onclick = async (e) => {
  const btn   = e.currentTarget;
  const email = document.getElementById('forgot-email').value.trim();
  const errEl = document.getElementById('forgot-error');
  errEl.textContent = '';
  if (!email) { errEl.textContent = 'Имэйл оруулна уу'; return; }
  btn.disabled = true; btn.textContent = '...';
  try {
    await window.api.forgotPassword(email);
    document.getElementById('forgot-token-display').textContent =
      'Хэрэв энэ и-мэйл бүртгэлтэй бол сэргээх хүсэлт сервер дээр бүртгэгдлээ.';
    document.getElementById('forgot-step-1').classList.add('hidden');
    document.getElementById('forgot-step-2').classList.remove('hidden');
  } catch (err) {
    errEl.textContent = err.message || 'Алдаа гарлаа';
  } finally {
    btn.disabled = false; btn.textContent = 'Код авах';
  }
};

document.getElementById('btn-forgot-reset').onclick = async (e) => {
  const btn      = e.currentTarget;
  const token    = document.getElementById('forgot-token-input').value.trim();
  const newPw    = document.getElementById('forgot-new-password').value;
  const errEl    = document.getElementById('forgot-reset-error');
  errEl.textContent = '';
  if (!token || !newPw) { errEl.textContent = 'Бүх талбарыг бөглөнө үү'; return; }
  if (newPw.length < 6) { errEl.textContent = 'Нууц үг хамгийн багадаа 6 тэмдэгт'; return; }
  btn.disabled = true; btn.textContent = '...';
  try {
    await window.api.resetPassword(token, newPw);
    showLoginForm();
    document.getElementById('login-error').textContent = '';
    // Show success briefly
    const errLogin = document.getElementById('login-error');
    errLogin.style.color = 'var(--green)';
    errLogin.textContent = '✓ Нууц үг амжилттай шинэчлэгдлээ. Нэвтэрнэ үү.';
    setTimeout(() => { errLogin.textContent = ''; errLogin.style.color = ''; }, 5000);
  } catch (err) {
    errEl.textContent = err.message || 'Token буруу эсвэл хугацаа дууссан';
  } finally {
    btn.disabled = false; btn.textContent = 'Нууц үг шинэчлэх';
  }
};

// ── Нууц үг харах/нуух toggle ────────────────────────────
document.querySelectorAll('.btn-eye').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = document.getElementById(btn.dataset.target);
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    btn.textContent = isHidden ? '🙈' : '👁';
  });
});

// ── Бүртгэл ──────────────────────────────────────────────
document.getElementById('btn-register').onclick = async (e) => {
  const btn      = e.currentTarget;
  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const confirm  = document.getElementById('reg-password-confirm').value;
  const errEl    = document.getElementById('reg-error');
  errEl.textContent = '';
  if (!username || !email || !password || !confirm) { errEl.textContent = 'Бүх талбарыг бөглөнө үү'; return; }
  if (password !== confirm) { errEl.textContent = 'Нууц үг таарахгүй байна'; return; }
  btn.disabled = true; btn.textContent = 'Бүртгэж байна...';
  try {
    const { token, user } = await window.api.register({ username, email, password });
    currentUser = user;
    setUserUI(user);
    showPage('page-main');
    loadRooms();
    connectSocket();
    loadUnreadDMCounts();
    if (!localStorage.getItem('onboarding_done')) setTimeout(() => startOnboarding(), 600);
  } catch (err) {
    errEl.textContent = err.message || 'Бүртгэхэд алдаа гарлаа';
    btn.disabled = false; btn.textContent = 'Бүртгүүлэх';
  }
};

function startDiscordLogin() {
  window.api.login().catch((err) => {
    showToast(`Discord нэвтрэлт эхлүүлэхэд алдаа: ${err.message}`, 'error');
  });
}

document.getElementById('btn-login').onclick       = startDiscordLogin;
document.getElementById('btn-discord-reg').onclick = startDiscordLogin;

// QR код үүсгэх
async function loadQR() {
  const img     = document.getElementById('qr-img');
  const loading = document.getElementById('qr-loading');
  if (!img || !loading) return;
  img.style.display = 'none';
  loading.style.display = 'block';
  loading.textContent = 'Ачааллаж байна...';
  try {
    const { dataUrl } = await window.api.getQR();
    img.src = dataUrl;
    img.style.display = 'block';
    loading.style.display = 'none';
  } catch {
    loading.textContent = 'QR үүсгэж чадсангүй';
  }
}
document.getElementById('btn-refresh-qr').onclick = loadQR;

// ── Header товчнууд ───────────────────────────────────────
async function doLogout() {
  await window.api.logout();
  if (socket) socket.disconnect();
  currentUser = null;
  showPage('page-login');
  loadQR();
}
// "Гарах" товч Найзууд цонхонд байна (1.8.5) → үндсэн цонх гаргана, Найзууд цонх main.js-ээс хаагдана
document.getElementById('btn-logout')?.addEventListener('click', () => {
  if (isFriendsMode()) { window.api.mainAction?.({ action: 'logout' }); return; }
  doLogout();
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.onclick = () => showTab(btn.dataset.tab);
});

// ── DM panel tabs ──────────────────────────────────────────
document.querySelectorAll('.dm-tab').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.dm-tab').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.dm-tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    activeDmTab = btn.dataset.dmTab;
    const content = document.getElementById(`dm-tab-${activeDmTab}`);
    if (content) content.classList.add('active');
  };
});

// Найзуудын тусдаа цонх нээх товч
document.getElementById('btn-open-friends-window')?.addEventListener('click', () => {
  window.api.openFriendsWindow?.();
});

// ── Lobby — өрөөнүүд ─────────────────────────────────────
async function loadRooms() {
  const waiting = document.getElementById('rooms-waiting');
  const playing = document.getElementById('rooms-playing');
  waiting.innerHTML = renderRoomsSkeleton();
  playing.innerHTML = '';
  try {
    const rooms = await window.api.getRooms();
    roomsCache = {};
    rooms.forEach(r => { roomsCache[String(r.id)] = r; });
    populateGameTypeFilter(rooms);
    renderFilteredRooms();
  } catch {
    waiting.innerHTML = '<p class="empty-text">Серверт холбогдож чадсангүй</p>';
  }
}

// Тоглоомын төрлийн filter dropdown-г populate хийх
function populateGameTypeFilter(rooms) {
  const sel = document.getElementById('room-filter-type');
  if (!sel) return;
  const prev = sel.value;
  const types = new Set();
  rooms.forEach(r => { if (r.game_type) types.add(r.game_type); });
  configuredGames.forEach(g => { if (g.name) types.add(g.name); });
  const sorted = [...types].sort();
  sel.innerHTML = '<option value="">Бүх төрөл</option>'
    + sorted.map(t => `<option value="${escHtml(t)}">${escHtml(t)}</option>`).join('');
  if (prev && [...sel.options].some(o => o.value === prev)) sel.value = prev;
}

// Шүүлтүүр + эрэмбэлэлт хийж render хийх
function renderFilteredRooms() {
  const waiting = document.getElementById('rooms-waiting');
  const playing = document.getElementById('rooms-playing');
  const detail = document.getElementById('room-detail-panel');
  const board = document.querySelector('.room-board-layout');
  if (!waiting || !playing) return;

  const allRooms = Object.values(roomsCache);
  const filtered = getFilteredRooms(allRooms);
  const waitRooms = filtered.filter(r => r.status === 'waiting');
  const playRooms = filtered.filter(r => r.status === 'playing');

  const search = (document.getElementById('room-search')?.value || '').trim();
  const filterType = document.getElementById('room-filter-type')?.value || '';
  const hasFilter = search || filterType;
  const noResultMsg = hasFilter
    ? '<p class="empty-text">Хайлтад тохирох өрөө олдсонгүй</p>'
    : '';

  const selectedExists = filtered.some(r => String(r.id) === String(selectedRoomId));
  if (!selectedExists) {
    selectedRoomId = waitRooms[0]?.id ?? playRooms[0]?.id ?? null;
  }

  waiting.innerHTML = renderRoomGrid(waitRooms, false, noResultMsg || '<p class="empty-text">Одоогоор нээлттэй өрөө байхгүй</p>');
  playing.innerHTML = renderRoomGrid(playRooms, true, noResultMsg || '<p class="empty-text">Одоогоор тоглолт явагдахгүй байна</p>');

  const waitingCount = document.getElementById('rooms-waiting-count');
  const playingCount = document.getElementById('rooms-playing-count');
  if (waitingCount) waitingCount.textContent = `${waitRooms.length} өрөө`;
  if (playingCount) playingCount.textContent = `${playRooms.length} өрөө`;
  const selectedRoom = filtered.find(r => String(r.id) === String(selectedRoomId));
  if (board) board.classList.toggle('no-selection', !selectedRoom);
  if (detail) {
    detail.innerHTML = renderRoomDetail(selectedRoom);
  }
}

// Rooms жагсаалтыг шүүж, эрэмбэлэх
function getFilteredRooms(rooms) {
  const search = (document.getElementById('room-search')?.value || '').trim().toLowerCase();
  const filterType = document.getElementById('room-filter-type')?.value || '';
  const sortBy = document.getElementById('room-sort')?.value || 'newest';

  let result = rooms;

  // Нэр / эзнээр хайлт
  if (search) {
    result = result.filter(r =>
      (r.name || '').toLowerCase().includes(search) ||
      (r.host_name || '').toLowerCase().includes(search)
    );
  }

  // Тоглоомын төрлөөр шүүх
  if (filterType) {
    result = result.filter(r => r.game_type === filterType);
  }

  // Эрэмбэлэх
  result = [...result];
  switch (sortBy) {
    case 'players-desc':
      result.sort((a, b) => (b.player_count || 0) - (a.player_count || 0));
      break;
    case 'players-asc':
      result.sort((a, b) => (a.player_count || 0) - (b.player_count || 0));
      break;
    case 'name':
      result.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
    // 'newest' — серверийн анхны дарааллыг хэвээр ашиглана
  }

  return result;
}

// Filter event listeners (debounce-тай хайлт)
let _roomSearchTimer = null;
document.getElementById('room-search')?.addEventListener('input', () => {
  clearTimeout(_roomSearchTimer);
  _roomSearchTimer = setTimeout(() => renderFilteredRooms(), 200);
});
document.getElementById('room-filter-type')?.addEventListener('change', () => renderFilteredRooms());
document.getElementById('room-sort')?.addEventListener('change', () => renderFilteredRooms());

function roomActionButton(r, inProgress, isMyRoom, myId) {
  if (isMyRoom) {
    return `<button class="btn btn-sm btn-primary room-action-btn" data-action="rejoin" data-id="${r.id}" data-host="${r.host_id}" data-ishost="${String(r.host_id) === myId}">Буцах</button>`;
  }
  if (inProgress) {
    return `<button class="btn btn-sm btn-primary btn-with-icon room-action-btn" data-action="join-playing" data-id="${r.id}" data-host="${r.host_id}"><svg class="btn-icon-svg" style="width:13px;height:13px"><use href="#ico-join"/></svg> Нэгдэх</button>`;
  }
  return `<button class="btn btn-primary btn-sm room-action-btn" data-action="join" data-id="${r.id}" data-host="${r.host_id}" data-pass="${r.has_password}">Нэгдэх</button>`;
}

function roomMemberLinks(r) {
  return (r.members || []).map(m => {
    const mid = m.id ? String(m.id) : '';
    const mname = m.name || m;
    return `<span class="clickable-name" data-user-id="${mid}">${escHtml(mname)}</span>`;
  }).join(', ');
}

// GameRanger "Game Info" маягийн босоо тоглогчийн жагсаалт — онлайн цэг + Tier нэр,
// мөр дээр дархад rank/профайл гарна.
function roomPlayerList(r) {
  const members = r.members || [];
  if (!members.length) return '<div class="rp-empty">Одоогоор тоглогч алга</div>';
  const hostId = String(r.host_id);
  return members.map(m => {
    const mid = m.id ? String(m.id) : '';
    const online = mid && onlineUserIds.has(mid);
    const isHost = mid && mid === hostId;
    const label = withTier(m.name || m, m.tier);
    return `<div class="rp-row" data-user-id="${mid}" title="Дэлгэрэнгүй харах">
      <span class="rp-dot ${online ? 'on' : 'off'}"></span>
      <span class="clickable-name rp-name" data-user-id="${mid}">${escHtml(label)}</span>
      ${isHost ? '<span class="rp-host">Host</span>' : ''}
    </div>`;
  }).join('');
}

function roomStatusMeta(r, inProgress, isMyRoom) {
  if (isMyRoom) return { label: 'Миний', className: 'mine' };
  if (inProgress) return { label: 'Live', className: 'playing' };
  if ((r.player_count || 0) >= (r.max_players || 0)) return { label: 'Дүүрсэн', className: 'full' };
  return { label: 'Open', className: 'waiting' };
}

function renderRoomGrid(rooms, inProgress, emptyHtml) {
  if (!rooms.length) return `<div class="room-grid-empty">${emptyHtml}</div>`;
  return `
    <div class="room-data-grid" role="table">
      <div class="room-grid-header" role="row">
        <div>STA</div>
        <div>Өрөө</div>
        <div>Game</div>
        <div>Mode</div>
        <div>Host</div>
        <div>Players</div>
        <div>Net</div>
        <div></div>
      </div>
      ${rooms.map((r, i) => roomGridRow(r, inProgress, i)).join('')}
    </div>
  `;
}

function roomGridRow(r, inProgress, idx = 0) {
  const myId     = String(currentUser?.id);
  const isMyRoom = String(r.host_id) === myId ||
                   (r.members || []).some(m => String(m.id) === myId);
  const selected = String(r.id) === String(selectedRoomId);
  const status = roomStatusMeta(r, inProgress, isMyRoom);
  const desc = (r.description || '').trim();
  const memberCount = (r.members || []).length;
  const networkLabel = 'LAN';
  const roomFlags = [
    r.has_password ? '<span class="room-lock">Lock</span>' : '',
    isMyRoom ? '<span class="my-room-tag">Миний өрөө</span>' : '',
  ].filter(Boolean).join('');

  return `
    <div class="room-grid-row ${inProgress ? 'room-playing' : ''} ${isMyRoom ? 'room-mine' : ''} ${selected ? 'selected' : ''}" role="row" tabindex="0" data-room-id="${r.id}" style="animation-delay:${idx * 0.025}s">
      <div class="room-cell room-cell-status" role="cell">
        <span class="room-status-pill ${status.className}"><span class="room-state-dot"></span>${status.label}</span>
      </div>
      <div class="room-cell room-cell-room" role="cell">
        <div class="room-grid-name-row">
          <span class="room-name">${escHtml(r.name)}</span>
          ${roomFlags}
        </div>
        <div class="room-grid-subline">${desc ? escHtml(desc) : `${memberCount} тоглогчийн мэдээлэл`}</div>
      </div>
      <div class="room-cell" role="cell"><span class="badge game-badge" style="background:${gameTypeColor(r.game_type)}">${escHtml(r.game_type || '-')}</span></div>
      <div class="room-cell muted" role="cell">${r.game_mode ? escHtml(r.game_mode) : '-'}</div>
      <div class="room-cell" role="cell">${escHtml(r.host_name || '-')}</div>
      <div class="room-cell room-cell-players" role="cell">
        <span>${r.player_count || 0}/${r.max_players || '-'}</span>
        <span class="room-fill-bar"><span style="width:${Math.min(100, Math.round(((r.player_count || 0) / (r.max_players || 1)) * 100))}%"></span></span>
      </div>
      <div class="room-cell muted" role="cell">${networkLabel}</div>
      <div class="room-cell room-cell-action" role="cell">${roomActionButton(r, inProgress, isMyRoom, myId)}</div>
    </div>
  `;
}

function renderRoomDetail(r) {
  if (!r) {
    return `
      <div class="room-detail-empty">
        <div class="room-detail-icon">i</div>
        <p>Өрөө сонгоход дэлгэрэнгүй мэдээлэл энд гарна.</p>
      </div>
    `;
  }

  const myId = String(currentUser?.id);
  const inProgress = r.status === 'playing';
  const isMyRoom = String(r.host_id) === myId ||
                   (r.members || []).some(m => String(m.id) === myId);
  const status = roomStatusMeta(r, inProgress, isMyRoom);
  const networkLabel = 'LAN bridge';

  return `
    <div class="room-detail-card ${inProgress ? 'room-playing' : ''} ${isMyRoom ? 'room-mine' : ''}">
      <div class="room-detail-top">
        <span class="room-status-pill ${status.className}"><span class="room-state-dot"></span>${status.label}</span>
        ${r.has_password ? '<span class="room-lock">Lock</span>' : ''}
      </div>
      <h3>${escHtml(r.name)}</h3>
      <div class="room-detail-badges">
        <span class="badge game-badge" style="background:${gameTypeColor(r.game_type)}">${escHtml(r.game_type || '-')}</span>
        ${r.game_mode ? `<span class="badge mode-badge">${escHtml(r.game_mode)}</span>` : ''}
        ${isMyRoom ? '<span class="my-room-tag">Миний өрөө</span>' : ''}
      </div>
      <p class="room-detail-desc">${escHtml((r.description || '').trim() || 'Тайлбар оруулаагүй байна.')}</p>
      <div class="room-detail-stats">
        <div><span>Host</span><strong>${escHtml(r.host_name || '-')}</strong></div>
        <div><span>Players</span><strong>${r.player_count || 0}/${r.max_players || '-'}</strong></div>
        <div><span>Network</span><strong>${networkLabel}</strong></div>
      </div>
      <div class="room-members room-detail-players">
        <span class="room-detail-label">Тоглогчид · ${r.player_count || 0}/${r.max_players || '-'}</span>
        <div class="rp-list">${roomPlayerList(r)}</div>
      </div>
      <div class="room-detail-actions">
        ${roomActionButton(r, inProgress, isMyRoom, myId)}
      </div>
    </div>
  `;
}

function rejoinMyRoom(id, name, gameType, hostId, isHost) {
  const cached = roomsCache[id] || {};
  enterRoom(id, name, gameType, isHost, hostId, cached.status);
}

async function joinPlayingRoom(id, name, gameType, hostId) {
  if (!await showConfirm('Тоглолтод нэгдэх', `"${name}" тоглолтод нэгдэх үү? "${gameType}" тоглоом нээгдэнэ.`)) return;
  try {
    await window.api.launchGame(gameType);
  } catch (err) {
    showToast(`Тоглоом нээхэд алдаа гарлаа: ${err.message}`, 'error');
  }
}

document.getElementById('btn-refresh').onclick = loadRooms;

// Room detail дотор тоглогчийн мөр/нэр дарахад профайл (rank) нээх
document.addEventListener('click', e => {
  const row = e.target.closest('.rp-row');
  if (row && row.dataset.userId) {
    e.stopPropagation();
    openUserProfile(row.dataset.userId);
    return;
  }
  const nameEl = e.target.closest('.room-members .clickable-name');
  if (nameEl && nameEl.dataset.userId) {
    e.stopPropagation();
    openUserProfile(nameEl.dataset.userId);
    return;
  }
});

document.addEventListener('click', e => {
  if (e.target.closest('.room-action-btn')) return;
  const row = e.target.closest('.room-grid-row');
  if (!row || !row.dataset.roomId) return;
  selectedRoomId = row.dataset.roomId;
  renderFilteredRooms();
});

document.addEventListener('keydown', e => {
  const row = e.target.closest?.('.room-grid-row');
  if (!row || !row.dataset.roomId) return;
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  selectedRoomId = row.dataset.roomId;
  renderFilteredRooms();
});

// Өрөөний товч event delegation (data-attribute ашиглан)
document.addEventListener('click', e => {
  const btn = e.target.closest('.room-action-btn');
  if (!btn) return;
  const id     = btn.dataset.id;
  const hostId = btn.dataset.host;
  const room   = roomsCache[id];
  if (!room) return;
  const action = btn.dataset.action;
  if (action === 'join') {
    joinRoom(id, room.name, room.game_type, room.has_password, hostId);
  } else if (action === 'join-playing') {
    joinPlayingRoom(id, room.name, room.game_type, hostId);
  } else if (action === 'rejoin') {
    const isHost = btn.dataset.ishost === 'true';
    rejoinMyRoom(id, room.name, room.game_type, hostId, isHost);
  }
});

// Хурдан тоглолт
document.getElementById('btn-quickmatch').onclick = async () => {
  const gameType = configuredGames[0]?.name;
  if (!gameType) { showToast('Эхлээд Тохируулга таб-д тоглоом нэмнэ үү', 'warning'); return; }
  const btn = document.getElementById('btn-quickmatch');
  btn.disabled = true; btn.textContent = '⏳ ...';
  try {
    const result = await window.api.quickMatch(gameType);
    const room = result.room;
    roomsCache[String(room.id)] = room;
    const isHost = !result.joined && String(room.host_id) === String(currentUser?.id);
    enterRoom(String(room.id), room.name, room.game_type, isHost, String(room.host_id), room.status);
  } catch (err) {
    showToast(`Хурдан тоглолт: ${err.message}`, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '⚡ Хурдан';
  }
};

// Өрөө үүсгэх форм
document.getElementById('btn-create-room').onclick = () => {
  const f = document.getElementById('create-room-form');
  const isHidden = f.style.display === 'none' || f.style.display === '';
  f.style.display = isHidden ? 'block' : 'none';
  if (isHidden) populateRoomTypeSelect(); // Тоглоомуудын жагсаалтыг шинэчлэх
};
document.getElementById('btn-cancel-room').onclick = () => {
  document.getElementById('create-room-form').style.display = 'none';
};
document.getElementById('room-has-password').onchange = function () {
  document.getElementById('room-password').style.display = this.checked ? 'block' : 'none';
};
document.getElementById('btn-submit-room').onclick = async () => {
  const name        = document.getElementById('room-name').value.trim();
  const game_type   = document.getElementById('room-type').value;
  const game_mode   = document.getElementById('room-mode')?.value || '';
  const max_players = parseInt(document.getElementById('room-max').value);
  const description = document.getElementById('room-desc')?.value?.trim() || '';
  const hasPass     = document.getElementById('room-has-password').checked;
  const password    = hasPass ? document.getElementById('room-password').value : null;
  if (!name)             { showToast('Өрөөний нэр оруулна уу', 'warning'); return; }
  if (!game_type)        { showToast('Тоглоом сонгоно уу (Тохируулга таб-д тоглоом нэмнэ үү)', 'warning'); return; }
  if (hasPass && !password) { showToast('Нууц үг оруулна уу', 'warning'); return; }
  async function _doCreateRoom() {
    const background_url = (document.getElementById('room-bg')?.value || '').trim();
    const room = await window.api.createRoom({ name, max_players, game_type, password, description, game_mode, background_url });
    document.getElementById('create-room-form').style.display = 'none';
    document.getElementById('room-name').value = '';
    document.getElementById('room-desc').value = '';
    document.getElementById('room-mode').value = '';
    document.getElementById('room-has-password').checked = false;
    document.getElementById('room-password').value = '';
    document.getElementById('room-password').style.display = 'none';
    showToast(`"${room.name}" өрөө үүслээ`, 'success');
    enterRoom(room.id, room.name, room.game_type, true, null, room.status);
  }
  try {
    await _doCreateRoom();
  } catch (err) {
    if (err.message?.includes('аль хэдийн')) {
      // Хуучин өрөө DB-д үлдсэн — хэрэглэгчээс хаах зөвшөөрөл авах
      const myRoom = await window.api.getMyRoom().catch(() => null);
      const oldName = myRoom?.name || 'хуучин өрөө';
      const ok = await showConfirm('Хуучин өрөө байна', `"${oldName}" гэсэн хуучин өрөөтэй байна. Хаагаад шинэ өрөө үүсгэх үү?`);
      if (!ok) return;
      try {
        if (myRoom) await window.api.closeRoom(myRoom.id);
        await _doCreateRoom();
      } catch (err2) { showToast(`Алдаа: ${err2.message}`, 'error'); }
    } else {
      showToast(`Алдаа: ${err.message}`, 'error');
    }
  }
};

// ── Өрөөнд нэгдэх ────────────────────────────────────────
let _pendingJoin = null;

async function joinRoom(id, name, gameType, hasPassword, hostId) {
  if (hasPassword) {
    _pendingJoin = { id, name, gameType, hostId };
    document.getElementById('join-password').value = '';
    document.getElementById('join-password-error').textContent = '';
    document.getElementById('password-modal').style.display = 'flex';
    return;
  }
  await doJoinRoom(id, name, gameType, null, hostId);
}

async function doJoinRoom(id, name, gameType, password, hostId) {
  try {
    await window.api.joinRoom(id, password);
    enterRoom(id, name, gameType, false, hostId);
  } catch (err) {
    if (err.message?.includes('Нууц үг шаардлагатай')) {
      joinRoom(id, name, gameType, true, hostId);
    } else {
      showToast(`Алдаа: ${err.message}`, 'error');
    }
  }
}

document.getElementById('btn-join-confirm').onclick = async () => {
  if (!_pendingJoin) return;
  const password = document.getElementById('join-password').value;
  const errEl    = document.getElementById('join-password-error');
  errEl.textContent = '';
  try {
    await window.api.joinRoom(_pendingJoin.id, password);
    document.getElementById('password-modal').style.display = 'none';
    enterRoom(_pendingJoin.id, _pendingJoin.name, _pendingJoin.gameType, false, _pendingJoin.hostId);
    _pendingJoin = null;
  } catch (err) {
    errEl.textContent = err.message || 'Нууц үг буруу';
  }
};
document.getElementById('btn-join-cancel').onclick = () => {
  document.getElementById('password-modal').style.display = 'none';
  _pendingJoin = null;
};
document.getElementById('join-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-join-confirm').click();
});

// ── Өрөөнд орох ──────────────────────────────────────────
// Үндсэн цонхноос дуудагдана → шинэ цонх нээнэ
function enterRoom(id, name, gameType, isHost, hostId, status) {
  const resolvedHostId = hostId ? String(hostId) : String(currentUser?.id);
  const cached = roomsCache[id] || {};
  window.api.openRoomWindow({
    id,
    name,
    gameType,
    isHost,
    hostId: resolvedHostId,
    status: status || '',
    maxPlayers: cached.max_players || cached.maxPlayers || 10,
    backgroundUrl: cached.background_url || '',
  });
}

function setRoomText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function updateRoomChrome(memberCount = currentRoom?.members?.length || 0) {
  if (!currentRoom) return;
  const maxPlayers = Math.max(1, Number(currentRoom.maxPlayers || 10));
  const pct = Math.min(100, Math.round((memberCount / maxPlayers) * 100));
  const statusLabel = currentRoom.status === 'playing' ? 'Тоглолт явагдаж байна' : 'Хүлээлгийн өрөө';
  const roleLabel = currentRoom.isHost ? 'Та host' : 'Оролцогч';

  setRoomText('members-count', String(memberCount));
  setRoomText('room-capacity-text', `${memberCount} / ${maxPlayers} тоглогч`);
  setRoomText('room-capacity-chip', `${memberCount} / ${maxPlayers}`);
  setRoomText('room-role-text', roleLabel);
  setRoomText('room-status-text', statusLabel);
  setRoomText('room-game-name', currentRoom.gameType || '-');
  setRoomText('room-short-name', currentRoom.name || '-');
  setRoomText('room-info-text', `Room #${currentRoom.id} · ${roleLabel}`);

  const meter = document.getElementById('room-player-meter');
  if (meter) meter.style.width = `${pct}%`;
}

const MAX_PLAYERS_OPTIONS = ['2', '4', '6', '8', '10', '12'];

function getMaxPlayerOptionButtons() {
  return Array.from(document.querySelectorAll('#max-players-options button[data-value]'));
}

function setMaxPlayersPickerOpen(open, restoreFocus = false) {
  const picker = document.getElementById('max-players-picker');
  const trigger = document.getElementById('max-players-trigger');
  const options = document.getElementById('max-players-options');
  if (!picker || !trigger || !options) return;

  picker.classList.toggle('open', open);
  options.classList.toggle('hidden', !open);
  trigger.setAttribute('aria-expanded', open ? 'true' : 'false');

  if (open) {
    const active = options.querySelector('button.active') || options.querySelector('button[data-value]');
    active?.focus({ preventScroll: true });
  } else if (restoreFocus && options.contains(document.activeElement)) {
    trigger.focus({ preventScroll: true });
  }
}

function syncMaxPlayersPicker(value) {
  const cleanValue = MAX_PLAYERS_OPTIONS.includes(String(value)) ? String(value) : '10';
  const valueEl = document.getElementById('max-players-value');
  const trigger = document.getElementById('max-players-trigger');
  if (valueEl) valueEl.textContent = cleanValue;
  if (trigger) trigger.setAttribute('aria-label', `Дээд хязгаар ${cleanValue} тоглогч`);

  getMaxPlayerOptionButtons().forEach(btn => {
    const active = btn.dataset.value === cleanValue;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  setMaxPlayersPickerOpen(false);
}

function chooseMaxPlayers(value) {
  const sel = document.getElementById('select-max-players');
  if (!sel) return;
  const cleanValue = MAX_PLAYERS_OPTIONS.includes(String(value)) ? String(value) : '10';
  if (sel.value === cleanValue) {
    syncMaxPlayersPicker(cleanValue);
    return;
  }
  sel.value = cleanValue;
  syncMaxPlayersPicker(cleanValue);
  sel.dispatchEvent(new Event('change', { bubbles: true }));
}

function focusMaxPlayerOption(delta) {
  const buttons = getMaxPlayerOptionButtons();
  if (!buttons.length) return;
  const activeIndex = buttons.findIndex(btn => btn === document.activeElement);
  const fallbackIndex = Math.max(0, buttons.findIndex(btn => btn.classList.contains('active')));
  const currentIndex = activeIndex >= 0 ? activeIndex : fallbackIndex;
  const nextIndex = (currentIndex + delta + buttons.length) % buttons.length;
  buttons[nextIndex].focus({ preventScroll: true });
}

document.getElementById('max-players-trigger')?.addEventListener('click', e => {
  e.stopPropagation();
  const picker = document.getElementById('max-players-picker');
  setMaxPlayersPickerOpen(!picker?.classList.contains('open'));
});

document.getElementById('max-players-trigger')?.addEventListener('keydown', e => {
  if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
    e.preventDefault();
    setMaxPlayersPickerOpen(true);
  }
});

document.getElementById('max-players-options')?.addEventListener('click', e => {
  const btn = e.target.closest?.('button[data-value]');
  if (!btn) return;
  e.stopPropagation();
  chooseMaxPlayers(btn.dataset.value);
});

document.getElementById('max-players-options')?.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    e.preventDefault();
    setMaxPlayersPickerOpen(false, true);
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusMaxPlayerOption(1);
    return;
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusMaxPlayerOption(-1);
    return;
  }
  if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    const buttons = getMaxPlayerOptionButtons();
    const target = e.key === 'Home' ? buttons[0] : buttons[buttons.length - 1];
    target?.focus({ preventScroll: true });
    return;
  }
  if (e.key === 'Enter' || e.key === ' ') {
    const btn = e.target.closest?.('button[data-value]');
    if (!btn) return;
    e.preventDefault();
    chooseMaxPlayers(btn.dataset.value);
  }
});

document.addEventListener('click', e => {
  if (!e.target.closest?.('#max-players-picker')) setMaxPlayersPickerOpen(false);
});

// Өрөөний цонхны UI тохируулга (room цонхноос шууд дуудагдана)
function _enterRoomUI(id, name, gameType, isHost, hostId, status, maxPlayers = 10) {
  // Хуучин relay зогсоож, state reset хийх
  _hostRelayStarted = false;
  try { window.api.stopRelay(); } catch {}
  const cached = roomsCache[id] || {};
  currentRoom = {
    id,
    name,
    gameType,
    isHost,
    hostId: hostId || String(currentUser?.id),
    maxPlayers: Number(cached.max_players || maxPlayers || 10),
    status: status || 'waiting',
  };

  document.getElementById('room-title').textContent = name;
  document.getElementById('room-badge').textContent = gameType;
  document.getElementById('room-badge').className   = 'badge game-badge';
  document.getElementById('room-badge').style.background = gameTypeColor(gameType);
  updateRoomChrome(0);
  document.getElementById('chat-messages').innerHTML  = '';
  document.getElementById('members-list').innerHTML   = '';
  // Хост: "Өрөөг хаах" харуулж "Гарах" нуух — хост гарахад room устдаг учир хоёулаа байх хэрэггүй
  document.getElementById('btn-close-room').style.display = isHost ? 'grid' : 'none';
  document.getElementById('btn-leave-room').style.display = isHost ? 'none' : 'block';
  document.getElementById('btn-close-room').classList.remove('hidden');

  // Host: гишүүний дээд хязгаар тохируулах
  const maxRow = document.getElementById('max-players-row');
  if (maxRow) {
    if (isHost) {
      maxRow.classList.remove('hidden');
      const sel = document.getElementById('select-max-players');
      if (sel) {
        sel.value = String(currentRoom.maxPlayers || 10);
        syncMaxPlayersPicker(sel.value);
        sel.onchange = async () => {
          syncMaxPlayersPicker(sel.value);
          try {
            await window.api.updateRoom(currentRoom.id, { max_players: Number(sel.value) });
            currentRoom.maxPlayers = Number(sel.value);
            updateRoomChrome(currentRoom.members?.length || 0);
            appendSysMsg(`⚙ Дээд хязгаар: ${sel.value} тоглогч`);
          } catch {}
        };
      }
    } else {
      maxRow.classList.add('hidden');
      setMaxPlayersPickerOpen(false);
    }
  }

  // (Өөрөө-хостлох товч хасагдсан — тоглолтыг бот-хост панель удирдана)

  // Найз урих товч (бүх тоглогчид харуулна)
  const inviteBtn = document.getElementById('btn-invite-friends');
  if (inviteBtn) inviteBtn.style.display = 'block';
  const inviteDD = document.getElementById('invite-friends-dropdown');
  if (inviteDD) inviteDD.classList.add('hidden');

  showPage('page-room');

  if (socket && currentUser) {
    socket.emit('room:join', { roomId: id });
  }
  appendSysMsg(`"${name}" өрөөнд нэгдлээ.`);
}

// ── Өрөөний товчнууд ──────────────────────────────────────
document.getElementById('btn-leave-room').onclick = async () => {
  if (!currentRoom) return;
  _hostRelayStarted = false;
  try { await window.api.stopRelay(); } catch {}
  if (socket && currentUser) {
    socket.emit('room:leave', { roomId: currentRoom.id });
  }
  try { await window.api.leaveRoom(currentRoom.id); } catch {}
  currentRoom = null;
  if (isRoomMode()) { window.close(); }
  else { showPage('page-main'); loadRooms(); }
};

document.getElementById('btn-close-room').onclick = async (e) => {
  if (!currentRoom) return;
  const btn = e.currentTarget;
  if (btn.disabled) return;
  const room = { ...currentRoom };
  if (!await showConfirm('Өрөө хаах', `"${room.name}" өрөөг хаах уу? Бүх тоглогчид гарна.`)) return;
  if (!currentRoom || String(currentRoom.id) !== String(room.id)) return;

  btn.disabled = true;
  btn.classList.add('is-loading');
  _hostRelayStarted = false;
  try { await window.api.stopRelay(); } catch {}
  try {
    appendSysMsg('Өрөө хааж байна...');
    await window.api.closeRoom(room.id);
    currentRoom = null;
    if (isRoomMode()) { window.close(); }
    else { showPage('page-main'); loadRooms(); }
  } catch (err) {
    appendSysMsg(`⚠ Өрөө хаахад алдаа: ${err.message}`);
    showToast(`Өрөө хаахад алдаа: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('is-loading');
  }
};

// Launch товчийг "↩ Дахин нэвтрэх" горимд тавих
function setLaunchBtnRejoin() {
  const btn = document.getElementById('btn-launch-wc3');
  if (!btn) return;
  btn.querySelector('span').textContent = 'Дахин';
  btn.title = 'Дахин нэвтрэх';
  btn.classList.remove('btn-primary');
  btn.classList.add('btn-success');
}

// Launch товчийг анхны горимд буцаах
function resetLaunchBtn(isHost) {
  const btn = document.getElementById('btn-launch-wc3');
  if (!btn) return;
  btn.querySelector('span').textContent = isHost ? 'Эхлүүлэх' : 'Нээх';
  btn.title = isHost ? 'Тоглолт эхлүүлэх' : 'Тоглоом эхлүүлэх';
  btn.classList.remove('btn-success');
  btn.classList.add('btn-primary');
}

// (Өөрөө-хостлох btn-launch-wc3 урсгал хасагдсан — ZeroTier-тэй хамт 2026-08-30.
//  Тоглолтыг зөвхөн бот хостолно: btn-bot-host / btn-bot-join.)
let _hostRelayStarted = false;

// ── Өрөөний чат ──────────────────────────────────────────
function formatChatTime(time) {
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('mn-MN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function appendMessage({ userId, username, text, time }) {
  const box  = document.getElementById('chat-messages');
  const isMe = username === currentUser?.username;
  const t    = formatChatTime(time);
  const div  = document.createElement('div');
  div.className = `msg ${isMe ? 'me' : 'other'}`;
  div.dataset.time = time;
  div.dataset.userId = userId || '';
  const nameEl = isMe ? 'Та' : `<span class="clickable-name" data-user-id="${userId}">${escHtml(username)}</span>`;
  const deleteBtn = isMe ? '<button type="button" class="msg-delete" title="Мессеж устгах" aria-label="Мессеж устгах"><svg class="btn-icon-svg"><use href="#ico-trash"/></svg></button>' : '';
  div.innerHTML = `
    <div class="msg-header"><span class="msg-author">${nameEl}</span><span class="msg-dot">·</span><span class="msg-time">${t}</span>${deleteBtn}</div>
    <div class="msg-bubble">${parseMentions(escHtml(text), !isMe)}</div>
  `;
  if (!isMe && userId) {
    div.querySelector('.clickable-name')?.addEventListener('click', () => openUserProfile(userId));
  }
  if (isMe) {
    div.querySelector('.msg-delete')?.addEventListener('click', () => {
      if (!socket?.connected || !currentRoom) {
        appendSysMsg('⚠ Chat холболт бэлэн биш байна.');
        return;
      }
      socket.emit('chat:delete', { roomId: currentRoom.id, time }, (res) => {
        if (res?.ok === false) appendSysMsg(`⚠ Мессеж устгаж чадсангүй: ${res.error || 'алдаа'}`);
      });
    });
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function appendSysMsg(text) {
  const box = document.getElementById('chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'sys-msg';
  div.textContent = text;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const input = document.getElementById('chat-input');
  if (!input || !currentRoom) return;
  const text  = input.value.trim();
  if (!text) return;
  if (!socket || !socket.connected) {
    appendSysMsg('⚠ Chat холбогдож байна. Түр хүлээгээд дахин илгээнэ үү.');
    return;
  }
  socket.emit('chat:message', { roomId: currentRoom.id, text });
  input.value = '';
}

document.getElementById('btn-send').onclick = sendMessage;
document.getElementById('chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

// ── Тоглогчдын жагсаалт ──────────────────────────────────
function renderMembers(members) {
  const ul      = document.getElementById('members-list');
  const countEl = document.getElementById('members-count');
  const isHost  = currentRoom?.isHost;
  const myId    = String(currentUser?.id);
  const hostId  = currentRoom?.hostId;

  if (countEl) countEl.textContent = String(members.length);
  updateRoomChrome(members.length);

  ul.innerHTML = members.map(m => {
    const id   = m.id   !== undefined ? String(m.id) : null;
    const name = m.name !== undefined ? m.name : m;
    const isMe       = id ? id === myId   : name === currentUser?.username;
    const isRoomHost = id ? id === hostId : false;
    const safeName = escHtml(name);
    const safeId   = escHtml(id);
    const displayName = escHtml(withTier(name, m.tier));   // харагдах нэр = "3-1 Нэр" (Tier nickname)
    const kickBtn = (isHost && !isMe)
      ? `<button class="btn btn-sm btn-danger kick-btn" data-id="${safeId}" data-name="${safeName}">Kick</button>`
      : '';
    const nameSpan = (!isMe && id) ? `<span class="clickable-name" data-user-id="${safeId}">${displayName}</span>` : displayName;
    return `<li class="${isMe ? 'me' : ''}">
      <div class="member-info">
        <div>${isRoomHost ? '👑 ' : ''}${nameSpan}${isMe ? ' (Та)' : ''}</div>
      </div>
      ${kickBtn}
    </li>`;
  }).join('');

  ul.querySelectorAll('.kick-btn').forEach(btn => {
    btn.onclick = (e) => { e.stopPropagation(); kickPlayer(btn.dataset.id, btn.dataset.name); };
  });
  ul.querySelectorAll('.clickable-name').forEach(el => {
    el.addEventListener('click', () => openUserProfile(el.dataset.userId));
  });
}

// (Ready system устгагдсан — launch товч үргэлж идэвхтэй)

// ── Өрөөнөөс найз урих ──────────────────────────────────
document.getElementById('btn-invite-friends').onclick = () => {
  const dd = document.getElementById('invite-friends-dropdown');
  const isHidden = dd.classList.contains('hidden');
  if (isHidden) {
    renderInviteFriendsList();
    dd.classList.remove('hidden');
  } else {
    dd.classList.add('hidden');
  }
};

function renderInviteFriendsList() {
  const ul = document.getElementById('invite-friends-list');
  const noEl = document.getElementById('invite-no-friends');
  if (!ul) return;

  const memberIds = new Set(
    (currentRoom?.members || []).map(m => String(m.id !== undefined ? m.id : ''))
  );
  const onlineFriends = myFriends.filter(f => onlineUserIds.has(String(f.id)));

  if (onlineFriends.length === 0) {
    ul.innerHTML = '';
    noEl.style.display = 'block';
    return;
  }
  noEl.style.display = 'none';

  ul.innerHTML = onlineFriends.map(f => {
    const fid = String(f.id);
    const inRoom = memberIds.has(fid);
    return `<li data-id="${fid}">
      <span class="invite-name">${escHtml(f.username)}</span>
      ${inRoom
        ? '<span class="invite-in-room">өрөөнд байна</span>'
        : `<button class="btn btn-primary btn-invite-send" data-id="${fid}" data-name="${escHtml(f.username)}">Урих</button>`
      }
    </li>`;
  }).join('');

  ul.querySelectorAll('.btn-invite-send').forEach(btn => {
    btn.onclick = () => {
      if (!currentRoom || !socket) return;
      socket.emit('room:invite', {
        toUserId: btn.dataset.id,
        roomId: currentRoom.id,
        roomName: currentRoom.name,
      });
      btn.disabled = true;
      btn.outerHTML = '<span class="invite-sent">Илгээгдлээ</span>';
      showToast(`${btn.dataset.name}-д урилга илгээлээ`, 'success', 3000);
    };
  });
}

async function kickPlayer(targetId, targetName) {
  if (!currentRoom || !targetId) return;
  if (!await showConfirm('Гаргах', `${targetName}-г өрөөнөөс гаргах уу?`)) return;
  try {
    await window.api.kickPlayer(currentRoom.id, targetId);
    appendSysMsg(`✓ ${targetName} гаргагдлаа`);
  } catch (err) {
    appendSysMsg(`⚠️ ${err.message}`);
  }
}

// ── Нийтийн лобби чат ────────────────────────────────────
const lobbyMessages = []; // Лобби чатын мессежүүд санах ойд хадгалагдана

function appendLobbyMessage({ userId, username, text, time }, isHistory = false) {
  // Санах ойд хадгалах
  lobbyMessages.push({ userId, username, text, time });
  // Хэт олон мессеж хуримтлагдахаас сэргийлэх (сүүлийн 200)
  if (lobbyMessages.length > 200) lobbyMessages.splice(0, lobbyMessages.length - 200);

  const box = document.getElementById('lobby-chat-messages');
  if (!box) return;
  _appendLobbyMsgDOM(box, { userId, username, text, time });

  if (username !== currentUser?.username && !isHistory) {
    const chatTab = document.getElementById('tab-chat');
    if (!chatTab?.classList.contains('active')) {
      chatUnreadCount++;
      updateChatBadge();
    }
  }
}

function _appendLobbyMsgDOM(box, { userId, username, text, time }) {
  const isMe = username === currentUser?.username;
  const t    = formatChatTime(time);
  const div  = document.createElement('div');
  div.className = `msg ${isMe ? 'me' : 'other'}`;
  div.dataset.time = time;
  div.dataset.userId = userId || '';
  const nameEl = isMe ? 'Та' : `<span class="clickable-name" data-user-id="${userId}">${escHtml(username)}</span>`;
  const deleteBtn = isMe ? '<button type="button" class="msg-delete" title="Мессеж устгах" aria-label="Мессеж устгах"><svg class="btn-icon-svg"><use href="#ico-trash"/></svg></button>' : '';
  div.innerHTML = `
    <div class="msg-header"><span class="msg-author">${nameEl}</span><span class="msg-dot">·</span><span class="msg-time">${t}</span>${deleteBtn}</div>
    <div class="msg-bubble">${parseMentions(escHtml(text), !isMe)}</div>
  `;
  if (!isMe && userId) {
    div.querySelector('.clickable-name')?.addEventListener('click', () => openUserProfile(userId));
  }
  if (isMe) {
    div.querySelector('.msg-delete')?.addEventListener('click', () => {
      if (!socket?.connected) return;
      socket.emit('lobby:delete', { time }, (res) => {
        if (res?.ok === false) showToast(`Мессеж устгаж чадсангүй: ${res.error || 'алдаа'}`, 'error');
      });
    });
  }
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function rerenderLobbyMessages() {
  const box = document.getElementById('lobby-chat-messages');
  if (!box || box.children.length > 0) return; // Аль хэдийн рендэрлэгдсэн бол дахин хийхгүй
  lobbyMessages.forEach(msg => _appendLobbyMsgDOM(box, msg));
  box.scrollTop = box.scrollHeight;
}

function sendLobbyMessage() {
  const input = document.getElementById('lobby-chat-input');
  const text  = input.value.trim();
  if (!text || !socket || !currentUser) return;
  socket.emit('lobby:chat', { text });
  input.value = '';
}

document.getElementById('btn-lobby-send').onclick = sendLobbyMessage;
document.getElementById('lobby-chat-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendLobbyMessage();
});

function updateChatBadge() {
  const badge = document.getElementById('chat-badge');
  if (!badge) return;
  if (chatUnreadCount > 0) {
    badge.textContent = chatUnreadCount;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ── Уншаагүй DM тоог серверээс авах ─────────────────────
async function loadUnreadDMCounts() {
  try {
    const counts = await window.api.getUnreadCount();
    Object.entries(counts).forEach(([userId, count]) => {
      if (!dmConversations[userId]) {
        dmConversations[userId] = { username: '', messages: [], unread: 0 };
      }
      dmConversations[userId].unread = count;
    });
    renderDMUsersBadges();
    const total = Object.values(counts).reduce((s, c) => s + c, 0);
    if (total > 0) {
      chatUnreadCount += total;
      updateChatBadge();
    }
  } catch {}
}

// ── Private мессеж (DM) — Floating Popup систем ──────────
function openDM(userId, username) {
  const uid = String(userId);
  const uname = username || dmConversations[uid]?.username || 'DM';
  // Yahoo Messenger маягийн ТУСДАА цонхоор нээнэ (доторх popup биш).
  // dm:openWindow нь аль хэдийн нээлттэй бол зөвхөн focus хийдэг (давхардлахгүй).
  if (window.api?.openDMWindow) {
    window.api.openDMWindow({ userId: uid, username: uname });
    return;
  }
  // Fallback (хэрэв тусдаа цонх боломжгүй бол): хуучин popup
  if (activePopups.has(uid)) {
    const popup = activePopups.get(uid);
    if (popup.minimized) togglePopupMinimize(uid);
    popup.element.querySelector('.dm-popup-input')?.focus();
    return;
  }
  if (activePopups.size >= MAX_DM_POPUPS) closeDMPopup(activePopups.keys().next().value);
  createDMPopup(uid, username);
}

async function createDMPopup(userId, username) {
  const uid = String(userId);
  const container = document.getElementById('dm-popups-container');
  if (!container) return;

  if (!dmConversations[uid]) {
    dmConversations[uid] = { username, messages: [], unread: 0 };
  }
  dmConversations[uid].unread = 0;
  renderDMUsersBadges();

  const isOnline = onlineUserIds.has(Number(uid)) || onlineUserIds.has(uid);

  const popup = document.createElement('div');
  popup.className = 'dm-popup';
  popup.dataset.userId = uid;
  popup.innerHTML = `
    <div class="dm-popup-header">
      <div class="dm-popup-header-info">
        <span class="dm-popup-status ${isOnline ? 'online' : 'offline'}"></span>
        <span class="dm-popup-username">${escHtml(username)}</span>
        <span class="dm-popup-unread-badge">0</span>
      </div>
      <div class="dm-popup-header-actions">
        <button type="button" class="dm-popup-minimize-btn" title="Жижигрүүлэх">—</button>
        <button type="button" class="dm-popup-popout-btn" title="Тусдаа цонхоор нээх">↗</button>
        <button type="button" class="dm-popup-close-btn" title="Хаах">✕</button>
      </div>
    </div>
    <div class="dm-popup-body">
      <div class="dm-popup-messages"></div>
      <div class="dm-popup-typing"></div>
      <div class="dm-popup-input-row">
        <button type="button" class="dm-popup-emoji-btn" title="Emoji">😊</button>
        <input type="text" class="dm-popup-input" placeholder="Мессеж бичих..." />
        <button type="button" class="dm-popup-send-btn" title="Илгээх">
          <svg class="btn-icon-svg"><use href="#ico-send"/></svg>
        </button>
      </div>
    </div>
  `;

  container.appendChild(popup);

  activePopups.set(uid, {
    element: popup,
    minimized: false,
    emojiOpen: false,
    typingTimer: null,
    isTyping: false
  });

  setupPopupListeners(uid, popup, username);

  // Мессежийн түүх татах
  try {
    const history = await window.api.getDMHistory(userId);
    if (history.length > 0) {
      dmConversations[uid].messages = history.map(m => ({
        fromUsername: m.sender_username,
        fromUserId:   String(m.sender_id),
        text:         m.text,
        time:         m.created_at,
        id:           m.id,
      }));
    }
  } catch {}

  renderPopupMessages(uid);
  window.api.markDMRead(userId).catch(() => {});
  setTimeout(() => popup.querySelector('.dm-popup-input').focus(), 100);
}

function setupPopupListeners(uid, popup, username) {
  const input = popup.querySelector('.dm-popup-input');
  const sendBtn = popup.querySelector('.dm-popup-send-btn');
  const closeBtn = popup.querySelector('.dm-popup-close-btn');
  const minimizeBtn = popup.querySelector('.dm-popup-minimize-btn');
  const popoutBtn = popup.querySelector('.dm-popup-popout-btn');
  const header = popup.querySelector('.dm-popup-header');
  const emojiBtn = popup.querySelector('.dm-popup-emoji-btn');
  const state = activePopups.get(uid);

  const doSend = () => {
    const text = input.value.trim();
    if (!text || !socket) return;
    socket.emit('private:message', { toUserId: uid, text });
    input.value = '';
    if (state.emojiOpen) toggleEmojiPicker(uid);
  };

  sendBtn.onclick = doSend;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

  // Typing indicator
  input.addEventListener('input', () => {
    if (!socket) return;
    if (!state.isTyping) {
      state.isTyping = true;
      socket.emit('typing:start', { toUserId: uid });
    }
    clearTimeout(state.typingTimer);
    state.typingTimer = setTimeout(() => {
      state.isTyping = false;
      socket.emit('typing:stop', { toUserId: uid });
    }, 2000);
  });

  closeBtn.onclick = (e) => { e.stopPropagation(); closeDMPopup(uid); };

  header.addEventListener('click', (e) => {
    if (e.target.closest('.dm-popup-header-actions')) return;
    togglePopupMinimize(uid);
  });

  minimizeBtn.onclick = (e) => { e.stopPropagation(); togglePopupMinimize(uid); };

  popoutBtn.onclick = (e) => {
    e.stopPropagation();
    closeDMPopup(uid);
    window.api.openDMWindow({ userId: uid, username });
  };

  emojiBtn.onclick = () => toggleEmojiPicker(uid);
}

function closeDMPopup(uid) {
  const state = activePopups.get(uid);
  if (!state) return;
  if (state.isTyping && socket) {
    socket.emit('typing:stop', { toUserId: uid });
  }
  state.element.style.animation = 'dm-popup-down 0.2s ease-in forwards';
  setTimeout(() => {
    state.element.remove();
    activePopups.delete(uid);
  }, 200);
}

function togglePopupMinimize(uid) {
  const state = activePopups.get(uid);
  if (!state) return;
  state.minimized = !state.minimized;
  state.element.classList.toggle('minimized', state.minimized);

  if (!state.minimized) {
    const badge = state.element.querySelector('.dm-popup-unread-badge');
    if (badge) { badge.style.display = 'none'; badge.textContent = '0'; }
    window.api.markDMRead(uid).catch(() => {});
    if (dmConversations[uid]) dmConversations[uid].unread = 0;
    renderDMUsersBadges();
    const msgBox = state.element.querySelector('.dm-popup-messages');
    setTimeout(() => {
      msgBox.scrollTop = msgBox.scrollHeight;
      state.element.querySelector('.dm-popup-input').focus();
    }, 50);
  }
}

function renderPopupMessages(uid) {
  const state = activePopups.get(uid);
  if (!state) return;
  const box = state.element.querySelector('.dm-popup-messages');
  const conv = dmConversations[uid];
  if (!conv || !box) return;
  box.innerHTML = '';

  if (conv.messages.length === 0) {
    box.innerHTML = `<p class="sys-msg" style="margin-top:20px">${escHtml(conv.username)}-д анхны мессеж илгээгээрэй 💬</p>`;
    return;
  }

  conv.messages.forEach(msg => {
    const isMe = msg.fromUsername === currentUser?.username;
    const t = formatChatTime(msg.time);
    const div = document.createElement('div');
    div.className = `msg ${isMe ? 'me' : 'other'}`;
    div.innerHTML = `
      <div class="msg-name">${isMe ? 'Та' : escHtml(msg.fromUsername)}</div>
      <div class="msg-bubble">${parseMentions(escHtml(msg.text), false)}</div>
      <div class="msg-time">${t}</div>
    `;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

// ── Emoji Picker ──────────────────────────────────────────
function toggleEmojiPicker(uid) {
  const state = activePopups.get(uid);
  if (!state) return;
  const body = state.element.querySelector('.dm-popup-body');
  let picker = body.querySelector('.emoji-picker');

  if (state.emojiOpen && picker) {
    picker.remove();
    state.emojiOpen = false;
    return;
  }

  picker = document.createElement('div');
  picker.className = 'emoji-picker';

  const catIcons = { smileys:'😀', people:'👋', animals:'🐶', food:'🍕',
                     activities:'⚽', objects:'💡', symbols:'❤️', flags:'🏳️' };

  picker.innerHTML = `
    <div class="emoji-picker-header">
      <div class="emoji-categories">
        ${Object.keys(EMOJI_DATA).map((cat, i) =>
          `<button type="button" class="emoji-cat-btn ${i===0?'active':''}" data-cat="${cat}">${catIcons[cat]}</button>`
        ).join('')}
      </div>
      <input type="text" class="emoji-search" placeholder="Emoji хайх..." />
    </div>
    <div class="emoji-grid"></div>
  `;

  const inputRow = body.querySelector('.dm-popup-input-row');
  body.insertBefore(picker, inputRow);
  state.emojiOpen = true;

  renderEmojiCategory(picker, 'smileys', uid);

  picker.querySelectorAll('.emoji-cat-btn').forEach(btn => {
    btn.onclick = () => {
      picker.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderEmojiCategory(picker, btn.dataset.cat, uid);
      picker.querySelector('.emoji-search').value = '';
    };
  });

  picker.querySelector('.emoji-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    if (!q) {
      const activeCat = picker.querySelector('.emoji-cat-btn.active')?.dataset.cat || 'smileys';
      renderEmojiCategory(picker, activeCat, uid);
      return;
    }
    const grid = picker.querySelector('.emoji-grid');
    const allEmojis = Object.values(EMOJI_DATA).flat();
    grid.innerHTML = allEmojis.map(em =>
      `<button type="button" class="emoji-item">${em}</button>`
    ).join('');
    wireEmojiClicks(grid, uid);
  });

  const closeOnOutside = (e) => {
    if (!picker.contains(e.target) && !e.target.classList.contains('dm-popup-emoji-btn')) {
      picker.remove();
      state.emojiOpen = false;
      document.removeEventListener('mousedown', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('mousedown', closeOnOutside), 10);
}

function renderEmojiCategory(picker, category, uid) {
  const grid = picker.querySelector('.emoji-grid');
  const emojis = EMOJI_DATA[category] || [];
  grid.innerHTML = emojis.map(em =>
    `<button type="button" class="emoji-item">${em}</button>`
  ).join('');
  wireEmojiClicks(grid, uid);
}

function wireEmojiClicks(grid, uid) {
  grid.querySelectorAll('.emoji-item').forEach(btn => {
    btn.onclick = () => {
      const state = activePopups.get(uid);
      if (!state) return;
      const input = state.element.querySelector('.dm-popup-input');
      const start = input.selectionStart;
      const end = input.selectionEnd;
      const emoji = btn.textContent;
      input.value = input.value.substring(0, start) + emoji + input.value.substring(end);
      input.focus();
      const newPos = start + emoji.length;
      input.setSelectionRange(newPos, newPos);
    };
  });
}

// ── DM тусдаа цонх горимын функцүүд ────────────────────
async function initDMWindowMode(userId, username) {
  activeDmUserId = String(userId);
  if (!dmConversations[activeDmUserId]) {
    dmConversations[activeDmUserId] = { username, messages: [], unread: 0 };
  }
  dmConversations[activeDmUserId].unread = 0;
  document.getElementById('dm-window-title').textContent = username;
  document.title = `${username} — DM`;

  try {
    const history = await window.api.getDMHistory(userId);
    if (history.length > 0) {
      dmConversations[activeDmUserId].messages = history.map(m => ({
        fromUsername: m.sender_username,
        fromUserId:   String(m.sender_id),
        text:         m.text,
        time:         m.created_at,
        id:           m.id,
      }));
    }
  } catch {}
  renderDMWindowMessages();
  window.api.markDMRead(userId).catch(() => {});
  setDMAvatars(username);

  const input = document.getElementById('dm-window-input');
  el('dm-window-send').onclick = sendDMFromWindow;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendDMFromWindow(); }
  });
  // Зураг тавих (Ctrl+V paste)
  input.addEventListener('paste', e => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); const f = item.getAsFile(); if (f) sendDMImageFile(f); }
  });
  // Toolbar + mini toolbar
  const pick = (id) => el(id)?.click();
  el('ymdm-call')?.addEventListener('click', () => showToast('📞 Дуудлага тун удахгүй нэмэгдэнэ', 'info'));
  el('ymdm-voice')?.addEventListener('click', () => showToast('🎙️ Дуут дуудлага тун удахгүй нэмэгдэнэ', 'info'));
  el('ymdm-invite')?.addEventListener('click', dmInviteToGame);
  el('ymdm-image')?.addEventListener('click', () => pick('ymdm-image-input'));
  el('ymdm-file')?.addEventListener('click', () => pick('ymdm-file-input'));
  el('ymdm-image2')?.addEventListener('click', () => pick('ymdm-image-input'));
  el('ymdm-file2')?.addEventListener('click', () => pick('ymdm-file-input'));
  el('ymdm-emoji')?.addEventListener('click', toggleDMEmoji);
  el('ymdm-image-input')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) sendDMImageFile(f); e.target.value = ''; });
  el('ymdm-file-input')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) sendDMFileAny(f); e.target.value = ''; });
  el('ymdm-menu-action')?.addEventListener('click', () => { if (confirm('Чатын түүхийг цэвэрлэх үү? (зөвхөн энэ цонхонд)')) { dmConversations[activeDmUserId].messages = []; renderDMWindowMessages(); } });
  el('ymdm-menu-help')?.addEventListener('click', () => showToast('Yahoo Messenger маягийн DM — зураг(paste), файл, тоглолтын урилга. Дуудлага удахгүй.', 'info'));

  // Typing indicator
  let _dmWinTyping = false, _dmWinTimer = null;
  input.addEventListener('input', () => {
    if (!activeDmUserId || !socket) return;
    if (!_dmWinTyping) { _dmWinTyping = true; socket.emit('typing:start', { toUserId: activeDmUserId }); }
    clearTimeout(_dmWinTimer);
    _dmWinTimer = setTimeout(() => { _dmWinTyping = false; socket.emit('typing:stop', { toUserId: activeDmUserId }); }, 2000);
  });
  setTimeout(() => input.focus(), 100);
}

// ── DM Yahoo-style туслах функцууд ──
function dmInitials(name) {
  const s = String(name || '?').replace(/^[\d-]+\s*/, '').trim();
  const parts = s.split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}
async function setDMAvatars(otherName) {
  const meEl = el('ymdm-av-me'), otEl = el('ymdm-av-other');
  if (meEl) meEl.innerHTML = currentUser?.avatar_url ? `<img src="${escHtml(currentUser.avatar_url)}" alt="">` : escHtml(dmInitials(currentUser?.username));
  if (otEl) otEl.innerHTML = escHtml(dmInitials(otherName));
  // Нөгөө хүний аватарыг татах (боломжтой бол)
  try {
    const st = await window.api.getPlayerStatsById(activeDmUserId);
    if (st?.avatar_url && otEl) otEl.innerHTML = `<img src="${escHtml(st.avatar_url)}" alt="">`;
  } catch {}
}
function dmInviteToGame() {
  if (!currentRoom?.id) { showToast('Эхлээд өрөө үүсгээд урина уу', 'info'); return; }
  socket?.emit('room:invite', { toUserId: activeDmUserId, roomId: currentRoom.id, roomName: currentRoom.name });
  showToast('🎮 Тоглолтын урилга илгээлээ', 'success');
}
function toggleDMEmoji() {
  const pop = el('ymdm-emoji-pop'); if (!pop) return;
  if (!pop.dataset.filled) {
    const emo = '😀 😂 😍 😎 😭 😡 👍 🙏 🔥 💀 🎮 ❤️ 😅 🤝 👌 🥳 😤 😬 🤔 💪 ⚡ 🏆 😴 🤣'.split(' ');
    pop.innerHTML = emo.map(e => `<span>${e}</span>`).join('');
    pop.querySelectorAll('span').forEach(s => s.addEventListener('click', () => {
      const inp = el('dm-window-input'); inp.value += s.textContent; inp.focus(); pop.classList.add('hidden');
    }));
    pop.dataset.filled = '1';
  }
  pop.classList.toggle('hidden');
}
// Зургийг canvas-аар шахаж (max 1280px, JPEG) data URL болгоно — socket-д тохирно
function compressImageFile(file, maxSide = 1280, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      if (Math.max(w, h) > maxSide) { const r = maxSide / Math.max(w, h); w = Math.round(w * r); h = Math.round(h * r); }
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    const fr = new FileReader(); fr.onload = () => { img.src = fr.result; }; fr.onerror = reject; fr.readAsDataURL(file);
  });
}
async function sendDMImageFile(file) {
  if (!activeDmUserId || !socket) return;
  if (!file.type.startsWith('image/')) return sendDMFileAny(file);
  try {
    const dataUrl = await compressImageFile(file);
    socket.emit('private:message', { toUserId: activeDmUserId, text: '[📷 Зураг]', image: dataUrl });
  } catch { showToast('Зураг илгээхэд алдаа гарлаа', 'error'); }
}
function sendDMFileAny(file) {
  if (!activeDmUserId || !socket) return;
  if (file.size > 5 * 1024 * 1024) { showToast('Файл хэт том (5MB-аас бага байх ёстой)', 'error'); return; }
  const fr = new FileReader();
  fr.onload = () => socket.emit('private:message', { toUserId: activeDmUserId, text: `[📎 ${file.name}]`, file: { name: file.name, size: file.size, data: fr.result } });
  fr.onerror = () => showToast('Файл уншихад алдаа гарлаа', 'error');
  fr.readAsDataURL(file);
}

function sendDMFromWindow() {
  const input = document.getElementById('dm-window-input');
  const text = input.value.trim();
  if (!text || !activeDmUserId || !socket) return;
  socket.emit('private:message', { toUserId: activeDmUserId, text });
  input.value = '';
}

function renderDMWindowMessages() {
  const box = document.getElementById('dm-window-messages');
  const conv = dmConversations[activeDmUserId];
  if (!conv || !box) return;
  box.innerHTML = '';
  if (conv.messages.length === 0) {
    box.innerHTML = `<p class="sys-msg" style="margin-top:20px">${escHtml(conv.username)}-д анхны мессеж илгээгээрэй</p>`;
    return;
  }
  conv.messages.forEach(msg => {
    const isMe = msg.fromUsername === currentUser?.username;
    const t = formatChatTime(msg.time);
    const div = document.createElement('div');
    div.className = `msg ${isMe ? 'me' : 'other'}`;
    let body;
    if (msg.image) {
      body = `<img class="msg-img" src="${escHtml(msg.image)}" alt="зураг">`;
    } else if (msg.file) {
      const kb = Math.max(1, Math.round((msg.file.size || 0) / 1024));
      body = `<a class="msg-file" href="${escHtml(msg.file.data)}" download="${escHtml(msg.file.name)}"><span class="mf-ico">📎</span><span>${escHtml(msg.file.name)} · ${kb}KB</span></a>`;
    } else {
      body = `<div class="msg-bubble">${escHtml(msg.text)}</div>`;
    }
    div.innerHTML = `
      <div class="msg-name">${isMe ? 'Та' : escHtml(msg.fromUsername)}</div>
      ${body}
      <div class="msg-time">${t}</div>`;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
  // Зураг дээр дарвал шинэ цонхонд томоор
  box.querySelectorAll('.msg-img').forEach(img => img.addEventListener('click', () => {
    try { window.open(img.src, '_blank'); } catch {}
  }));
}

function handleIncomingDM({ fromUsername, fromUserId, text, time, image, file }) {
  const uid = String(fromUserId);
  if (!dmConversations[uid]) {
    dmConversations[uid] = { username: fromUsername, messages: [], unread: 0 };
  }
  dmConversations[uid].messages.push({ fromUsername, text, time, image, file });

  // Sound + desktop notification
  playSound('dm');
  showDesktopNotif(`💬 ${fromUsername}`, text?.slice(0, 100) || '');

  if (isDMMode()) {
    if (activeDmUserId === uid) {
      renderDMWindowMessages();
      window.api.markDMRead(uid).catch(() => {});
    }
    return;
  }

  // Popup нээлттэй бол тийшээ route хийх
  if (activePopups.has(uid)) {
    const state = activePopups.get(uid);
    if (state.minimized) {
      // Minimized → автоматаар нээх (restore)
      togglePopupMinimize(uid);
    } else {
      window.api.markDMRead(uid).catch(() => {});
    }
    renderPopupMessages(uid);
    return;
  }

  // Popup нээгдээгүй — автоматаар popup нээж шууд харуулах
  openDM(uid, fromUsername);
}

function handleSentDM({ fromUsername, toUserId, text, time, image, file }) {
  const uid = String(toUserId);
  if (!dmConversations[uid]) return;
  dmConversations[uid].messages.push({ fromUsername, text, time, image, file });

  if (isDMMode()) {
    if (activeDmUserId === uid) renderDMWindowMessages();
    return;
  }

  if (activePopups.has(uid)) {
    renderPopupMessages(uid);
    return;
  }
}

function showDMNotification(text) {
  const toast = document.createElement('div');
  toast.className = 'dm-toast';
  toast.textContent = `💬 ${text}`;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Өрөөний урилгын notification
function showRoomInvite(fromUsername, roomId, roomName) {
  const existing = document.getElementById('room-invite-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'room-invite-toast';
  toast.className = 'invite-toast';
  toast.innerHTML = `
    <div class="invite-toast-title">📨 Өрөөнд урилаа</div>
    <div style="font-size:0.83rem">${escHtml(fromUsername)}: <b>${escHtml(roomName)}</b></div>
    <div class="invite-toast-btns">
      <button id="invite-accept-btn" class="btn btn-primary btn-sm">Нэгдэх</button>
      <button id="invite-decline-btn" class="btn btn-sm btn-secondary">Татгалзах</button>
    </div>
  `;
  document.body.appendChild(toast);

  document.getElementById('invite-accept-btn').onclick = async () => {
    toast.remove();
    try {
      await window.api.joinRoom(roomId, null);
      // Өрөөний мэдээллийг авах шаардлагатай — энгийн байдлаар redirect
      const rooms = await window.api.getRooms();
      const room  = rooms.find(r => String(r.id) === String(roomId));
      if (room) enterRoom(room.id, room.name, room.game_type, false, room.host_id);
    } catch (err) {
      showDMNotification(`Нэгдэхэд алдаа: ${err.message}`);
    }
  };
  document.getElementById('invite-decline-btn').onclick = () => toast.remove();
  setTimeout(() => { if (document.getElementById('room-invite-toast') === toast) toast.remove(); }, 30000);
}

// ── Нийгмийн өгөгдөл ачаалах ──────────────────────────────
async function loadSocialData() {
  try {
    [myFriends, pendingRequests, blockedUsers] = await Promise.all([
      window.api.getFriends().catch(() => []),
      window.api.getPendingRequests().catch(() => []),
      window.api.getBlockedUsers().catch(() => []),
    ]);
    updatePendingBadge();
    renderFriendsTab();
    renderBlockedTab();
  } catch {}
}

function updatePendingBadge() {
  const badge = document.getElementById('pending-badge');
  if (!badge) return;
  if (pendingRequests.length > 0) {
    badge.textContent   = pendingRequests.length;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

// ── Найзуудын tab дүрслэх ─────────────────────────────────
function renderFriendsTab() {
  const pendingSection  = document.getElementById('pending-requests-section');
  const pendingList     = document.getElementById('pending-requests-list');
  const onlineList      = document.getElementById('friends-online-list');
  const offlineList     = document.getElementById('friends-offline-list');
  const onlineLabel     = document.getElementById('friends-online-label');
  const offlineLabel    = document.getElementById('friends-offline-label');
  const noFriendsText   = document.getElementById('no-friends-text');
  if (!pendingList) return;

  // Хүлээгдэж буй хүсэлтүүд
  if (pendingRequests.length > 0) {
    pendingSection.style.display = 'block';
    pendingList.innerHTML = pendingRequests.map(p => `
      <li class="pending-item" data-id="${p.id}" data-username="${escHtml(p.username)}">
        <span class="dm-username">${escHtml(p.username)}</span>
        <div class="pending-actions">
          <button class="btn btn-sm btn-primary pending-accept-btn">✓</button>
          <button class="btn btn-sm btn-danger  pending-decline-btn">✕</button>
        </div>
      </li>
    `).join('');
    pendingList.querySelectorAll('.pending-accept-btn').forEach(btn => {
      const li = btn.closest('li');
      btn.addEventListener('click', () => acceptFriend(li.dataset.id, li.dataset.username));
    });
    pendingList.querySelectorAll('.pending-decline-btn').forEach(btn => {
      const li = btn.closest('li');
      btn.addEventListener('click', () => declineFriend(li.dataset.id));
    });
  } else {
    pendingSection.style.display = 'none';
  }

  const onlineFriends  = myFriends.filter(f => onlineUserIds.has(String(f.id)));
  const offlineFriends = myFriends.filter(f => !onlineUserIds.has(String(f.id)));
  const hasFriends     = myFriends.length > 0;
  if (noFriendsText) noFriendsText.style.display = (hasFriends || pendingRequests.length > 0) ? 'none' : 'block';

  if (onlineList) {
    onlineLabel.style.display = onlineFriends.length > 0 ? 'block' : 'none';
    onlineList.innerHTML = onlineFriends.map(f => friendItemHTML(f, true)).join('');
    bindFriendListEvents(onlineList);
  }
  if (offlineList) {
    offlineLabel.style.display = offlineFriends.length > 0 ? 'block' : 'none';
    offlineList.innerHTML = offlineFriends.map(f => friendItemHTML(f, false)).join('');
    bindFriendListEvents(offlineList);
  }
}

function friendItemHTML(f, isOnline) {
  const dotClass = isOnline ? 'dm-status-dot' : 'dm-status-dot offline';
  // Tier badge — Discord серверийн Tier ангилал шиг найзыг Tier-ээр нь ялгаж харуулна
  const tier = f.tierbot_tier ? String(f.tierbot_tier).trim() : '';
  const major = tier ? (tier.split('-')[0].replace(/[^0-9]/g, '') || '0') : '';
  const tierBadge = tier
    ? `<span class="friend-tier friend-tier-${escHtml(major)}" title="Tier ${escHtml(tier)}">${escHtml(tier)}</span>`
    : '';
  return `<li data-id="${f.id}" data-username="${escHtml(f.username)}">
    <span class="${dotClass}"></span>
    ${tierBadge}
    <span class="dm-username">${escHtml(f.username)}</span>
    ${isOnline ? `<button class="btn btn-sm dm-btn friend-dm-btn">DM</button>` : ''}
    <button class="btn btn-sm btn-danger-soft remove-btn friend-remove-btn" title="Найзаас хасах">✕</button>
  </li>`;
}

function bindFriendListEvents(ul) {
  ul.querySelectorAll('.friend-dm-btn').forEach(btn => {
    const li = btn.closest('li');
    btn.addEventListener('click', e => { e.stopPropagation(); openDM(li.dataset.id, li.dataset.username); });
  });
  ul.querySelectorAll('.friend-remove-btn').forEach(btn => {
    const li = btn.closest('li');
    btn.addEventListener('click', e => { e.stopPropagation(); removeFriendClick(li.dataset.id, li.dataset.username); });
  });
}

async function acceptFriend(fromId, fromUsername) {
  try {
    await window.api.acceptFriendRequest(fromId);
    pendingRequests = pendingRequests.filter(p => String(p.id) !== String(fromId));
    if (!myFriends.find(f => String(f.id) === String(fromId))) {
      myFriends.push({ id: fromId, username: fromUsername, avatar_url: null });
    }
    updatePendingBadge();
    renderFriendsTab();
  } catch (err) { showToast(err.message, 'error'); }
}

async function declineFriend(fromId) {
  try {
    await window.api.declineFriendRequest(fromId);
    pendingRequests = pendingRequests.filter(p => String(p.id) !== String(fromId));
    updatePendingBadge();
    renderFriendsTab();
  } catch (err) { showToast(err.message, 'error'); }
}

async function removeFriendClick(friendId, friendName) {
  if (!await showConfirm('Найз хасах', `${friendName}-г найзуудаас хасах уу?`)) return;
  try {
    await window.api.removeFriend(friendId);
    myFriends = myFriends.filter(f => String(f.id) !== String(friendId));
    renderFriendsTab();
    renderOnlineUsersFromCache();
  } catch (err) { showToast(err.message, 'error'); }
}

// ── Найзуудын тусдаа цонх горим ──────────────────────────
async function initFriendsWindowMode() {
  // Нийгмийн мэдээлэл ачаалах
  try {
    const [friends, pending, blocked] = await Promise.all([
      window.api.getFriends(),
      window.api.getPendingRequests(),
      window.api.getBlockedUsers(),
    ]);
    myFriends = friends || [];
    pendingRequests = pending || [];
    blockedUsers = blocked || [];
  } catch {}
  renderFriendsWindow();
}

function renderFriendsWindow() {
  const pendingSection = document.getElementById('fw-pending-section');
  const pendingList    = document.getElementById('fw-pending-list');
  const onlineList     = document.getElementById('fw-online-list');
  const offlineList    = document.getElementById('fw-offline-list');
  const onlineLabel    = document.getElementById('fw-online-label');
  const offlineLabel   = document.getElementById('fw-offline-label');
  const noFriends      = document.getElementById('fw-no-friends');
  if (!onlineList) return;

  // Хүсэлтүүд
  if (pendingRequests.length > 0) {
    pendingSection.style.display = 'block';
    pendingList.innerHTML = pendingRequests.map(p => `
      <li class="pending-item" data-id="${p.id}" data-username="${escHtml(p.username)}">
        <span class="dm-username clickable-name" data-user-id="${p.id}">${escHtml(p.username)}</span>
        <div class="pending-actions">
          <button class="btn btn-sm btn-primary pending-accept-btn">✓</button>
          <button class="btn btn-sm btn-danger pending-decline-btn">✕</button>
        </div>
      </li>
    `).join('');
    pendingList.querySelectorAll('.pending-accept-btn').forEach(btn => {
      const li = btn.closest('li');
      btn.addEventListener('click', () => acceptFriend(li.dataset.id, li.dataset.username));
    });
    pendingList.querySelectorAll('.pending-decline-btn').forEach(btn => {
      const li = btn.closest('li');
      btn.addEventListener('click', () => declineFriend(li.dataset.id));
    });
  } else {
    pendingSection.style.display = 'none';
  }

  const onlineFriends  = myFriends.filter(f => onlineUserIds.has(String(f.id)));
  const offlineFriends = myFriends.filter(f => !onlineUserIds.has(String(f.id)));
  noFriends.style.display = myFriends.length > 0 || pendingRequests.length > 0 ? 'none' : 'block';

  onlineLabel.style.display = onlineFriends.length > 0 ? 'block' : 'none';
  onlineList.innerHTML = onlineFriends.map(f => fwFriendItem(f, true)).join('');
  bindFwEvents(onlineList);

  offlineLabel.style.display = offlineFriends.length > 0 ? 'block' : 'none';
  offlineList.innerHTML = offlineFriends.map(f => fwFriendItem(f, false)).join('');
  bindFwEvents(offlineList);
}

function fwFriendItem(f, isOnline) {
  const dot = isOnline ? 'dm-status-dot' : 'dm-status-dot offline';
  // GarenaSystem гишүүн бол харагдах нэр = "Tier Nickname" (жиш "3-1 Вито Корлеон").
  // data-username нь DM/mention-д хэрэгтэй тул ТҮҮХИЙ username хэвээр үлдэнэ.
  const displayName = escHtml(withTier(f.username, f.tierbot_tier));
  return `<li data-id="${f.id}" data-username="${escHtml(f.username)}">
    <span class="${dot}"></span>
    <span class="dm-username clickable-name" data-user-id="${f.id}">${displayName}</span>
    ${isOnline ? '<button class="btn btn-sm dm-btn fw-dm-btn">DM</button>' : ''}
    <button class="btn btn-sm fw-profile-btn" title="Профайл">👤</button>
    <button class="btn btn-sm btn-danger-soft fw-remove-btn" title="Хасах">✕</button>
  </li>`;
}

function bindFwEvents(ul) {
  ul.querySelectorAll('.fw-dm-btn').forEach(btn => {
    const li = btn.closest('li');
    btn.addEventListener('click', e => { e.stopPropagation(); openDM(li.dataset.id, li.dataset.username); });
  });
  ul.querySelectorAll('.fw-profile-btn').forEach(btn => {
    const li = btn.closest('li');
    btn.addEventListener('click', e => { e.stopPropagation(); openUserProfile(li.dataset.id); });
  });
  ul.querySelectorAll('.fw-remove-btn').forEach(btn => {
    const li = btn.closest('li');
    btn.addEventListener('click', e => { e.stopPropagation(); removeFriendClick(li.dataset.id, li.dataset.username); });
  });
  ul.querySelectorAll('.clickable-name').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); openUserProfile(el.dataset.userId); });
  });
}

// ── Хаасан хэрэглэгчдийн tab дүрслэх ─────────────────────
function renderBlockedTab() {
  const list = document.getElementById('blocked-users-list');
  if (!list) return;
  if (blockedUsers.length === 0) {
    list.innerHTML = '<li class="empty-text" style="padding:12px;font-size:0.8rem">Хаасан хэрэглэгч байхгүй</li>';
    return;
  }
  list.innerHTML = blockedUsers.map(u => `
    <li data-id="${u.id}" data-username="${escHtml(u.username)}">
      <span class="dm-username">${escHtml(u.username)}</span>
      <button class="btn btn-sm unblock-btn">Нээх</button>
    </li>
  `).join('');

  list.querySelectorAll('.unblock-btn').forEach(btn => {
    const li = btn.closest('li');
    btn.addEventListener('click', e => {
      e.stopPropagation();
      unblockUserClick(li.dataset.id, li.dataset.username);
    });
  });
}

async function blockUserClick(targetId, targetName) {
  if (!await showConfirm('Хэрэглэгч хаах', `${targetName}-г хаах уу? Найзлалт устгагдана.`)) return;
  try {
    await window.api.blockUser(targetId);
    myFriends       = myFriends.filter(f => String(f.id) !== String(targetId));
    pendingRequests = pendingRequests.filter(p => String(p.id) !== String(targetId));
    if (!blockedUsers.find(b => String(b.id) === String(targetId))) {
      blockedUsers.push({ id: targetId, username: targetName, avatar_url: null });
    }
    updatePendingBadge();
    renderFriendsTab();
    renderBlockedTab();
    renderOnlineUsersFromCache();
  } catch (err) { showToast(err.message, 'error'); }
}

async function unblockUserClick(targetId, targetName) {
  if (!await showConfirm('Хаалт нээх', `${targetName}-г хаалтаас гаргах уу?`)) return;
  try {
    await window.api.unblockUser(targetId);
    blockedUsers = blockedUsers.filter(b => String(b.id) !== String(targetId));
    renderBlockedTab();
    renderOnlineUsersFromCache();
  } catch (err) { showToast(err.message, 'error'); }
}

async function addFriendClick(targetId, targetName) {
  try {
    await window.api.sendFriendRequest(targetId);
    showDMNotification(`${targetName}-д найз хүсэлт илгээлээ`);
    renderOnlineUsersFromCache();
  } catch (err) { showToast(err.message || 'Найз хүсэлт илгээхэд алдаа гарлаа', 'error'); }
}

function renderDMUsersBadges() {
  const list = document.getElementById('dm-users-list');
  if (!list) return;
  list.querySelectorAll('[data-user-id]').forEach(li => {
    const uid   = li.dataset.userId;
    const badge = li.querySelector('.dm-unread');
    if (!badge) return;
    const unread = dmConversations[uid]?.unread || 0;
    if (unread > 0) {
      badge.textContent    = unread;
      badge.style.display  = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  });
}

// DM popup cleanup (зөвхөн үндсэн цонхонд)
if (!isDMMode()) {
  window.addEventListener('beforeunload', () => {
    activePopups.forEach((state, uid) => {
      if (state.isTyping && socket) {
        socket.emit('typing:stop', { toUserId: uid });
      }
    });
  });
  // DM цонх хаагдахад unread шинэчлэх
  window.api.onDMWindowClosed(() => loadUnreadDMCounts());
}

// ── Онлайн тоглогчид ─────────────────────────────────────
let _cachedOnlineUsers = [];

function renderOnlineUsers(users) {
  _cachedOnlineUsers = users;
  const countEl = document.getElementById('online-count');
  const total   = users.length;

  if (countEl) countEl.textContent = total;

  // Онлайн tab тоо шинэчлэх
  const onlineBadge = document.getElementById('dm-online-badge');
  const others = users.filter(u => {
    const uid = typeof u === 'object' ? String(u.userId) : null;
    return uid && uid !== String(currentUser?.id);
  });
  if (onlineBadge) onlineBadge.textContent = others.length;

  renderOnlineTab(others);
}

function renderOnlineUsersFromCache() {
  renderOnlineUsers(_cachedOnlineUsers);
}

function renderOnlineTab(others) {
  const dmList = document.getElementById('dm-users-list');
  if (!dmList) return;

  if (others.length === 0) {
    dmList.innerHTML = '<li class="empty-text" style="padding:12px;font-size:0.8rem">Онлайн хэрэглэгч байхгүй</li>';
    return;
  }

  const blockedIds = new Set(blockedUsers.map(b => String(b.id)));
  const friendIds  = new Set(myFriends.map(f => String(f.id)));

  dmList.innerHTML = others.map(u => {
    const uid    = typeof u === 'object' ? String(u.userId) : '';
    const uname  = typeof u === 'object' ? u.username : u;
    const utier  = typeof u === 'object' ? u.tier : null;
    const status = typeof u === 'object' ? (u.status || 'online') : 'online';
    const unread = dmConversations[uid]?.unread || 0;
    const badge  = `<span class="dm-unread" style="${unread > 0 ? '' : 'display:none'}">${unread}</span>`;

    // Статус badge
    const statusBadge = status === 'in_room'
      ? `<span class="status-in-room">🟡 Өрөөнд</span>`
      : status === 'in_game'
      ? `<span class="status-in-game">🔴 Тоглоомд</span>`
      : ``;

    const isBlocked = blockedIds.has(uid);
    const isFriend  = friendIds.has(uid);

    let actionBtns;
    if (isBlocked) {
      actionBtns = `<span class="dm-blocked-tag">Хаасан</span>`;
    } else {
      const friendBtn = isFriend
        ? ''
        : `<button class="btn btn-sm btn-add-friend add-friend-btn" title="Найз нэмэх">+</button>`;
      // Урих товч: зөвхөн та өрөөнд байгаа үед
      const inviteBtn = currentRoom
        ? `<button class="btn btn-sm invite-btn" title="Өрөөнд урих">📨</button>`
        : '';
      actionBtns = `
        <button class="btn btn-sm dm-btn dm-open-btn">DM</button>
        ${friendBtn}
        ${inviteBtn}
        <button class="btn btn-sm btn-block-user block-user-btn" title="Хаах">🚫</button>
      `;
    }

    return `<li data-user-id="${uid}" data-username="${escHtml(uname)}" class="online-user-item">
      <span class="dm-status-dot"></span>
      <span class="dm-username">${escHtml(withTier(uname, utier))}</span>
      ${statusBadge}
      ${badge}
      <div class="dm-action-btns">${actionBtns}</div>
    </li>`;
  }).join('');

  dmList.querySelectorAll('.online-user-item').forEach(li => {
    const uid   = li.dataset.userId;
    const uname = li.dataset.username;

    li.addEventListener('click', () => openDM(uid, uname));

    const dmBtn = li.querySelector('.dm-open-btn');
    if (dmBtn) dmBtn.addEventListener('click', e => { e.stopPropagation(); openDM(uid, uname); });

    const addBtn = li.querySelector('.add-friend-btn');
    if (addBtn) addBtn.addEventListener('click', e => { e.stopPropagation(); addFriendClick(uid, uname); });

    const blockBtn = li.querySelector('.block-user-btn');
    if (blockBtn) blockBtn.addEventListener('click', e => { e.stopPropagation(); blockUserClick(uid, uname); });

    const inviteBtn = li.querySelector('.invite-btn');
    if (inviteBtn) inviteBtn.addEventListener('click', e => {
      e.stopPropagation();
      if (currentRoom && socket) {
        socket.emit('room:invite', {
          toUserId: uid,
          roomId: currentRoom.id,
          roomName: currentRoom.name,
        });
        showDMNotification(`${uname}-д урилга илгээлээ`);
      }
    });
  });
}

// ── Ranking ───────────────────────────────────────────────
let rankingPage = 1;
let rankingSort = 'rating';

async function loadRanking(page = rankingPage, sort = rankingSort) {
  rankingPage = page;
  rankingSort = sort;
  const tbody    = document.getElementById('ranking-body');
  const pagDiv   = document.getElementById('ranking-pagination');
  const sortSel  = document.getElementById('ranking-sort');
  if (sortSel) sortSel.value = sort;
  tbody.innerHTML = Array(5).fill('<tr><td colspan="7"><div class="skeleton" style="height:32px;border-radius:6px;margin:4px 0"></div></td></tr>').join('');
  try {
    const currentUser = await window.api.getUser();
    const data = await window.api.getRanking({ sort, page });
    const players = data?.players || [];
    const totalPages = data?.totalPages || 0;
    const offset = (page - 1) * 20;

    if (!players.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-text">Одоогоор мэдээлэл байхгүй</td></tr>';
      pagDiv.classList.add('hidden');
      return;
    }

    tbody.innerHTML = players.map((p, i) => {
      const rank = offset + i + 1;
      const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank;
      const isSelf = currentUser && String(p.id) === String(currentUser.id);
      const tier = p.tierbot_tier || '-';
      const rating = Number(p.tierbot_rating || 0);
      return `<tr class="ranking-row${isSelf ? ' ranking-self' : ''}" data-userid="${escHtml(p.id)}" data-username="${escHtml(p.username)}" style="cursor:pointer">
        <td>${medal}</td>
        <td>${escHtml(p.username)}</td>
        <td>${escHtml(tier)}</td>
        <td>${rating ? rating.toLocaleString() : '-'}</td>
        <td style="color:var(--green)">${p.wins}</td>
        <td style="color:var(--red)">${p.losses}</td>
        <td>${p.winrate}%</td>
      </tr>`;
    }).join('');

    // Pagination
    if (totalPages > 1) {
      pagDiv.classList.remove('hidden');
      pagDiv.innerHTML = renderPagination(page, totalPages, (p) => loadRanking(p, sort));
    } else {
      pagDiv.classList.add('hidden');
    }

    // Row click → profile popup
    tbody.querySelectorAll('.ranking-row').forEach(row => {
      row.addEventListener('click', () => openUserProfile(Number(row.dataset.userid)));
    });
  } catch {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-text">Серверт холбогдож чадсангүй</td></tr>';
    pagDiv.classList.add('hidden');
  }
}

function renderPagination(current, total, onPage) {
  let html = '';
  if (current > 1)
    html += `<button class="btn btn-sm pagination-btn" data-page="${current - 1}">‹</button>`;
  html += `<span class="pagination-info">${current} / ${total}</span>`;
  if (current < total)
    html += `<button class="btn btn-sm pagination-btn" data-page="${current + 1}">›</button>`;

  setTimeout(() => {
    document.querySelectorAll('.pagination-btn').forEach(btn => {
      btn.addEventListener('click', () => onPage(Number(btn.dataset.page)));
    });
  }, 0);
  return html;
}

// ── User Profile Popup ────────────────────────────────────
async function openUserProfile(userId) {
  const modal = document.getElementById('user-profile-modal');
  const currentUser = await window.api.getUser();
  modal.classList.remove('hidden');

  // Reset
  document.getElementById('popup-username').textContent = '...';
  document.getElementById('popup-wins').textContent     = '';
  document.getElementById('popup-losses').textContent   = '';
  document.getElementById('popup-winrate').textContent  = '';
  document.getElementById('popup-history-body').innerHTML = '<tr><td colspan="3" class="empty-text">Ачааллаж байна...</td></tr>';
  document.getElementById('popup-friend-btn-wrap').innerHTML = '';
  document.getElementById('popup-stats')?.classList.add('hidden');

  const avatarEl = document.getElementById('popup-avatar');
  avatarEl.src = ''; avatarEl.style.display = 'none';

  try {
    const [stats, history] = await Promise.all([
      window.api.getPlayerStatsById(userId),
      window.api.getGameHistory(userId, 1),
    ]);

    document.getElementById('popup-username').textContent = withTier(stats.username, stats.tierbot_tier);
    document.getElementById('popup-wins').textContent     = `${stats.wins} хожил`;
    document.getElementById('popup-losses').textContent   = `${stats.losses} хожигдол`;
    document.getElementById('popup-winrate').textContent  = stats.winrate;
    if (stats.avatar_url) { avatarEl.src = stats.avatar_url; avatarEl.style.display = 'block'; }

    // Дундаж DotA статистик (платформ дээр тоглосон тоглолтууд)
    const st = stats.stats;
    const statsBox = document.getElementById('popup-stats');
    if (statsBox) {
      if (st && st.games > 0) {
        statsBox.classList.remove('hidden');
        document.getElementById('popup-avg-kda').textContent      = `${st.avg_kills ?? 0} / ${st.avg_deaths ?? 0} / ${st.avg_assists ?? 0}`;
        document.getElementById('popup-avg-creeps').textContent   = st.avg_creeps ?? 0;
        document.getElementById('popup-avg-denies').textContent   = st.avg_denies ?? 0;
        document.getElementById('popup-avg-neutrals').textContent = st.avg_neutrals ?? 0;
        document.getElementById('popup-avg-gold').textContent     = st.avg_gold ?? 0;
        document.getElementById('popup-games').textContent        = st.games;
      } else {
        statsBox.classList.add('hidden');
      }
    }

    const games = history?.games || [];
    const tbody = document.getElementById('popup-history-body');
    if (games.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-text">Тоглоом байхгүй</td></tr>';
    } else {
      tbody.innerHTML = games.slice(0, 5).map(g => {
        const date   = new Date(g.played_at).toLocaleDateString('mn-MN');
        const result = g.is_winner ? '<span style="color:var(--green)">Хожив</span>' : '<span style="color:var(--red)">Хожигдов</span>';
        return `<tr><td>${date}</td><td>${g.team}</td><td>${result}</td></tr>`;
      }).join('');
    }

    // Friend + DM buttons (don't show for self)
    if (currentUser && String(userId) !== String(currentUser.id)) {
      const wrap = document.getElementById('popup-friend-btn-wrap');
      // DM товч
      const dmBtn = document.createElement('button');
      dmBtn.className = 'btn btn-sm btn-primary';
      dmBtn.textContent = '💬 Мессеж';
      dmBtn.onclick = () => {
        openDM(userId, stats.username);
        modal.classList.add('hidden');
      };
      wrap.appendChild(dmBtn);
      // Найз товч
      const btn  = document.createElement('button');
      btn.className   = 'btn btn-sm btn-primary';
      btn.textContent = 'Найз болох';
      btn.onclick = async () => {
        try {
          await window.api.sendFriendRequest(userId);
          btn.textContent = '✓ Хүсэлт илгээгдлээ';
          btn.disabled = true;
        } catch {}
      };
      wrap.appendChild(btn);
    }
  } catch {
    document.getElementById('popup-username').textContent = 'Алдаа гарлаа';
  }
}

document.getElementById('btn-close-user-profile').onclick = () => {
  document.getElementById('user-profile-modal').classList.add('hidden');
};

// ── Profile ───────────────────────────────────────────────
let gameHistoryPage = 1;

// ── Rank систем ───────────────────────────────────────────
function getRank(wins) {
  if (wins >= 50) return { name: 'Diamond',  css: 'rank-diamond' };
  if (wins >= 30) return { name: 'Platinum', css: 'rank-platinum' };
  if (wins >= 15) return { name: 'Gold',     css: 'rank-gold' };
  if (wins >= 5)  return { name: 'Silver',   css: 'rank-silver' };
  return              { name: 'Bronze',   css: 'rank-bronze' };
}

async function loadProfile() {
  try {
    await window.api.refreshUser?.();
    const user = await window.api.getUser();
    if (!user) return;
    currentUser = { ...currentUser, ...user };
    setUserUI(currentUser);
    const displayName = userDisplayName(user) || user.username;
    const discordName = String(user.discord_username || user.discord_display_name || user.discord_global_name || '').trim();
    document.getElementById('profile-name').textContent  = displayName;
    document.getElementById('profile-email').textContent = user.email || '';
    const nameSourceEl = document.getElementById('profile-name-source');
    const nameNoteEl   = document.getElementById('profile-name-note');
    const hasDiscord   = Boolean(user.discord_id);
    nameSourceEl?.classList.toggle('hidden', !hasDiscord);
    nameNoteEl?.classList.add('hidden');
    const avatarEl = document.getElementById('profile-avatar');
    if (user.avatar_url) {
      avatarEl.src = user.avatar_url;
      avatarEl.style.display = 'block';
    } else {
      avatarEl.style.display = 'none';
    }

    const total   = (user.wins || 0) + (user.losses || 0);
    const winrate = total > 0 ? ((user.wins / total) * 100).toFixed(1) : '0';
    document.getElementById('stat-wins').textContent    = user.wins || 0;
    document.getElementById('stat-losses').textContent  = user.losses || 0;
    document.getElementById('stat-winrate').textContent = winrate + '%';

    // Rank badge
    const rank = getRank(user.wins || 0);
    const rankEl = document.getElementById('profile-rank');
    if (rankEl) {
      rankEl.className = `rank-badge ${rank.css}`;
      rankEl.textContent = rank.name;
    }

    const linkedEl   = document.getElementById('discord-linked');
    const linkBtnEl  = document.getElementById('btn-link-discord');
    const discNameEl = document.getElementById('discord-username');
    if (hasDiscord) {
      linkedEl.style.display  = 'flex';
      linkBtnEl.style.display = 'none';
      discNameEl.textContent  = `@${discordName || displayName}`;
    } else {
      linkedEl.style.display  = 'none';
      linkBtnEl.style.display = 'inline-flex';
    }

    // Тоглоомын түүх ачааллах
    gameHistoryPage = 1;
    await loadGameHistory(user.id, 1);
  } catch {}
}

async function loadGameHistory(userId, page) {
  gameHistoryPage = page;
  const tbody  = document.getElementById('game-history-body');
  const pagDiv = document.getElementById('game-history-pagination');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6" class="empty-text">Ачааллаж байна...</td></tr>';
  try {
    const data  = await window.api.getGameHistory(userId, page);
    const games = data?.games || [];

    if (games.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-text">Одоогоор тоглоом байхгүй</td></tr>';
      pagDiv.classList.add('hidden');
      return;
    }

    tbody.innerHTML = games.map(g => {
      const date     = new Date(g.played_at).toLocaleDateString('mn-MN');
      const result   = g.is_winner
        ? '<span style="color:var(--green)">Хожив</span>'
        : '<span style="color:var(--red)">Хожигдов</span>';
      const duration = g.duration_minutes ? `${g.duration_minutes} мин` : '—';
      return `<tr>
        <td>${date}</td>
        <td>${g.game_type || '—'}</td>
        <td>${g.room_name || '—'}</td>
        <td>${g.team}</td>
        <td>${result}</td>
        <td>${duration}</td>
      </tr>`;
    }).join('');

    if ((data.totalPages || 0) > 1) {
      pagDiv.classList.remove('hidden');
      pagDiv.innerHTML = renderPagination(page, data.totalPages, (p) => loadGameHistory(userId, p));
    } else {
      pagDiv.classList.add('hidden');
    }
  } catch {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-text">Серверт холбогдож чадсангүй</td></tr>';
  }
}

document.getElementById('btn-link-discord').onclick = () => window.api.linkDiscord();

// ── Discord салгах ────────────────────────────────────────
const btnUnlinkDiscord = document.getElementById('btn-unlink-discord');
if (btnUnlinkDiscord) {
  btnUnlinkDiscord.onclick = async () => {
    if (!await showConfirm('Discord салгах', 'Discord холболтыг салгахдаа итгэлтэй байна уу? Нэвтрэхэд нууц үг шаардлагатай болно.')) return;
    try {
      await window.api.unlinkDiscord();
      loadProfile();
    } catch (err) {
      showToast(err.message || 'Алдаа гарлаа', 'error');
    }
  };
}

// ── Нууц үг солих ─────────────────────────────────────────
document.getElementById('btn-change-password').onclick = async (e) => {
  const btn        = e.currentTarget;
  const oldPw      = document.getElementById('old-password').value;
  const newPw      = document.getElementById('new-password').value;
  const confirmPw  = document.getElementById('new-password-confirm').value;
  const errEl      = document.getElementById('pw-change-error');
  const successEl  = document.getElementById('pw-change-success');
  errEl.textContent = ''; successEl.textContent = '';

  if (!oldPw || !newPw || !confirmPw) { errEl.textContent = 'Бүх талбарыг бөглөнө үү'; return; }
  if (newPw !== confirmPw) { errEl.textContent = 'Шинэ нууц үг таарахгүй байна'; return; }
  if (newPw.length < 6) { errEl.textContent = 'Шинэ нууц үг хамгийн багадаа 6 тэмдэгт байна'; return; }

  btn.disabled = true; btn.textContent = 'Солж байна...';
  try {
    await window.api.changePassword(oldPw, newPw);
    successEl.textContent = '✓ Нууц үг амжилттай солигдлоо';
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('new-password-confirm').value = '';
  } catch (err) {
    errEl.textContent = err.message || 'Нууц үг солиход алдаа гарлаа';
  } finally {
    btn.disabled = false; btn.textContent = 'Солих';
  }
};

// Профайл зураг оруулах
const avatarUploadIconHtml = '<svg class="btn-icon-svg"><use href="#ico-camera"/></svg>';
function setAvatarUploadBusy(btn, isBusy) {
  btn.disabled = isBusy;
  btn.innerHTML = isBusy ? '<span class="avatar-upload-spinner"></span>' : avatarUploadIconHtml;
}

document.getElementById('btn-upload-avatar').onclick = async () => {
  const btn = document.getElementById('btn-upload-avatar');
  setAvatarUploadBusy(btn, true);
  try {
    const result = await window.api.uploadAvatar();
    if (result?.avatar_url) {
      document.getElementById('profile-avatar').src = result.avatar_url;
      document.getElementById('profile-avatar').style.display = 'block';
      // Header дахь avatar шинэчлэх
      const headerAv = document.getElementById('user-avatar');
      if (headerAv) { headerAv.src = result.avatar_url; headerAv.style.display = 'block'; }
      if (currentUser) currentUser.avatar_url = result.avatar_url;
    }
  } catch (err) {
    if (err.message) showToast(`Зураг оруулахад алдаа: ${err.message}`, 'error');
  } finally {
    setAvatarUploadBusy(btn, false);
  }
};

// ── Тохируулга ────────────────────────────────────────────
let configuredGames = []; // { id, name, path }

async function loadSettings() {
  try {
    const settings = await window.api.getSettings();
    configuredGames = settings.games || [];
    renderGamesList();
    populateRoomTypeSelect();
  } catch {}
  // Firewall тохиргоо хийгдсэн эсэх шалгах
  const firewallDone = localStorage.getItem('firewall_configured');
  const fwStatusEl = document.getElementById('firewall-status');
  if (!firewallDone && fwStatusEl) {
    fwStatusEl.textContent = 'Тохируулга хийгдээгүй — LAN тоглоом харагдахгүй байж магадгүй';
    fwStatusEl.style.color = 'var(--yellow, orange)';
  }
  // Cache хэмжээ харуулах
  try {
    const size = await window.api.getCacheSize();
    const el = document.getElementById('cache-size-info');
    if (el) {
      const mb = (size / 1024 / 1024).toFixed(1);
      el.textContent = `Cache хэмжээ: ${mb} MB`;
    }
  } catch {}

  // Мэдэгдлийн тохиргоо ачаалах
  const soundChk = document.getElementById('setting-sound');
  const notifChk = document.getElementById('setting-desktop-notif');
  if (soundChk) soundChk.checked = localStorage.getItem('sound_enabled') !== 'false';
  if (notifChk) notifChk.checked = localStorage.getItem('desktop_notif_enabled') !== 'false';

  const tierbotUrl = document.getElementById('tierbot-source-url');
  if (tierbotUrl && !tierbotUrl.value) {
    tierbotUrl.value = localStorage.getItem('tierbot_source_url') || '';
  }
}

// Settings доторх category menu
document.querySelectorAll('[data-settings-section]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.settingsSection;
    document.querySelectorAll('[data-settings-section]').forEach((item) => {
      const active = item === btn;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      const active = panel.dataset.settingsPanel === section;
      panel.classList.toggle('active', active);
      panel.setAttribute('aria-hidden', active ? 'false' : 'true');
    });
  });
});

const TIERBOT_URL_KEY = 'tierbot_source_url';

function getTierBotSourceUrl() {
  const input = document.getElementById('tierbot-source-url');
  const value = (input?.value || localStorage.getItem(TIERBOT_URL_KEY) || '').trim();
  if (input && value) input.value = value;
  return value;
}

function setTierBotStatus(message, kind = '') {
  const el = document.getElementById('tierbot-sync-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = kind === 'success' ? 'var(--green)' : kind === 'error' ? 'var(--red)' : '';
}

async function syncTierBotData(triggerBtn = null) {
  const sourceUrl = getTierBotSourceUrl();
  const buttons = [
    document.getElementById('btn-tierbot-sync'),
    document.getElementById('btn-rank-tierbot-sync'),
  ].filter(Boolean);
  const originals = new Map(buttons.map((btn) => [btn, btn.innerHTML]));
  buttons.forEach((btn) => {
    btn.disabled = true;
    btn.innerHTML = 'Татаж байна...';
  });
  setTierBotStatus('TierSystem дата татаж байна...');

  try {
    if (sourceUrl) localStorage.setItem(TIERBOT_URL_KEY, sourceUrl);
    const result = await window.api.syncTierBot({ source_url: sourceUrl || undefined });
    const message = `Импорт: ${result.imported || 0}, шинэ: ${result.created || 0}, шинэчилсэн: ${result.updated || 0}, алгассан: ${result.skipped || 0}`;
    setTierBotStatus(message, 'success');
    showToast(`TierSystem sync амжилттай. ${message}`, 'success');
    await loadRanking(1, 'rating');
  } catch (err) {
    const message = err?.message || String(err);
    setTierBotStatus(message, 'error');
    showToast(`TierSystem sync алдаа: ${message}`, 'error', 5000);
  } finally {
    buttons.forEach((btn) => {
      btn.disabled = false;
      btn.innerHTML = originals.get(btn);
    });
    if (triggerBtn) triggerBtn.focus();
  }
}

document.getElementById('btn-tierbot-save-url')?.addEventListener('click', () => {
  const sourceUrl = getTierBotSourceUrl();
  if (sourceUrl) {
    localStorage.setItem(TIERBOT_URL_KEY, sourceUrl);
    setTierBotStatus('TierBot URL хадгалагдлаа.', 'success');
    showToast('TierBot URL хадгалагдлаа', 'success');
  } else {
    localStorage.removeItem(TIERBOT_URL_KEY);
    setTierBotStatus('URL хоосон тул server env TIERBOT_STATS_URL ашиглана.');
  }
});
document.getElementById('btn-tierbot-sync')?.addEventListener('click', (e) => syncTierBotData(e.currentTarget));
document.getElementById('btn-rank-tierbot-sync')?.addEventListener('click', (e) => syncTierBotData(e.currentTarget));

// Мэдэгдлийн тохиргоо toggle
document.getElementById('setting-sound')?.addEventListener('change', (e) => {
  localStorage.setItem('sound_enabled', e.target.checked ? 'true' : 'false');
});
document.getElementById('setting-desktop-notif')?.addEventListener('change', (e) => {
  localStorage.setItem('desktop_notif_enabled', e.target.checked ? 'true' : 'false');
  if (e.target.checked && Notification.permission !== 'granted') {
    Notification.requestPermission();
  }
});
document.getElementById('btn-test-sound')?.addEventListener('click', () => {
  playSound('dm');
});

// Сүлжээ / Firewall тохируулах товч
document.getElementById('btn-setup-firewall')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-setup-firewall');
  const statusEl = document.getElementById('firewall-status');
  btn.disabled = true;
  btn.textContent = 'Тохируулж байна...';
  if (statusEl) statusEl.textContent = 'Windows UAC зөвшөөрөл асууж байна...';
  try {
    const result = await window.api.setupFirewall();
    if (result.firewall && result.metric) {
      showToast('Firewall + сүлжээ амжилттай тохируулагдлаа!', 'success', 5000);
      localStorage.setItem('firewall_configured', '1');
      if (statusEl) statusEl.textContent = 'Амжилттай тохируулагдлаа';
      if (statusEl) statusEl.style.color = 'var(--green)';
    } else {
      showToast('Тохируулж чадсангүй — UAC зөвшөөрөгдөөгүй байж магадгүй', 'error', 5000);
      if (statusEl) statusEl.textContent = 'Алдаа: UAC зөвшөөрөл шаардлагатай';
      if (statusEl) statusEl.style.color = 'var(--red)';
    }
  } catch (err) {
    showToast(`Алдаа: ${err.message}`, 'error');
    if (statusEl) statusEl.textContent = `Алдаа: ${err.message}`;
  }
  btn.disabled = false;
  btn.innerHTML = '<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> LAN зөвшөөрөл тохируулах';
});

// Cache цэвэрлэх товч
document.getElementById('btn-clear-cache')?.addEventListener('click', async () => {
  if (!await showConfirm('Cache цэвэрлэх', 'Cache цэвэрлэх үү? Апп дахин ачаалагдана.')) return;
  const btn = document.getElementById('btn-clear-cache');
  btn.disabled = true;
  btn.textContent = 'Цэвэрлэж байна...';
  try {
    await window.api.clearCache();
    showToast('Cache цэвэрлэгдлээ. Дахин ачаалж байна...', 'success');
    setTimeout(() => { window.api.relaunchApp?.() || location.reload(); }, 1500);
  } catch (err) {
    showToast('Алдаа: ' + (err?.message || String(err)), 'error');
    btn.disabled = false;
    btn.innerHTML = '<svg class="btn-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Cache цэвэрлэх';
  }
});

function renderGamesList() {
  const ul = document.getElementById('games-list');
  if (!ul) return;
  if (configuredGames.length === 0) {
    ul.innerHTML = '<li class="empty-text" style="padding:10px 0;font-size:0.82rem">Тоглоом нэмэгдээгүй байна</li>';
    return;
  }
  ul.innerHTML = configuredGames.map(g => `
    <li class="game-item" data-game-id="${escHtml(g.id)}">
      <div class="game-item-info">
        <span class="game-item-name">${escHtml(g.name)}</span>
        <span class="game-item-path hint">${escHtml(g.path)}</span>
      </div>
      <button class="btn btn-sm btn-danger remove-game-btn">Устгах</button>
    </li>
  `).join('');

  ul.querySelectorAll('.remove-game-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.closest('li').dataset.gameId;
      removeGameClick(id);
    });
  });
}

function populateRoomTypeSelect() {
  const sel = document.getElementById('room-type');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = configuredGames.length
    ? configuredGames.map(g => `<option value="${escHtml(g.name)}">${escHtml(g.name)}</option>`).join('')
    : '<option value="">— Эхлээд тоглоом нэмнэ үү —</option>';
  if (current && [...sel.options].some(o => o.value === current)) sel.value = current;
}

// Тоглоом нэмэх — exe сонгоход файлын нэрийг автоматаар авна
document.getElementById('btn-add-game').onclick = async () => {
  const btn = document.getElementById('btn-add-game');
  btn.disabled = true;
  btn.textContent = '...';
  try {
    // 1. Exe сонгох
    const result = await window.api.selectGameExe();
    if (!result) return; // хэрэглэгч цуцаллаа

    // 2. Тоглоом нэмэх
    const games = await window.api.addGame({ name: result.suggestedName, path: result.path });
    configuredGames = games || [];
    renderGamesList();
    populateRoomTypeSelect();
  } catch (err) {
    showToast('Тоглоом нэмэхэд алдаа гарлаа: ' + (err?.message || String(err)), 'error');
    console.error('addGame error:', err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<svg class="btn-icon-svg"><use href="#ico-plus"/></svg> Тоглоом нэмэх';
  }
};

async function removeGameClick(id) {
  if (!await showConfirm('Тоглоом устгах', 'Энэ тоглоомыг жагсаалтаас устгах уу?')) return;
  try {
    configuredGames = await window.api.removeGame(id);
    renderGamesList();
    populateRoomTypeSelect();
  } catch (err) { showToast(err.message, 'error'); }
}

// ── Тоглоом дуусах ───────────────────────────────────────
function showGameResult(data) {
  const modal = document.getElementById('result-modal');
  const content = document.getElementById('result-content');
  if (!modal || !content) return;

  // Алдаатай бол
  if (data.error) {
    content.innerHTML = `
      <h2>⚠️ Тоглоом дууслаа</h2>
      <p class="result-error">${data.error}</p>
      <button type="button" id="btn-close-result" class="btn btn-primary">Хаах</button>
    `;
    modal.style.display = 'flex';
    document.getElementById('btn-close-result').onclick = () => { modal.style.display = 'none'; };
    return;
  }

  const winners = (data.players || []).filter(p => p.team === data.winner_team);
  const losers  = (data.players || []).filter(p => p.team !== data.winner_team);

  const raceEmoji = { Human: '🏰', Orc: '⚔️', 'Night Elf': '🌙', NightElf: '🌙', Undead: '💀', Random: '🎲' };

  const renderPlayers = (list, isWinner) => list.map(p => {
    const race = raceEmoji[p.race] || '';
    const matched = p.user_id ? '✓' : '';
    return `<div class="result-player ${isWinner ? 'winner' : 'loser'}">
      <span class="result-player-name">${race} ${p.name} ${matched}</span>
      ${p.apm ? `<span class="result-player-apm">${p.apm} APM</span>` : ''}
    </div>`;
  }).join('');

  const savedMsg = data.saved
    ? '<p class="result-saved">✅ Статистик амжилттай хадгалагдлаа</p>'
    : data.saveError
    ? `<p class="result-save-error">⚠️ ${data.saveError}</p>`
    : '';

  content.innerHTML = `
    <h2>🏆 Тоглоом дууслаа!</h2>
    <p class="result-duration">Үргэлжлэлт: ${data.duration_minutes || 0} мин</p>
    <div class="result-teams">
      <div class="result-team result-team-win">
        <h3>🏆 Хожсон</h3>
        ${renderPlayers(winners, true)}
      </div>
      <div class="result-team result-team-lose">
        <h3>💀 Хожигдсон</h3>
        ${renderPlayers(losers, false)}
      </div>
    </div>
    ${savedMsg}
    <button type="button" id="btn-close-result" class="btn btn-primary" style="margin-top:12px">Хаах</button>
  `;

  modal.style.display = 'flex';
  document.getElementById('btn-close-result').onclick = () => { modal.style.display = 'none'; };
}

// ── Update notification bar ───────────────────────────────
function showUpdateBar(message, showInstallBtn, percent = null) {
  let bar = document.getElementById('update-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.style.cssText = `
      position:fixed; top:0; left:0; right:0; z-index:9999;
      background:#1565c0; color:#fff; font-size:13px;
      display:flex; align-items:center; justify-content:center; gap:12px;
      padding:8px 16px; box-shadow:0 2px 8px rgba(0,0,0,.4);
    `;
    document.body.appendChild(bar);
  }
  const progressHtml = (percent !== null)
    ? `<span style="background:rgba(255,255,255,.25);border-radius:8px;width:120px;height:6px;display:inline-block;overflow:hidden;vertical-align:middle">
         <span style="display:block;height:100%;width:${percent}%;background:#90caf9;transition:width .3s"></span>
       </span>`
    : '';
  const btnHtml = showInstallBtn
    ? `<button id="btn-install-update" style="
         background:#fff;color:#1565c0;border:none;border-radius:6px;
         padding:4px 14px;font-weight:700;cursor:pointer;font-size:13px;">
         ↺ Дахин эхлүүлэх
       </button>`
    : '';
  bar.innerHTML = `<span>🔄 ${message}</span>${progressHtml}${btnHtml}`;
  if (showInstallBtn) {
    const btn = bar.querySelector('#btn-install-update');
    if (btn) btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Суулгаж байна...';
      try {
        await window.api.installUpdate();
      } catch (e) {
        btn.disabled = false;
        btn.textContent = '↺ Дахин эхлүүлэх';
        showToast('Алдаа: ' + (e?.message || 'Шинэчлэл суулгах боломжгүй'), 'error', 5000);
      }
    });
  }
}

// ── Toast notifications ───────────────────────────────────
function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

// ── Confirm modal ─────────────────────────────────────────
function showConfirm(title, message) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const messageEl = document.getElementById('confirm-message');
    const okBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');
    if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
      resolve(window.confirm(message || title));
      return;
    }

    titleEl.textContent   = title;
    messageEl.textContent = message;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    let settled = false;
    const cleanup = (result) => {
      if (settled) return;
      settled = true;
      modal.style.display = 'none';
      modal.classList.add('hidden');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onBackdrop);
      document.removeEventListener('keydown', onKeydown, true);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => {
      if (e.target === modal) cleanup(false);
    };
    const onKeydown = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      cleanup(false);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onBackdrop);
    document.addEventListener('keydown', onKeydown, true);
    okBtn.focus({ preventScroll: true });
  });
}

// ── withLoading helper ────────────────────────────────────
function withLoading(button, asyncFn) {
  return async (...args) => {
    if (button.disabled) return;
    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = '⏳ ...';
    try {
      await asyncFn(...args);
    } catch (e) {
      showToast(e.message || 'Алдаа гарлаа', 'error');
    } finally {
      button.disabled = false;
      button.textContent = originalText;
    }
  };
}

// ── Skeleton helpers ──────────────────────────────────────
function renderRoomsSkeleton() {
  return `
    <div class="room-data-grid">
      <div class="room-grid-header">
        <div>STA</div><div>Өрөө</div><div>Game</div><div>Mode</div>
        <div>Host</div><div>Players</div><div>Net</div><div></div>
      </div>
      ${Array(3).fill('').map(() => `
        <div class="room-grid-row">
          <div class="room-cell"><span class="skeleton" style="display:block;height:20px;width:64px;"></span></div>
          <div class="room-cell"><span class="skeleton" style="display:block;height:18px;width:82%;"></span></div>
          <div class="room-cell"><span class="skeleton" style="display:block;height:18px;width:70px;"></span></div>
          <div class="room-cell"><span class="skeleton" style="display:block;height:18px;width:42px;"></span></div>
          <div class="room-cell"><span class="skeleton" style="display:block;height:18px;width:80px;"></span></div>
          <div class="room-cell"><span class="skeleton" style="display:block;height:18px;width:52px;"></span></div>
          <div class="room-cell"><span class="skeleton" style="display:block;height:18px;width:34px;"></span></div>
          <div class="room-cell"><span class="skeleton" style="display:block;height:26px;width:72px;"></span></div>
        </div>
      `).join('')}
    </div>
  `;
}

// ── Холболтын төлөв ───────────────────────────────────────
function updateConnectionStatus(status) {
  const indicator = document.getElementById('connection-status');
  if (!indicator) return;
  indicator.className = `connection-status ${status}`;
  const label = {
    online:       '🟢 Холбогдсон',
    offline:      '🔴 Салгагдсан',
    reconnecting: '🟡 Дахин холбогдож байна...',
  }[status] || 'Холболтын төлөв тодорхойгүй';
  indicator.title = label;
  indicator.setAttribute('aria-label', label);
}

// ── Хэрэгслүүд ───────────────────────────────────────────
function escHtml(t) {
  // Хашилтыг ч escape хийнэ — attr="${escHtml(x)}" контекстээс салж гарахаас сэргийлнэ
  return String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Tier Nickname — Discord серверийн tier nickname шиг "3-1 Вито Корлеон" (tier prefix + нэр).
// Tier байхгүй бол зүгээр нэр. Буцаах утга нь ТҮҮХИЙ мөр — дуудагч escHtml хийнэ.
function withTier(name, tier) {
  const t = tier ? String(tier).trim() : '';
  const n = String(name == null ? '' : name);
  return t ? `${t} ${n}` : n;
}

// @mention parse: escHtml() дараа дуудна — аюулгүй HTML оруулна
function parseMentions(escapedText, triggerSound) {
  const myName = currentUser?.username;
  let mentionedMe = false;
  const result = escapedText.replace(/@(\w{2,20})/g, (match, name) => {
    const isMe = myName && name.toLowerCase() === myName.toLowerCase();
    if (isMe) mentionedMe = true;
    return `<span class="mention${isMe ? ' mention-me' : ''}">${match}</span>`;
  });
  if (mentionedMe && triggerSound) playSound('notify');
  return result;
}

// ── @mention autocomplete ────────────────────────────────
function setupMentionAutocomplete(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  let dropdown = null;
  let activeIdx = -1;
  let names = [];

  function getNames() {
    const set = new Set();
    // Өрөөний гишүүд
    if (currentRoom?.members) currentRoom.members.forEach(m => { if (m.name) set.add(m.name); });
    // Онлайн хэрэглэгчид
    const onlineEl = document.querySelectorAll('.online-user-item .online-user-name');
    onlineEl.forEach(el => { if (el.textContent) set.add(el.textContent.trim()); });
    // Өөрийгөө хасах
    if (currentUser?.username) set.delete(currentUser.username);
    return [...set];
  }

  function close() {
    if (dropdown) { dropdown.remove(); dropdown = null; }
    activeIdx = -1; names = [];
  }

  function render(filtered) {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.className = 'mention-dropdown';
      input.parentElement.appendChild(dropdown);
    }
    dropdown.innerHTML = filtered.map((n, i) =>
      `<div class="mention-dropdown-item${i === activeIdx ? ' active' : ''}" data-name="${escHtml(n)}">@${escHtml(n)}</div>`
    ).join('');
    dropdown.querySelectorAll('.mention-dropdown-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(el.dataset.name);
      });
    });
  }

  function pick(name) {
    const v = input.value;
    const cursor = input.selectionStart;
    const before = v.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1) { close(); return; }
    input.value = before.slice(0, atIdx) + '@' + name + ' ' + v.slice(cursor);
    input.focus();
    const newPos = atIdx + name.length + 2;
    input.setSelectionRange(newPos, newPos);
    close();
  }

  input.addEventListener('input', () => {
    const v = input.value;
    const cursor = input.selectionStart;
    const before = v.slice(0, cursor);
    const atIdx = before.lastIndexOf('@');
    if (atIdx === -1 || (atIdx > 0 && before[atIdx - 1] !== ' ')) { close(); return; }
    const query = before.slice(atIdx + 1).toLowerCase();
    if (!query || query.length > 20 || /\s/.test(query)) { close(); return; }
    const all = getNames();
    const filtered = all.filter(n => n.toLowerCase().startsWith(query)).slice(0, 6);
    if (filtered.length === 0) { close(); return; }
    names = filtered; activeIdx = 0;
    render(filtered);
  });

  input.addEventListener('keydown', (e) => {
    if (!dropdown || names.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % names.length; render(names); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + names.length) % names.length; render(names); }
    else if (e.key === 'Tab' || e.key === 'Enter') {
      if (activeIdx >= 0 && activeIdx < names.length) { e.preventDefault(); pick(names[activeIdx]); }
    }
    else if (e.key === 'Escape') { close(); }
  });

  input.addEventListener('blur', () => setTimeout(close, 150));
}

// Chat input-уудад autocomplete идэвхжүүлэх
setupMentionAutocomplete('chat-input');
setupMentionAutocomplete('lobby-chat-input');

// Тоглоомын нэрнээс тогтмол өнгө үүсгэх
const _gameColors = ['#e74c3c','#2980b9','#27ae60','#8e44ad','#e67e22','#16a085','#c0392b','#1a5276'];
function gameTypeColor(name) {
  if (!name) return _gameColors[0];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return _gameColors[h % _gameColors.length];
}

// ── Хэрэглэгч хайх ───────────────────────────────────────
let _searchTimer = null;
const userSearchInput = document.getElementById('user-search-input');
if (userSearchInput) {
  userSearchInput.addEventListener('input', () => {
    clearTimeout(_searchTimer);
    const q = userSearchInput.value.trim();
    const resultsEl = document.getElementById('user-search-results');
    if (!q || q.length < 2) {
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }
    _searchTimer = setTimeout(async () => {
      try {
        const results = await window.api.searchUsers(q);
        if (!resultsEl) return;
        if (!results.length) {
          resultsEl.innerHTML = '<div class="search-result-item" style="color:var(--text2)">Олдсонгүй</div>';
          return;
        }
        const friendIds  = new Set(myFriends.map(f => String(f.id)));
        const blockedIds = new Set(blockedUsers.map(b => String(b.id)));
        resultsEl.innerHTML = results.map(u => {
          const uid    = String(u.id);
          const isFriend  = friendIds.has(uid);
          const isBlocked = blockedIds.has(uid);
          const addBtn = (!isFriend && !isBlocked)
            ? `<button class="btn btn-sm btn-add-friend search-add-btn" data-id="${uid}" data-name="${escHtml(u.username)}">+ Найз</button>`
            : (isFriend ? '<span style="font-size:0.75rem;color:var(--green)">✓ Найз</span>' : '');
          return `<div class="search-result-item">
            <span class="result-username">${escHtml(u.username)}</span>
            ${addBtn}
          </div>`;
        }).join('');
        resultsEl.querySelectorAll('.search-add-btn').forEach(btn => {
          btn.addEventListener('click', () => addFriendClick(btn.dataset.id, btn.dataset.name));
        });
      } catch {}
    }, 500);
  });
}

// Ranking sort сонголт өөрчлөгдөхөд дахин ачааллах
const rankingSortEl = document.getElementById('ranking-sort');
if (rankingSortEl) {
  rankingSortEl.addEventListener('change', () => loadRanking(1, rankingSortEl.value));
}

// ── Keyboard shortcuts ────────────────────────────────────
function toggleShortcutsModal() {
  const m = document.getElementById('shortcuts-modal');
  if (!m) return;
  const visible = !m.classList.contains('hidden');
  if (visible) { m.classList.add('hidden'); m.style.display = 'none'; }
  else { m.classList.remove('hidden'); m.style.display = 'flex'; }
}
document.getElementById('btn-close-shortcuts')?.addEventListener('click', () => {
  const m = document.getElementById('shortcuts-modal');
  if (m) { m.classList.add('hidden'); m.style.display = 'none'; }
});

document.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toUpperCase();
  const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  // Escape: modal + create-room-form хаах (input дотор ч ажиллана)
  if (e.key === 'Escape') {
    const modals = [
      'shortcuts-modal',
      'user-profile-modal',
      'confirm-modal',
      'dm-modal',
      'password-modal',
    ];
    for (const id of modals) {
      const el = document.getElementById(id);
      if (el && !el.classList.contains('hidden') && el.style.display !== 'none') {
        el.classList.add('hidden');
        el.style.display = 'none';
        return;
      }
    }
    // create-room-form (display: block/none ашигладаг)
    const crForm = document.getElementById('create-room-form');
    if (crForm && crForm.style.display === 'block') {
      crForm.style.display = 'none';
      return;
    }
    // Input-д байвал blur хийх
    if (isInput) { e.target.blur(); return; }
    return;
  }

  // Ctrl+Enter: чат input дотроос мессеж илгээх
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    const activeEl = document.activeElement;
    if (activeEl?.id === 'chat-input') {
      document.getElementById('btn-send')?.click();
    } else if (activeEl?.id === 'dm-input') {
      document.getElementById('btn-dm-send')?.click();
    }
    return;
  }

  // Ctrl+K: room search focus (input дотор ч ажиллана)
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault();
    const search = document.getElementById('room-search');
    if (search) { search.focus(); search.select(); }
    return;
  }

  // Input дотор бол бусад shortcut skip
  if (isInput) return;

  const mainActive = document.getElementById('page-main')?.classList.contains('active');

  // ? → shortcut help
  if (e.key === '?') { toggleShortcutsModal(); return; }

  // Alt+1/2/3 → tab шилжих
  if (e.altKey && e.key === '1' && mainActive) { e.preventDefault(); showTab('discord'); return; }
  if (e.altKey && e.key === '2' && mainActive) { e.preventDefault(); showTab('settings'); return; }
  if (e.altKey && e.key === '3' && mainActive) { e.preventDefault(); showTab('lobby'); return; }
  if (e.altKey && e.key === '4' && mainActive) { e.preventDefault(); showTab('room'); return; }

  // Alt+N → create room toggle
  if (e.altKey && (e.key === 'n' || e.key === 'N') && mainActive) {
    e.preventDefault();
    document.getElementById('btn-create-room')?.click();
    return;
  }

  // Alt+Q → quickmatch
  if (e.altKey && (e.key === 'q' || e.key === 'Q') && mainActive) {
    e.preventDefault();
    document.getElementById('btn-quickmatch')?.click();
    return;
  }

  // Alt+R → refresh rooms
  if (e.altKey && (e.key === 'r' || e.key === 'R') && mainActive) {
    e.preventDefault();
    loadRooms();
    return;
  }
});

// ── Scroll-to-top ────────────────────────────────────────
const _scrollTopBtn = document.getElementById('scroll-top-btn');
if (_scrollTopBtn) {
  _scrollTopBtn.addEventListener('click', () => {
    const activeTab = document.querySelector('.tab.active');
    if (activeTab) activeTab.scrollTo({ top: 0, behavior: 'smooth' });
  });
  // Tab scroll event → show/hide button
  document.addEventListener('scroll', (e) => {
    const tab = e.target.closest?.('.tab');
    if (tab && tab.classList.contains('active')) {
      _scrollTopBtn.classList.toggle('visible', tab.scrollTop > 200);
    }
  }, true);
}

// ── Onboarding Tour ──────────────────────────────────────
const ONBOARDING_STEPS = [
  // ── Үндсэн бүтэц ──
  { target: '[data-tab="lobby"]',    title: 'Өрөөнүүд',       text: 'Энд бүх өрөөнүүдийг харж, нэгдэж болно. Энэ бол платформын үндсэн хуудас.', category: 'Үндсэн', icon: '🏠' },
  { target: '.online-bar',           title: 'Онлайн тоглогчид', text: 'Одоо хэдэн тоглогч онлайн байгааг энд харна.', category: 'Үндсэн', icon: '👥' },
  { target: '#connection-status',    title: 'Холболтын төлөв', text: 'Сервертэй холболтын төлөв. 🟢 = Холбогдсон, 🔴 = Салсан.', category: 'Үндсэн', icon: '📡' },

  // ── Өрөө ──
  { target: '#btn-create-room',      title: 'Өрөө үүсгэх',   text: 'Шинэ тоглоомын өрөө үүсгэхийн тулд энд дарна. Нэр, тоглоом, нууц үг зэргийг тохируулна.', category: 'Өрөө', icon: '🚪' },
  { target: '#btn-quickmatch',       title: 'Хурдан тоглолт', text: 'Нэг товчоор боломжтой өрөөнд автоматаар нэгдэнэ. Хамгийн хурдан арга!', category: 'Өрөө', icon: '⚡' },
  { target: '#room-search',          title: 'Өрөө хайх',     text: 'Өрөөг нэрээр хайх боломжтой. Ctrl+K товчоор хурдан нээнэ.', category: 'Өрөө', icon: '🔍' },

  // ── Чат & Найзууд ──
  { target: '[data-tab="chat"]',     title: 'Чат таб',        text: 'Нийтийн чат болон хувийн мессеж (DM) энд байна. Найзуудтай шууд чатлах боломжтой.', category: 'Чат', icon: '💬' },
  { target: '#lobby-chat-input',     title: 'Нийтийн чат',    text: 'Бүх хэрэглэгчидтэй чатлах боломжтой. @нэр бичвэл mention хийнэ.', category: 'Чат', icon: '🌐' },

  // ── Бусад табууд ──
  { target: '[data-tab="discord"]',  title: 'Discord серверүүд', text: 'Монголын Warcraft Discord серверүүдийн жагсаалт. Өөрийн серверээ нэмж болно.', category: 'Табууд', icon: '🎙️' },
  { target: '.userchip',             title: 'Профайл',        text: 'Баннер дээрх нэр/зураг дээрээ дарж профайлаа харж, аватараа солино.', category: 'Табууд', icon: '👤' },

  // ── Тохиргоо ──
  { target: '[data-tab="settings"]', title: 'Тоглоом',        text: 'Тоглоомын exe бүртгэх, Garena сүлжээ сүлжээ, апп болон мэдэгдлийн тохиргоо — бүгд энэ табд.', category: 'Тохиргоо', icon: '🎮' },
  { target: '.banner-actions',       title: 'Найзууд · Чат · Тохиргоо · Гарах', text: 'Баннерын баруун булангийн товчнууд: найзуудын цонх, нийтийн чат/DM, тохиргоо, гарах.', category: 'Тохиргоо', icon: '🔑' },
];

let _onboardStep = 0;
let _onboardOverlay = null;
let _onboardSpotlight = null;
let _onboardTooltip = null;
let _onboardIsManual = false;  // restart товчоор эхэлсэн эсэх

function startOnboarding() {
  if (!_onboardIsManual && localStorage.getItem('onboarding_done')) return;
  if (_onboardOverlay) return;
  _onboardStep = 0;

  _onboardOverlay = document.createElement('div');
  _onboardOverlay.className = 'onboarding-overlay';
  document.body.appendChild(_onboardOverlay);

  _onboardSpotlight = document.createElement('div');
  _onboardSpotlight.className = 'onboarding-spotlight';
  document.body.appendChild(_onboardSpotlight);

  _onboardTooltip = document.createElement('div');
  _onboardTooltip.className = 'onboarding-tooltip';
  document.body.appendChild(_onboardTooltip);

  _onboardShow();
}

function _onboardShow() {
  const step = ONBOARDING_STEPS[_onboardStep];
  if (!step) { _onboardFinish(); return; }

  // lobby-chat-input чат таб дотор байгаа тул chat таб руу шилжүүлэх
  if (step.target === '#lobby-chat-input') {
    document.querySelector('[data-tab="chat"]')?.click();
  }

  const el = document.querySelector(step.target);
  if (!el) { _onboardStep++; _onboardShow(); return; }

  // Spotlight
  const rect = el.getBoundingClientRect();
  const pad = 8;
  _onboardSpotlight.style.left   = (rect.left - pad) + 'px';
  _onboardSpotlight.style.top    = (rect.top - pad) + 'px';
  _onboardSpotlight.style.width  = (rect.width + pad * 2) + 'px';
  _onboardSpotlight.style.height = (rect.height + pad * 2) + 'px';

  // Progress
  const total = ONBOARDING_STEPS.length;
  const current = _onboardStep + 1;
  const pct = Math.round((current / total) * 100);
  const isFirst = _onboardStep === 0;
  const isLast = _onboardStep === total - 1;

  // Category badge
  const catHtml = step.category ? `<span class="ob-category">${step.category}</span>` : '';

  _onboardTooltip.innerHTML = `
    <div class="ob-progress-bar"><div class="ob-progress-fill" style="width:${pct}%"></div></div>
    <div class="ob-header">
      <span class="ob-icon">${step.icon || ''}</span>
      <div>
        <h4>${step.title} ${catHtml}</h4>
      </div>
    </div>
    <p>${step.text}</p>
    <div class="onboarding-actions">
      <span class="onboarding-steps">${current} / ${total}</span>
      <div style="display:flex;gap:6px">
        <button class="btn ob-btn-stop" id="ob-stop" title="Сургалтыг зогсоох">✕</button>
        ${isFirst ? '' : '<button class="btn" id="ob-prev">← Өмнөх</button>'}
        <button class="btn btn-primary" id="ob-next">${isLast ? '✓ Дуусгах' : 'Дараах →'}</button>
      </div>
    </div>
  `;

  // Position
  const ttW = 320;
  let ttLeft = rect.left + rect.width / 2 - ttW / 2;
  let ttTop = rect.bottom + 14;
  if (ttTop + 180 > window.innerHeight) {
    ttTop = rect.top - 14;
    _onboardTooltip.style.transform = 'translateY(-100%)';
  } else {
    _onboardTooltip.style.transform = 'none';
  }
  ttLeft = Math.max(8, Math.min(ttLeft, window.innerWidth - ttW - 8));
  _onboardTooltip.style.left = ttLeft + 'px';
  _onboardTooltip.style.top = ttTop + 'px';
  _onboardTooltip.style.width = ttW + 'px';

  document.getElementById('ob-next').onclick = _onboardNext;
  document.getElementById('ob-stop').onclick = _onboardCancel;
  const prevBtn = document.getElementById('ob-prev');
  if (prevBtn) prevBtn.onclick = _onboardPrev;
}

function _onboardNext() {
  _onboardStep++;
  if (_onboardStep >= ONBOARDING_STEPS.length) { _onboardFinish(); return; }
  _onboardShow();
}

function _onboardPrev() {
  if (_onboardStep > 0) {
    _onboardStep--;
    _onboardShow();
  }
}

function _onboardCancel() {
  _onboardCleanup();
  _onboardIsManual = false;
  showToast('Сургалтыг зогсоолоо. Тохиргоо хэсгээс дахин эхлүүлж болно.', 'info');
}

function _onboardFinish() {
  localStorage.setItem('onboarding_done', '1');
  _onboardCleanup();
  _onboardIsManual = false;
  // Lobby таб руу буцаах
  document.querySelector('[data-tab="lobby"]')?.click();
  showToast('Тавтай морил! Тоглоомоо эхлүүлээрэй 🎮', 'success');
}

function _onboardCleanup() {
  if (_onboardOverlay) _onboardOverlay.remove();
  if (_onboardSpotlight) _onboardSpotlight.remove();
  if (_onboardTooltip) _onboardTooltip.remove();
  _onboardOverlay = _onboardSpotlight = _onboardTooltip = null;
}

// Resize → reposition
window.addEventListener('resize', () => {
  if (_onboardTooltip) _onboardShow();
});

// Esc товчоор зогсоох
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _onboardOverlay) {
    _onboardCancel();
  }
});

// Сургалт дахин эхлүүлэх товч
document.getElementById('btn-restart-tour')?.addEventListener('click', () => {
  _onboardIsManual = true;
  localStorage.removeItem('onboarding_done');
  document.querySelector('[data-tab="lobby"]')?.click();
  setTimeout(() => startOnboarding(), 400);
});

// ── Discord Servers ───────────────────────────────────────
// "Сервер нэмэх" товч — жагсаалтын эхэнд тод card байрлуулна
function _discordAddCard() {
  return `
    <div class="room-card discord-server-card" id="discord-add-card"
         style="border:2px dashed var(--accent);cursor:pointer;text-align:center;padding:18px;opacity:0.85;"
         title="Сервер нэмэх">
      <div style="font-size:2rem;margin-bottom:6px">➕</div>
      <strong style="color:var(--accent)">Сервер нэмэх</strong>
      <p class="meta hint" style="margin-top:4px">Discord серверийнхаа урилга холбоосыг нэмнэ үү</p>
    </div>`;
}

async function loadDiscordServers() {
  const list = document.getElementById('discord-servers-list');
  if (!list) return;
  list.innerHTML = '<p class="empty-text">Ачааллаж байна...</p>';
  try {
    const servers = await window.api.getDiscordServers();
    const addCard = _discordAddCard();
    if (!servers.length) {
      list.innerHTML = addCard;
      list.querySelector('#discord-add-card').addEventListener('click', () => toggleDiscordForm());
      return;
    }
    list.innerHTML = addCard + servers.map(s => {
      const isOwn = currentUser && String(s.added_by_id) === String(currentUser.id);
      const m = s.discord_meta;
      const expired = s.invite_expired;
      const iconUrl = m && m.guild_icon
        ? `https://cdn.discordapp.com/icons/${m.guild_id}/${m.guild_icon}.png?size=64`
        : '';
      const iconHtml = iconUrl
        ? `<img class="discord-guild-icon" src="${iconUrl}" alt="" />`
        : `<span class="discord-guild-icon-placeholder">🎮</span>`;
      const voiceHtml = m && m.voice_count > 0
        ? `<span class="discord-voice">🔊 ${m.voice_count} voice</span>`
        : '';
      const memberHtml = m && m.member_count
        ? `<span class="discord-meta-counts"><span class="discord-members">👥 ${m.member_count.toLocaleString()} гишүүн</span><span class="discord-online">🟢 ${m.presence_count.toLocaleString()} онлайн</span>${voiceHtml}</span>`
        : '';
      const expiredHtml = expired
        ? `<p class="discord-expired-warning">⚠️ Урилгын хугацаа дууссан${isOwn ? ' — "Засах" дарж Discord-ын байнгын (Expire after: Never) урилга оруулна уу' : ''}</p>`
        : '';
      return `
        <div class="room-card discord-server-card${expired ? ' discord-expired' : ''}">
          <div class="room-card-header">
            ${iconHtml}
            <div class="discord-header-text">
              <strong>${escHtml(m && m.guild_name ? m.guild_name : s.name)}</strong>
              ${memberHtml}
            </div>
          </div>
          ${s.description ? `<p class="meta">${escHtml(s.description)}</p>` : ''}
          ${expiredHtml}
          <p class="meta hint">Нэмсэн: <a href="#" class="discord-added-by-link" data-user-id="${s.added_by_id}" data-username="${escHtml(s.added_by_username)}">${escHtml(s.added_by_username)}</a></p>
          <div class="discord-card-footer">
            <button type="button" class="btn btn-primary btn-sm btn-discord-join${expired ? ' btn-disabled' : ''}" data-url="${escHtml(s.invite_url)}"${expired ? ' disabled' : ''}>
              ${expired ? 'Холбоос хүчингүй' : 'Нэгдэх →'}
            </button>
            ${!isOwn && currentUser ? `<button type="button" class="btn btn-sm btn-ds-dm" data-user-id="${s.added_by_id}" data-username="${escHtml(s.added_by_username)}">💬 DM</button>` : ''}
            ${isOwn ? `
              <button type="button" class="btn btn-sm btn-ds-edit" data-id="${s.id}"
                data-name="${escHtml(s.name)}" data-url="${escHtml(s.invite_url)}"
                data-desc="${escHtml(s.description || '')}">✏️ Засах</button>
              <button type="button" class="btn btn-sm btn-danger-soft btn-ds-delete" data-id="${s.id}">Устгах</button>
            ` : ''}
          </div>
        </div>`;
    }).join('');

    list.querySelector('#discord-add-card')?.addEventListener('click', () => toggleDiscordForm());
    list.querySelectorAll('.btn-discord-join').forEach(btn => {
      btn.onclick = () => window.api.openDiscordInvite(btn.dataset.url);
    });
    list.querySelectorAll('.btn-ds-delete').forEach(btn => {
      btn.onclick = async () => {
        if (!await showConfirm('Сервер устгах', 'Энэ Discord серверийг жагсаалтаас устгах уу?')) return;
        try {
          await window.api.deleteDiscordServer(Number(btn.dataset.id));
          showToast('Устгагдлаа', 'success');
          loadDiscordServers();
        } catch (err) {
          showToast(`Алдаа: ${err.message}`, 'error');
        }
      };
    });
    list.querySelectorAll('.btn-ds-edit').forEach(btn => {
      btn.onclick = () => {
        const form = document.getElementById('discord-server-form');
        const title = form.querySelector('h3');
        const submitBtn = document.getElementById('btn-ds-submit');
        document.getElementById('ds-name').value        = btn.dataset.name || '';
        document.getElementById('ds-invite-url').value  = btn.dataset.url  || '';
        document.getElementById('ds-description').value = btn.dataset.desc || '';
        document.getElementById('ds-form-error').textContent = '';
        form.dataset.editingId = btn.dataset.id;
        if (title)    title.textContent    = 'Discord сервер засах';
        if (submitBtn) submitBtn.textContent = 'Хадгалах';
        form.classList.remove('hidden');
        document.getElementById('ds-name').focus();
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
    });
    // Нэмсэн хүний нэр дарахад profile нээх
    list.querySelectorAll('.discord-added-by-link').forEach(link => {
      link.onclick = (e) => {
        e.preventDefault();
        const uid = link.dataset.userId;
        if (uid && currentUser && String(uid) !== String(currentUser.id)) {
          openUserProfile(Number(uid));
        }
      };
    });
    // DM товч
    list.querySelectorAll('.btn-ds-dm').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        openDM(btn.dataset.userId, btn.dataset.username);
      };
    });
  } catch (err) {
    list.innerHTML = `<p class="empty-text">Серверийн жагсаалт ачаалахад алдаа гарлаа</p>`;
  }
}

function toggleDiscordForm() {
  const form = document.getElementById('discord-server-form');
  const isHidden = form.classList.contains('hidden');
  if (isHidden) {
    const title = form.querySelector('h3');
    const submitBtn = document.getElementById('btn-ds-submit');
    delete form.dataset.editingId;
    if (title)    title.textContent     = 'Шинэ Discord сервер нэмэх';
    if (submitBtn) submitBtn.textContent = 'Нэмэх';
    form.classList.remove('hidden');
    document.getElementById('ds-name').focus();
  } else {
    _resetDiscordForm();
  }
};

function _resetDiscordForm() {
  const form = document.getElementById('discord-server-form');
  const title = form.querySelector('h3');
  const submitBtn = document.getElementById('btn-ds-submit');
  form.classList.add('hidden');
  delete form.dataset.editingId;
  document.getElementById('ds-name').value        = '';
  document.getElementById('ds-invite-url').value  = '';
  document.getElementById('ds-description').value = '';
  document.getElementById('ds-form-error').textContent = '';
  if (title)    title.textContent     = 'Шинэ Discord сервер нэмэх';
  if (submitBtn) submitBtn.textContent = 'Нэмэх';
}

document.getElementById('btn-ds-cancel').onclick = _resetDiscordForm;

document.getElementById('btn-ds-submit').onclick = async () => {
  const name        = document.getElementById('ds-name').value.trim();
  const invite_url  = document.getElementById('ds-invite-url').value.trim();
  const description = document.getElementById('ds-description').value.trim();
  const errEl       = document.getElementById('ds-form-error');
  const form        = document.getElementById('discord-server-form');
  errEl.textContent = '';
  if (!name)       { errEl.textContent = 'Серверийн нэр оруулна уу';  return; }
  if (!invite_url) { errEl.textContent = 'Discord урилгын холбоос оруулна уу'; return; }

  const editingId = form.dataset.editingId ? Number(form.dataset.editingId) : null;
  try {
    if (editingId) {
      await window.api.editDiscordServer(editingId, { name, invite_url, description });
      showToast('Discord сервер шинэчлэгдлээ! ✅', 'success');
    } else {
      await window.api.addDiscordServer({ name, invite_url, description });
      showToast('Discord сервер нэмэгдлээ! 🎮', 'success');
    }
    _resetDiscordForm();
    loadDiscordServers();
  } catch (err) {
    errEl.textContent = err.message;
  }
};

// ── Streamers ─────────────────────────────────────────────
const _platformIcons = {
  Twitch:   '🟣',
  YouTube:  '🔴',
  Facebook: '🔵',
  Kick:     '🟢',
  TikTok:   '🎵',
  Other:    '🌐',
};

function _streamerAddCard() {
  return `
    <div class="room-card streamer-card" id="streamer-add-card"
         style="border:2px dashed var(--accent);cursor:pointer;text-align:center;padding:18px;opacity:0.85;"
         title="Стример нэмэх">
      <div style="font-size:2rem;margin-bottom:6px">➕</div>
      <div style="font-size:0.85rem;color:var(--text2)">Стример нэмэх</div>
    </div>`;
}

async function loadStreamers() {
  const list = document.getElementById('streamers-list');
  if (!list) return;
  list.innerHTML = '<p class="empty-text">Ачааллаж байна...</p>';
  try {
    const streamers = await window.api.getStreamers();
    const addCard = _streamerAddCard();
    if (!streamers.length) {
      list.innerHTML = addCard + '<p class="empty-text">Одоогоор стример нэмэгдээгүй байна.</p>';
    } else {
      list.innerHTML = addCard + streamers.map(s => {
        const isOwn = currentUser && s.added_by_id === currentUser.id;
        const icon = _platformIcons[s.platform] || '🌐';
        return `
        <div class="room-card streamer-card">
          <div class="room-card-header">
            <span style="font-size:1.4rem">${icon}</span>
            <div style="flex:1;min-width:0">
              <div class="room-card-title">${escHtml(s.name)}</div>
              <div style="font-size:0.75rem;color:var(--text2)">${escHtml(s.platform)} — ${escHtml(s.added_by_username)}</div>
            </div>
          </div>
          ${s.description ? `<p style="font-size:0.82rem;color:var(--text2);margin:6px 0 0">${escHtml(s.description)}</p>` : ''}
          <div class="room-card-actions mt-8">
            <button type="button" class="btn btn-primary btn-sm btn-streamer-open" data-url="${escHtml(s.channel_url)}">
              Суваг нээх →
            </button>
            ${isOwn ? `
              <button type="button" class="btn btn-sm btn-str-edit" data-id="${s.id}"
                data-name="${escHtml(s.name)}" data-url="${escHtml(s.channel_url)}"
                data-desc="${escHtml(s.description || '')}">✏️ Засах</button>
              <button type="button" class="btn btn-sm btn-danger-soft btn-str-delete" data-id="${s.id}">Устгах</button>
            ` : ''}
          </div>
        </div>`;
      }).join('');
    }
    // Event listeners
    list.querySelector('#streamer-add-card')?.addEventListener('click', () => toggleStreamerForm());
    list.querySelectorAll('.btn-streamer-open').forEach(btn => {
      btn.onclick = () => window.api.openStreamerUrl(btn.dataset.url);
    });
    list.querySelectorAll('.btn-str-delete').forEach(btn => {
      btn.onclick = async () => {
        if (!await showConfirm('Стример устгах', 'Энэ стримерийг жагсаалтаас устгах уу?')) return;
        try {
          await window.api.deleteStreamer(Number(btn.dataset.id));
          showToast('Устгагдлаа', 'success');
          loadStreamers();
        } catch (err) {
          showToast(`Алдаа: ${err.message}`, 'error');
        }
      };
    });
    list.querySelectorAll('.btn-str-edit').forEach(btn => {
      btn.onclick = () => {
        const form = document.getElementById('streamer-form');
        const title = form.querySelector('h3');
        const submitBtn = document.getElementById('btn-str-submit');
        document.getElementById('str-name').value        = btn.dataset.name || '';
        document.getElementById('str-channel-url').value = btn.dataset.url  || '';
        document.getElementById('str-description').value = btn.dataset.desc || '';
        document.getElementById('str-form-error').textContent = '';
        form.dataset.editingId = btn.dataset.id;
        if (title)    title.textContent    = 'Стример засах';
        if (submitBtn) submitBtn.textContent = 'Хадгалах';
        form.classList.remove('hidden');
        document.getElementById('str-name').focus();
        form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      };
    });
  } catch (err) {
    list.innerHTML = _streamerAddCard() + `<p class="empty-text">Алдаа: ${err.message}</p>`;
    list.querySelector('#streamer-add-card')?.addEventListener('click', () => toggleStreamerForm());
  }
}

function toggleStreamerForm() {
  const form = document.getElementById('streamer-form');
  const isHidden = form.classList.contains('hidden');
  if (isHidden) {
    const title = form.querySelector('h3');
    const submitBtn = document.getElementById('btn-str-submit');
    delete form.dataset.editingId;
    if (title)    title.textContent     = 'Шинэ стример нэмэх';
    if (submitBtn) submitBtn.textContent = 'Нэмэх';
    form.classList.remove('hidden');
    document.getElementById('str-name').focus();
  } else {
    _resetStreamerForm();
  }
}

function _resetStreamerForm() {
  const form = document.getElementById('streamer-form');
  const title = form.querySelector('h3');
  const submitBtn = document.getElementById('btn-str-submit');
  form.classList.add('hidden');
  delete form.dataset.editingId;
  document.getElementById('str-name').value        = '';
  document.getElementById('str-channel-url').value = '';
  document.getElementById('str-description').value = '';
  document.getElementById('str-form-error').textContent = '';
  if (title)    title.textContent     = 'Шинэ стример нэмэх';
  if (submitBtn) submitBtn.textContent = 'Нэмэх';
}

document.getElementById('btn-str-cancel').onclick = _resetStreamerForm;

document.getElementById('btn-str-submit').onclick = async () => {
  const name        = document.getElementById('str-name').value.trim();
  const channel_url = document.getElementById('str-channel-url').value.trim();
  const description = document.getElementById('str-description').value.trim();
  const errEl       = document.getElementById('str-form-error');
  const form        = document.getElementById('streamer-form');
  errEl.textContent = '';
  if (!name)        { errEl.textContent = 'Стримерийн нэр оруулна уу';  return; }
  if (!channel_url) { errEl.textContent = 'Сувгийн холбоос оруулна уу'; return; }
  if (!/^https?:\/\/.+/i.test(channel_url)) { errEl.textContent = 'Зөв URL холбоос оруулна уу (https://...)'; return; }

  const editingId = form.dataset.editingId;
  try {
    if (editingId) {
      await window.api.editStreamer(Number(editingId), { name, channel_url, description });
      showToast('Стример шинэчлэгдлээ! ✅', 'success');
    } else {
      await window.api.addStreamer({ name, channel_url, description });
      showToast('Стример нэмэгдлээ! 🎮', 'success');
    }
    _resetStreamerForm();
    loadStreamers();
  } catch (err) {
    errEl.textContent = err.message;
  }
};

// ── Эхлүүлэх ─────────────────────────────────────────────
init();

// ── Garena Plus маягийн нэвтрэх цонхны нэмэлтүүд (2026-08-21) ──
(function loginExtras() {
  const emailEl  = document.getElementById('login-email');
  const remember = document.getElementById('login-remember');
  const statusEl = document.getElementById('login-status');

  // "Имэйлийг сануулах" — зөвхөн имэйлийг localStorage-д хадгална (нууц үг хадгалахгүй)
  if (emailEl && remember) {
    const saved = localStorage.getItem('login_remember_email');
    if (saved) { emailEl.value = saved; remember.checked = true; }
    const persist = () => {
      const v = emailEl.value.trim();
      if (remember.checked && v) localStorage.setItem('login_remember_email', v);
      else localStorage.removeItem('login_remember_email');
    };
    remember.addEventListener('change', persist);
    emailEl.addEventListener('change', persist);
  }

  // "Нэвтрэх төлөв" (Sign in as) — сонголтыг хадгална; presence-д дараа холбоно
  if (statusEl) {
    statusEl.value = localStorage.getItem('login_status') || 'online';
    statusEl.addEventListener('change', () => localStorage.setItem('login_status', statusEl.value));
  }

  // QR панел нээх/хаах
  const qrSection = document.getElementById('qr-section');
  document.getElementById('btn-qr-toggle')?.addEventListener('click', () => {
    if (!qrSection) return;
    const opening = qrSection.classList.contains('hidden');
    qrSection.classList.toggle('hidden', !opening);
    if (opening && typeof loadQR === 'function') loadQR();
  });
  document.getElementById('btn-qr-close')?.addEventListener('click', () => qrSection?.classList.add('hidden'));

  // Доод мөрний "Шинэчлэлт шалгах"
  document.getElementById('btn-login-check-update')?.addEventListener('click', async () => {
    try {
      const res = await window.api.checkForUpdates();
      if (res?.error === 'dev')  showToast('Dev горимд шинэчлэл шалгах боломжгүй.', 'warning');
      else if (res?.error)       showToast('Шинэчлэл шалгахад алдаа: ' + res.error, 'error');
      else                       showToast('Шинэчлэл шалгаж байна — шинэ хувилбар байвал автоматаар татна.', 'info');
    } catch {
      showToast('Серверт холбогдож чадсангүй.', 'error');
    }
  });

  // Хувилбар (баруун доод булан)
  window.api?.getAppVersion?.().then(v => {
    const el = document.getElementById('login-version');
    if (el && v) el.textContent = 'v' + v;
  }).catch(() => {});
})();

// ── Мокап №2-ын үндсэн цонх: баннер + 4 таб (2026-08-22) ──
(function mainShell() {
  const toMain = (action, value) => window.api.mainAction?.({ action, value });
  // data-goto-tab товчнууд (brand, userchip, "Өрөөнүүд рүү очих") — Найзууд цонхноос үндсэн цонх руу дамжуулна
  document.querySelectorAll('[data-goto-tab]').forEach(el => {
    el.addEventListener('click', () => (isFriendsMode() ? toMain('tab', el.dataset.gotoTab) : showTab(el.dataset.gotoTab)));
  });
  // "Тоглоом" таб → Тохиргооны "Тоглоом" хэсэг; араа → "Апп" хэсэг
  const jumpSection = (sec) => document.querySelector(`.settings-menu-item[data-settings-section="${sec}"]`)?.click();
  document.querySelectorAll('[data-settings-jump]').forEach(el => {
    el.addEventListener('click', () => {
      if (isFriendsMode()) { toMain('settings', el.dataset.settingsJump); return; }
      if (!el.classList.contains('nav-btn')) showTab('settings');
      jumpSection(el.dataset.settingsJump);
    });
  });
  // Найзууд цонхны удирдлагын товчнууд (чат / тохиргоо) → үндсэн цонх
  document.querySelectorAll('[data-main-action]').forEach(el => {
    el.addEventListener('click', () => toMain(el.dataset.mainAction, el.dataset.value));
  });
  // Үндсэн цонх: Найзууд цонхноос ирсэн үйлдлүүд
  if (!isFriendsMode() && !isRoomMode() && !isDMMode()) {
    window.api.onUiAction?.(({ action, value } = {}) => {
      if (action === 'tab') showTab(value || 'lobby');
      else if (action === 'settings') { showTab('settings'); jumpSection(value || 'app'); }
      else if (action === 'logout') doLogout();
    });
    // Үндсэн хуудас гарах бүрт Найзууд цонхыг хамт нээнэ (үндсэн цонхны хажууд наалдана)
    const _showPageMain = showPage;
    showPage = function (id) { _showPageMain(id); if (id === 'page-main') window.api.notifyMainShown?.(); };
    // Реклам (сервер /config → ad)
    (async () => {
      try {
        const ads = await window.api.getAd?.();   // массив
        const slot = document.getElementById('ad-slot');
        if (!slot || !Array.isArray(ads) || !ads.length) return;
        slot.classList.add('has-ad');
        let idx = 0;
        const makeLink = (ad) => {
          const a = document.createElement('a');
          a.className = 'ad-link';
          a.href = '#';
          a.title = ad.text || '';
          a.innerHTML = ad.image ? `<img src="${escHtml(ad.image)}" alt="">` : `<span class="ad-text">${escHtml(ad.text || '')}</span>`;
          a.addEventListener('click', (e) => { e.preventDefault(); if (ad.link) window.api.openExternal?.(ad.link); });
          return a;
        };
        // Эхний реклам
        let current = makeLink(ads[0]);
        slot.innerHTML = '';
        slot.appendChild(current);
        // Баруунаас зүүн тийш swipe
        const swipeTo = (ad) => {
          if (!ad || !(ad.image || ad.text)) return;
          const next = makeLink(ad);
          next.style.transform = 'translateX(100%)';   // баруунаас гарч ирнэ
          slot.appendChild(next);
          void next.offsetWidth;                        // reflow → transition эхлүүлнэ
          next.style.transform = 'translateX(0)';
          current.style.transform = 'translateX(-100%)'; // хуучин нь зүүн тийш гарна
          const old = current;
          current = next;
          setTimeout(() => { old.remove(); }, 650);
        };
        if (ads.length > 1) setInterval(() => { idx = (idx + 1) % ads.length; swipeTo(ads[idx]); }, 8000);   // ~8с тутам эргэлдэнэ

      } catch {}
    })();
  }
  // Найзуудын тусдаа цонх (хуучин товч — байхгүй байж болно)
  document.getElementById('btn-open-friends-main')?.addEventListener('click', () => window.api.openFriendsWindow?.());
  // Холболтын текст
  const connLabel = document.querySelector('.maintabs .conn-label');
  if (connLabel) {
    const st = document.getElementById('connection-status');
    new MutationObserver(() => {
      connLabel.textContent = st.classList.contains('online') ? 'Холбогдсон' : 'Салсан';
    }).observe(st, { attributes: true, attributeFilter: ['class'] });
  }

  // "Өрөө" таб — миний одоогийн өрөө (өрөө өөрөө тусдаа цонхонд нээгдэнэ)
  async function renderRoomTab() {
    const empty = document.getElementById('room-tab-empty');
    const cur   = document.getElementById('room-tab-current');
    let r = null;
    try {
      const res = await window.api.getMyRoom?.();
      r = Array.isArray(res) ? res[0] : (res && (res.room || res.id ? res : null));
      if (r && !r.id) r = null;
    } catch { r = null; }
    empty?.classList.toggle('hidden', !!r);
    cur?.classList.toggle('hidden', !r);
    if (!r) return;
    const name = document.getElementById('room-tab-name');
    const meta = document.getElementById('room-tab-meta');
    if (name) name.textContent = r.name || 'Өрөө';
    const players = r.current_players ?? r.player_count ?? r.players?.length;
    if (meta) meta.textContent = [r.game_type || r.gameType, players != null ? `${players}/${r.max_players || r.maxPlayers || 10} тоглогч` : null].filter(Boolean).join(' · ');
    const open = document.getElementById('btn-room-tab-open');
    if (open) open.onclick = () => enterRoom(r.id, r.name, r.game_type || r.gameType,
      String(r.host_id ?? r.hostId) === String(currentUser?.id), r.host_id ?? r.hostId, r.status);
  }
  const _showTab = showTab;
  showTab = function (name) { _showTab(name); if (name === 'room') renderRoomTab(); };
  document.getElementById('btn-room-tab-create')?.addEventListener('click', () => {
    showTab('lobby');
    document.getElementById('btn-create-room')?.click();
  });
})();

// ══════════════════════════════════════════════════════════════
// Premium (2026-08-22): GameRanger шиг шахмал өрөөний list · Diamond 💎 + XP/Level ·
// Bronze/Silver/Gold гишүүнчлэл (QPay эсвэл Diamond) · нэрийн эффект · аватарын хүрээ · өрөөний дэвсгэр (GOLD)
// ══════════════════════════════════════════════════════════════
(function premiumModule() {
  const TIER_NAME = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
  const TIER_DIAMONDS = { silver: 800, gold: 1500 };
  const FX_CLASSES = ['name-fx-gradient', 'name-fx-neon', 'name-fx-rainbow', 'name-fx-toon'];
  const el = (id) => document.getElementById(id);
  const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
  const errMsg = (e) => String(e?.message || e || 'Алдаа гарлаа').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const api = (method, path, body) => window.api.request(method, path, body);
  const myTier = () => (currentUser?.tier && TIER_NAME[currentUser.tier]) ? currentUser.tier : 'bronze';

  // ─── 1. GameRanger маягийн шахмал list (нэг жагсаалт: нээлттэй → тоглож байгаа) ───
  function gameAbbr(t) {
    const s = String(t || '');
    if (/warcraft/i.test(s)) return 'W3';
    if (/counter|cs/i.test(s)) return 'CS';
    if (/red alert/i.test(s)) return 'RA';
    if (/quake/i.test(s)) return 'Q3';
    if (/dota|lod/i.test(s)) return 'DT';
    return s.replace(/[^A-Za-zА-Яа-яӨөҮү0-9]/g, '').slice(0, 2).toUpperCase() || '?';
  }
  const LOCK_SVG = '<svg class="rl-lock-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';

  renderRoomsSkeleton = function () {
    return '<div class="room-grid-empty">Ачааллаж байна...</div>';
  };

  roomGridRow = function (r, inProgress, idx = 0) {
    const myId = String(currentUser?.id);
    const isMyRoom = String(r.host_id) === myId || (r.members || []).some((m) => String(m.id) === myId);
    const selected = String(r.id) === String(selectedRoomId);
    const desc = (r.description || '').trim();
    const full = (r.player_count || 0) >= (r.max_players || 0);
    const state = inProgress ? 'playing' : (full ? 'full' : 'waiting');
    const stateTitle = inProgress ? 'Тоглолт явагдаж байна' : (full ? 'Дүүрсэн' : 'Хүлээж байна');
    return `
    <div class="room-grid-row room-list-row ${inProgress ? 'room-playing' : ''} ${isMyRoom ? 'room-mine' : ''} ${selected ? 'selected' : ''}" role="row" tabindex="0" data-room-id="${r.id}" style="animation-delay:${Math.min(idx, 40) * 0.012}s">
      <div class="room-cell rl-game" role="cell" title="${escHtml(r.game_type || '')}"><i class="rl-gt" style="background:${gameTypeColor(r.game_type)}">${gameAbbr(r.game_type)}</i><span>${escHtml(r.game_type || '-')}</span></div>
      <div class="room-cell rl-host" role="cell"><span class="clickable-name" data-user-id="${escHtml(String(r.host_id || ''))}">${escHtml(r.host_name || '-')}</span></div>
      <div class="room-cell rl-name" role="cell" title="${escHtml(r.name)}${desc ? ' — ' + escHtml(desc) : ''}"><b>${escHtml(r.name)}</b>${desc ? `<span class="rl-desc"> — ${escHtml(desc)}</span>` : ''}${isMyRoom ? '<span class="my-room-tag">Миний</span>' : ''}${r.game_mode ? `<span class="rl-mode">${escHtml(r.game_mode)}</span>` : ''}</div>
      <div class="room-cell rl-net" role="cell">LAN</div>
      <div class="room-cell rl-players" role="cell">${r.player_count || 0}/${r.max_players || '-'}</div>
      <div class="room-cell rl-state" role="cell" title="${stateTitle}"><span class="room-state-dot ${state}"></span></div>
      <div class="room-cell rl-lock" role="cell" title="${r.has_password ? 'Нууц үгтэй' : ''}">${r.has_password ? LOCK_SVG : ''}</div>
      <div class="room-cell rl-action" role="cell">${roomActionButton(r, inProgress, isMyRoom, myId)}</div>
    </div>`;
  };

  renderFilteredRooms = function () {
    const list = el('rooms-waiting');
    const playing = el('rooms-playing');
    const detail = el('room-detail-panel');
    const board = document.querySelector('.room-board-layout');
    if (!list) return;
    if (playing) playing.innerHTML = '';

    const filtered = getFilteredRooms(Object.values(roomsCache));
    const waitRooms = filtered.filter((r) => r.status === 'waiting');
    const playRooms = filtered.filter((r) => r.status === 'playing');
    const rooms = [...waitRooms, ...playRooms];

    const search = (el('room-search')?.value || '').trim();
    const filterType = el('room-filter-type')?.value || '';
    const hasFilter = Boolean(search || filterType);

    if (!filtered.some((r) => String(r.id) === String(selectedRoomId))) {
      selectedRoomId = rooms[0]?.id ?? null;
    }

    if (!rooms.length) {
      list.innerHTML = `<div class="room-grid-empty">${hasFilter ? 'Хайлтад тохирох өрөө олдсонгүй' : 'Одоогоор нээлттэй өрөө байхгүй — эхний өрөөг та үүсгээрэй'}</div>`;
    } else {
      list.innerHTML = `
      <div class="room-data-grid room-list-grid" role="table">
        <div class="room-grid-header room-list-head" role="row">
          <div>Тоглоом</div><div>Хост</div><div>Өрөө / Тайлбар</div><div>Net</div><div>Тоглогч</div><div title="Төлөв">●</div><div title="Нууц үг">${LOCK_SVG}</div><div></div>
        </div>
        ${rooms.map((r, i) => roomGridRow(r, r.status === 'playing', i)).join('')}
      </div>`;
    }

    const cnt = el('rooms-waiting-count');
    if (cnt) cnt.textContent = `${rooms.length} өрөө · ${waitRooms.length} нээлттэй · ${playRooms.length} тоглож байна`;
    const cnt2 = el('rooms-playing-count');
    if (cnt2) cnt2.textContent = `${playRooms.length} өрөө`;

    const selectedRoom = filtered.find((r) => String(r.id) === String(selectedRoomId));
    if (board) board.classList.toggle('no-selection', !selectedRoom);
    if (detail) detail.innerHTML = renderRoomDetail(selectedRoom);
  };

  // ─── 2. Нэрийн эффект + аватарын хүрээ (бусад тоглогчдынх /membership/public-оос) ───
  const fxCache = new Map();          // userId -> { tier, name_effect, level }
  let fxPending = new Set();
  let fxTimer = null;

  function applyFx(node, info) {
    node.classList.remove(...FX_CLASSES);
    const fx = info?.name_effect;
    if (fx && fx !== 'solid') node.classList.add(`name-fx-${fx}`);
    node.dataset.tier = info?.tier || 'bronze';
  }
  function applyFrame(node, tier) {
    if (!node) return;
    node.classList.remove('avatar-frame', 'silver', 'gold');
    if (tier === 'silver' || tier === 'gold') node.classList.add('avatar-frame', tier);
  }
  const FX_SEL = '.clickable-name[data-user-id], .dm-username[data-user-id], [data-fx-user]';
  function decorate(root) {
    if (!root?.querySelectorAll) return;
    const nodes = [...root.querySelectorAll(FX_SEL)];
    if (root.matches?.(FX_SEL)) nodes.push(root);
    nodes.forEach((node) => {
      const id = String(node.dataset.userId || node.dataset.fxUser || '');
      if (!id || id === 'undefined' || id === 'null') return;
      if (fxCache.has(id)) applyFx(node, fxCache.get(id));
      else { fxPending.add(id); scheduleFxFetch(); }
    });
  }
  function scheduleFxFetch() {
    clearTimeout(fxTimer);
    fxTimer = setTimeout(async () => {
      const ids = [...fxPending].slice(0, 200);
      fxPending.clear();
      if (!ids.length || !window.api?.request) return;
      try {
        const rows = await api('get', `/membership/public?ids=${ids.join(',')}`);
        (rows || []).forEach((r) => fxCache.set(String(r.id), { tier: r.tier, name_effect: r.name_effect, level: r.level }));
      } catch {}
      ids.forEach((id) => { if (!fxCache.has(id)) fxCache.set(id, { tier: 'bronze', name_effect: 'solid', level: 1 }); });
      decorate(document);
    }, 150);
  }
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach((n) => { if (n.nodeType === 1) decorate(n); });
  }).observe(document.body, { childList: true, subtree: true });

  function tagOwnName() {
    const id = currentUser?.id;
    if (!id) return;
    ['user-name', 'profile-name'].forEach((i) => { const n = el(i); if (n) n.dataset.fxUser = String(id); });
  }

  const _openUserProfile = openUserProfile;
  openUserProfile = async function (userId) {
    const r = await _openUserProfile(userId);
    const name = el('popup-username');
    if (name) { name.dataset.fxUser = String(userId); decorate(name); }
    const av = el('popup-avatar');
    const paint = () => applyFrame(av, fxCache.get(String(userId))?.tier);
    paint();
    setTimeout(paint, 700);
    return r;
  };

  // ─── 3. Diamond 💎 + XP/Level ───
  function renderDiamonds() {
    if (!currentUser) return;
    const dia = Number(currentUser.diamonds ?? 0);
    const xp = Number(currentUser.xp ?? 0);
    const level = Number(currentUser.level ?? 1);
    const nextXp = currentUser.next_level_xp || Math.round(100 * Math.pow(level + 1, 1.5));
    const curXp = Math.round(100 * Math.pow(level, 1.5));
    const prog = Math.max(0, Math.min(1, (xp - curXp) / Math.max(1, nextXp - curXp)));
    const bg = Number(currentUser.block_games ?? 0);
    const bw = Number(currentUser.block_wins ?? 0);

    const unlimited = !!currentUser.unlimited_diamonds;
    const diaText = unlimited ? '💎 ∞' : `💎 ${fmtN(dia)}`;
    el('user-wallet')?.classList.remove('hidden');
    const amt = el('user-wallet-amount');
    if (amt) amt.textContent = diaText;
    el('diamond-owner-badge')?.classList.toggle('hidden', !unlimited);
    el('btn-admin-dashboard')?.classList.toggle('hidden', !(currentUser.is_admin || currentUser.is_owner));
    document.querySelectorAll('.diamond-amount').forEach((n) => n.classList.toggle('unlimited', unlimited));
    const lv = el('user-level');
    if (lv) { lv.textContent = `LV ${level}`; lv.classList.remove('hidden'); }
    const tierPill = el('user-tier');
    if (tierPill) { const t = myTier(); tierPill.textContent = TIER_NAME[t]; tierPill.classList.toggle('hidden', t === 'bronze'); }

    document.querySelectorAll('[data-diamonds]').forEach((n) => { n.textContent = diaText; });
    const need = Math.max(0, 5 - bw);
    const left = Math.max(0, 10 - bg);
    const blockText = el('diamond-block-text');
    if (blockText) {
      blockText.textContent = bg === 0
        ? 'Шинэ 10 тоглолтын блок эхэлж байна — 5 хожвол +30 💎'
        : `Энэ блок: ${bw} хожил / ${bg} тоглолт · ${need === 0 ? '+30 💎 баталгаажсан ✓' : `+30 💎-д ${need} хожил дутуу`} · ${left} тоглолт үлдлээ`;
    }
    const bar = el('diamond-block-bar');
    if (bar) bar.style.width = `${Math.round((bg / 10) * 100)}%`;
    const lvText = el('diamond-level-text');
    if (lvText) lvText.textContent = `LV ${level} · ${fmtN(xp)} XP · дараагийн түвшин ${fmtN(nextXp)} XP`;
    const xpBar = el('diamond-xp-bar');
    if (xpBar) xpBar.style.width = `${Math.round(prog * 100)}%`;
  }

  // ─── 4. QPay төлбөрийн modal ───
  let payPoll = null;
  function openPayModal(order, title) {
    const m = el('pay-modal');
    if (!m) return;
    m.classList.remove('hidden');
    m.dataset.orderId = order.invoice_id;
    el('pay-title').textContent = title;
    el('pay-amount').textContent = `${fmtN(order.amount)}₮`;
    const qr = el('pay-qr');
    if (order.qr_image) {
      qr.src = String(order.qr_image).startsWith('data:') ? order.qr_image : `data:image/png;base64,${order.qr_image}`;
      qr.style.display = 'block';
    } else {
      qr.style.display = 'none';
    }
    const link = el('pay-link');
    link.textContent = order.short_url || '';
    link.dataset.url = order.short_url || '';
    el('pay-status').textContent = 'Төлбөр хүлээж байна… (QPay апп-аар QR уншуулна)';
    clearInterval(payPoll);
    let ticks = 0;
    payPoll = setInterval(() => { if (++ticks > 120) { clearInterval(payPoll); return; } checkPay(); }, 5000);
  }
  function closePay() { clearInterval(payPoll); el('pay-modal')?.classList.add('hidden'); }
  async function checkPay() {
    const m = el('pay-modal');
    const id = m?.dataset.orderId;
    if (!id || m.classList.contains('hidden')) return;
    try {
      const st = await api('get', `/membership/order/${encodeURIComponent(id)}`);
      if (st.paid) {
        clearInterval(payPoll);
        el('pay-status').textContent = '✅ Төлбөр баталгаажлаа';
        showToast(st.kind === 'diamonds' ? 'Төлбөр амжилттай — Diamond 💎 нэмэгдлээ' : 'Төлбөр амжилттай — гишүүнчлэл идэвхжлээ', 'success');
        await refreshMe();
        setTimeout(closePay, 1500);
      } else if (st.status === 'CANCELLED') {
        clearInterval(payPoll);
        el('pay-status').textContent = 'Нэхэмжлэх цуцлагдсан';
      }
    } catch {}
  }
  el('btn-pay-check')?.addEventListener('click', checkPay);
  el('btn-pay-close')?.addEventListener('click', closePay);
  el('btn-pay-copy')?.addEventListener('click', () => {
    const u = el('pay-link')?.dataset.url;
    if (u) { navigator.clipboard?.writeText(u); showToast('Төлбөрийн холбоос хуулагдлаа', 'success'); }
  });

  // ─── 5. Гишүүнчлэл + нэрийн эффект сонголт ───
  function renderMembership() {
    const tier = myTier();
    const until = currentUser?.membership_until;
    const cur = el('membership-current');
    if (cur) { cur.textContent = TIER_NAME[tier]; cur.className = `tier-badge tier-${tier}`; }
    const untilEl = el('membership-until');
    if (untilEl) {
      untilEl.textContent = tier === 'bronze'
        ? 'Үнэгүй · хугацаагүй'
        : (until ? `${new Date(until).toLocaleDateString('mn-MN', { year: 'numeric', month: '2-digit', day: '2-digit' })} хүртэл` : '');
    }
    document.querySelectorAll('.tier-card').forEach((c) => c.classList.toggle('current', c.dataset.tier === tier));
    const canFx = tier !== 'bronze';
    const fx = canFx ? (currentUser?.name_effect || 'solid') : 'solid';
    document.querySelectorAll('#fx-picker [data-fx]').forEach((b) => {
      b.classList.toggle('active', b.dataset.fx === fx);
      b.disabled = !canFx && b.dataset.fx !== 'solid';
    });
    el('fx-lock-note')?.classList.toggle('hidden', canFx);
    if (currentUser?.id) fxCache.set(String(currentUser.id), { tier, name_effect: fx, level: currentUser.level || 1 });
    tagOwnName();
    decorate(document);
    applyFrame(document.querySelector('.userchip-avatar'), tier);
    applyFrame(document.querySelector('.profile-avatar-wrap'), tier);
    el('room-bg')?.classList.toggle('hidden', tier !== 'gold');
    el('room-bg-hint')?.classList.toggle('hidden', tier === 'gold');
  }
  document.querySelectorAll('#fx-picker [data-fx]').forEach((b) => b.addEventListener('click', async () => {
    try {
      const r = await api('put', '/membership/name-effect', { effect: b.dataset.fx });
      if (currentUser) currentUser.name_effect = r.name_effect;
      renderMembership();
    } catch (e) { showToast(errMsg(e), 'error'); }
  }));
  document.querySelectorAll('[data-buy-tier]').forEach((b) => b.addEventListener('click', async () => {
    const tier = b.dataset.buyTier;
    const payWith = el('membership-pay-with')?.value || 'qpay';
    if (payWith === 'diamonds') {
      const ok = await showConfirm(`${TIER_NAME[tier]} гишүүнчлэл`, `${fmtN(TIER_DIAMONDS[tier])} 💎-оор 30 хоногийн ${TIER_NAME[tier]} гишүүнчлэл авах уу? (Танд ${fmtN(currentUser?.diamonds || 0)} 💎 байна)`);
      if (!ok) return;
    }
    b.disabled = true;
    try {
      const r = await api('post', '/membership/order', { tier, months: 1, pay_with: payWith });
      if (r.paid) { showToast(`${TIER_NAME[tier]} гишүүнчлэл идэвхжлээ 🎉`, 'success'); await refreshMe(); }
      else openPayModal({ ...r, kind: 'membership' }, `${TIER_NAME[tier]} гишүүнчлэл — QPay`);
    } catch (e) { showToast(errMsg(e), 'error'); }
    finally { b.disabled = false; }
  }));

  // ─── 6. Өрөөний дэвсгэр (GOLD, room цонхонд) ───
  if (isRoomMode()) {
    const bg = new URLSearchParams(window.location.search).get('backgroundUrl') || '';
    if (/^https:\/\/\S+$/i.test(bg)) {
      const pr = el('page-room');
      if (pr) {
        pr.style.backgroundImage = `linear-gradient(rgba(8,4,5,.55), rgba(8,4,5,.8)), url("${bg.replace(/"/g, '%22')}")`;
        pr.style.backgroundSize = 'cover';
        pr.style.backgroundPosition = 'center';
      }
    }
  }

  // ─── Холбох ───
  async function refreshMe() {
    try {
      await window.api.refreshUser?.();
      const u = await window.api.getUser();
      if (u) { currentUser = { ...currentUser, ...u }; renderAll(); }
    } catch {}
  }
  function renderAll() { renderDiamonds(); renderMembership(); }
  window.__premium = { openPayModal, refreshMe, renderAll };
  const _setUserUI = setUserUI;
  setUserUI = function (u) { _setUserUI(u); renderAll(); };
  const _showPage = showPage;
  showPage = function (id) { _showPage(id); if (id === 'page-main') refreshMe(); };
  window.addEventListener('focus', () => { if (currentUser && !isRoomMode()) refreshMe(); });
  if (currentUser) renderAll();
})();

// ══════════════════════════════════════════════════════════════
// Тоглогч-хост LAN (RGC/GameRanger) — өрөөний гишүүн ӨӨРИЙН PC дээр WC3 LAN тоглоом нээж,
// public relay-ээр дамжуулан өрөөнийхэнтэйгээ (ямар ч NAT-аас үл хамааран) холбогдоно.
// Тоглоом ЗӨВХӨН тухайн ӨРӨӨНД харагдана (сервер зөвхөн өрөөнд room:lan_lobby emit).
// ══════════════════════════════════════════════════════════════
(function lanHostModule() {
  if (!isRoomMode()) return;
  const el = (id) => document.getElementById(id);
  const api = (method, path, body) => window.api.request(method, path, body);
  const errMsg = (e) => String(e?.message || e || 'Алдаа гарлаа').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const panel = el('lan-host-panel');
  if (!panel) return;

  let hosting = null;          // { token } — миний хостолж буй тоглоом
  const games = new Map();     // token -> game (өрөөний идэвхтэй тоглоомууд)
  let joinedToken = null;      // одоо WC3-д нээж буй тоглоом

  const getWc3Name = async () => { try { return (await window.api.getWc3Name?.()) || null; } catch { return null; } };
  const esc = (s) => (typeof escHtml === 'function' ? escHtml(s || '') : String(s || ''));

  function setHostState(txt, state) {
    const s = el('lan-host-state'); if (s) { s.textContent = state ? state.toUpperCase() : 'БЭЛЭН'; s.dataset.state = state || 'idle'; }
    const t = el('lan-host-text'); if (t && txt) t.textContent = txt;
    // "LAN тоглоом нээх" зөвхөн ХОСТ-д (өрөө үүсгэсэн хүн) харагдана. Joiner зөвхөн "Нэгдэх" харна.
    const amHost = !!currentRoom?.isHost;
    el('btn-lan-host')?.classList.toggle('hidden', !amHost || !!hosting);
    el('btn-lan-stop')?.classList.toggle('hidden', !amHost || !hosting);
  }

  function renderGames() {
    const box = el('lan-games-list'); if (!box) return;
    const list = [...games.values()].filter((g) => String(g.host_user_id) !== String(currentUser?.id));
    if (!list.length) { box.innerHTML = '<div class="lan-hint">Идэвхтэй тоглоом алга. Хэн нэг нь "LAN тоглоом нээх" дарвал энд гарч ирнэ.</div>'; return; }
    box.innerHTML = list.map((g) => `
      <div class="lan-game-row" data-token="${g.game_token}">
        <span class="lan-game-info">🎮 <b>${esc(g.host_wc3_name || g.host_username || 'Тоглогч')}</b>-ийн тоглоом</span>
        <button class="lan-join-btn ${joinedToken === g.game_token ? 'joined' : ''}" data-join="${g.game_token}">${joinedToken === g.game_token ? '✓ WC3-д нээгдсэн' : 'Нэгдэх'}</button>
      </div>`).join('');
    box.querySelectorAll('[data-join]').forEach((b) => b.addEventListener('click', () => joinGame(b.getAttribute('data-join'))));
  }

  // ── ХОСТ болох ──
  async function startHosting() {
    const btn = el('btn-lan-host'); if (btn) btn.disabled = true;
    try {
      const r = await api('post', `/rooms/${currentRoom.id}/lan-host/begin`);
      hosting = { token: r.game_token };
      const wc3Name = await getWc3Name();
      await window.api.launchGame(currentRoom?.gameType || '');
      await window.api.startLanHost({ relayIp: r.relay_ip, relayPort: r.relay_port, game: r.game_token, relayKey: r.relay_key, wc3Name: wc3Name || '' });
      setHostState('WC3 нээгдэж байна… "Local Area Network" → "Create Game" → өөрийн map-аа сонгож тоглоом үүсгэ. Дараа өрөөнийхэн чинь автоматаар харна.', 'hosting');
      appendSysMsg('🎮 WC3 нээгдэж байна. LAN → Create Game → map сонгож тоглоомоо үүсгээрэй — өрөөнийхэн чинь нэгдэнэ.');
    } catch (e) { hosting = null; showToast(errMsg(e), 'error'); setHostState('LAN тоглоом нээгээд өрөөнийхнөө урина.', 'idle'); }
    finally { if (btn) btn.disabled = false; }
  }

  async function stopHosting() {
    const tok = hosting?.token; hosting = null;
    setHostState('Зогсоов.', 'idle');
    try { await window.api.stopLanHost?.(); } catch {}
    if (tok) { try { await api('delete', `/rooms/${currentRoom.id}/lan-host/${tok}`); } catch {} }
  }

  // GAMEINFO баригдмагц серверт зарлана (announce) → room:lan_lobby зөвхөн өрөөнд
  window.api.onLanGameInfo?.(async ({ gameinfo_b64 } = {}) => {
    if (!hosting?.token || !gameinfo_b64) return;
    try {
      const wc3Name = await getWc3Name();
      await api('post', `/rooms/${currentRoom.id}/lan-host/announce`, { game_token: hosting.token, gameinfo_b64, host_wc3_name: wc3Name || undefined });
      setHostState('✅ Тоглоом зарлагдлаа — өрөөнийхэн чинь LAN жагсаалтаас нэгдэнэ.', 'live');
    } catch { /* дараагийн probe-д дахин оролдоно */ }
  });

  // ── ТОГЛООМД НЭГДЭХ (joiner) ──
  async function joinGame(token) {
    const g = games.get(token); if (!g) return;
    try {
      if (joinedToken && joinedToken !== token) { try { await window.api.stopLanJoin?.(); } catch {} }
      await window.api.launchGame(currentRoom?.gameType || '');
      await window.api.startLanJoin({ relayIp: g.relay_ip, relayPort: g.relay_port, game: g.game_token, gameInfoB64: g.gameinfo_b64 });
      joinedToken = token; renderGames();
      appendSysMsg(`🎮 «${g.host_wc3_name || g.host_username}»-ийн тоглоомд нэгдэж байна — WC3 → Local Area Network → тоглоомоо сонгож ор.`);
    } catch (e) { showToast(errMsg(e), 'error'); }
  }

  function attach(s) {
    s.on('room:lan_lobby', (g) => {
      if (!g?.game_token) return;
      games.set(g.game_token, g);
      if (String(g.host_user_id) === String(currentUser?.id)) return;   // өөрийн тоглоом
      if (joinedToken === g.game_token && g.gameinfo_b64) window.api.updateLanJoin?.({ gameInfoB64: g.gameinfo_b64 }).catch(() => {});
      else appendSysMsg(`🎮 «${g.host_wc3_name || g.host_username}» LAN тоглоом нээлээ — "Нэгдэх" дарж WC3-даа харна.`);
      renderGames();
    });
    s.on('room:lan_lobby_gone', ({ game_token } = {}) => {
      if (!game_token) return;
      games.delete(game_token);
      if (joinedToken === game_token) { joinedToken = null; window.api.stopLanJoin?.().catch(() => {}); appendSysMsg('⏹ Тоглоом хаагдлаа.'); }
      renderGames();
    });
  }

  async function loadExisting() {
    try {
      const r = await api('get', `/rooms/${currentRoom.id}/lan-host`);
      if (!r?.relay_configured) { panel.classList.add('hidden'); return; }
      panel.classList.remove('hidden');
      // Товч/зөвлөмжийг ролиор нь: зөвхөн хост "LAN тоглоом нээх" харна
      const amHost = !!currentRoom?.isHost;
      el('btn-lan-host')?.classList.toggle('hidden', !amHost);
      el('btn-lan-stop')?.classList.add('hidden');
      const hintEl = el('lan-host-text');
      if (hintEl) hintEl.textContent = amHost
        ? 'Өөрийн WC3 LAN тоглоом нээж, өрөөнийхнөө урина. Ямар ч интернэтээс холбогдоно.'
        : 'Хост тоглоом нээхэд доор гарч ирнэ — "Нэгдэх" дарж WC3-даа ор.';
      (r.games || []).forEach((g) => games.set(g.game_token, g));
      renderGames();
    } catch { /* relay тохируулаагүй */ }
  }

  el('btn-lan-host')?.addEventListener('click', startHosting);
  el('btn-lan-stop')?.addEventListener('click', stopHosting);

  const timer = setInterval(() => {
    if (typeof socket !== 'undefined' && socket && !socket.__lanHandlers) { socket.__lanHandlers = true; attach(socket); }
    if (currentRoom?.id && !panel.dataset.loaded) { panel.dataset.loaded = '1'; loadExisting(); }
  }, 800);
  window.addEventListener('beforeunload', () => { clearInterval(timer); if (hosting) window.api.stopLanHost?.().catch(() => {}); window.api.stopLanJoin?.().catch(() => {}); });
})();

// ══════════════════════════════════════════════════════════════
// Diamond 💎 — хэрэглэгч хоорондын шилжүүлэг, QPay багц, гүйлгээний түүх, эзэн/админ, socket мэдэгдэл
// ══════════════════════════════════════════════════════════════
(function diamondModule() {
  const el = (id) => document.getElementById(id);
  const api = (method, path, body) => window.api.request(method, path, body);
  const fmtN = (n) => Number(n || 0).toLocaleString('en-US');
  const errMsg = (e) => String(e?.message || e || 'Алдаа гарлаа').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const prem = () => window.__premium || {};
  const refreshMe = () => prem().refreshMe?.();

  // ─── Шилжүүлэх modal ───
  let target = null;          // { id, username }
  let searchTimer = null;
  const modal = el('diamond-transfer-modal');
  function setStatus(id, text, cls) { const n = el(id); if (n) { n.textContent = text || ''; n.className = `dia-status ${cls || ''}`; } }
  function openTransfer(preset) {
    if (!modal) return;
    target = preset || null;
    el('dia-to-search').value = '';
    el('dia-search-results').innerHTML = '';
    el('dia-amount').value = '';
    el('dia-note').value = '';
    setStatus('dia-status', currentUser?.unlimited_diamonds ? 'Та эзэн — шилжүүлэг үлдэгдлээс хасагдахгүй.' : `Танд ${fmtN(currentUser?.diamonds || 0)} 💎 байна.`);
    renderTarget();
    modal.classList.remove('hidden');
    (target ? el('dia-amount') : el('dia-to-search')).focus();
  }
  function closeTransfer() { modal?.classList.add('hidden'); }
  function renderTarget() {
    const box = el('dia-selected');
    const search = el('dia-to-search');
    if (target) {
      el('dia-selected-name').textContent = `${target.username} (#${target.id})`;
      box.classList.remove('hidden');
      search.classList.add('hidden');
      el('dia-search-results').innerHTML = '';
    } else {
      box.classList.add('hidden');
      search.classList.remove('hidden');
    }
  }
  el('dia-to-search')?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = el('dia-to-search').value.trim();
    if (q.length < 2) { el('dia-search-results').innerHTML = ''; return; }
    searchTimer = setTimeout(async () => {
      try {
        const rows = await window.api.searchUsers(q);
        const list = (rows || []).slice(0, 10);
        el('dia-search-results').innerHTML = list.length
          ? list.map((u) => `<div class="dia-user-row" data-id="${escHtml(String(u.id))}" data-name="${escHtml(u.username)}">${u.avatar_url ? `<img src="${escHtml(u.avatar_url)}" alt="">` : '<span class="dia-avatar"></span>'}<span class="clickable-name" data-user-id="${escHtml(String(u.id))}">${escHtml(u.username)}</span><small>#${escHtml(String(u.id))}</small></div>`).join('')
          : '<div class="dia-user-row"><span>Олдсонгүй</span></div>';
      } catch { el('dia-search-results').innerHTML = ''; }
    }, 250);
  });
  el('dia-search-results')?.addEventListener('click', (e) => {
    const row = e.target.closest('.dia-user-row[data-id]');
    if (!row) return;
    e.stopPropagation();
    target = { id: row.dataset.id, username: row.dataset.name };
    renderTarget();
    el('dia-amount').focus();
  });
  el('dia-selected-clear')?.addEventListener('click', () => { target = null; renderTarget(); el('dia-to-search').focus(); });
  el('btn-dia-cancel')?.addEventListener('click', closeTransfer);
  el('btn-dia-send')?.addEventListener('click', async () => {
    const amount = parseInt(el('dia-amount').value, 10);
    if (!target) { setStatus('dia-status', 'Хүлээн авагчаа сонгоно уу', 'error'); return; }
    if (!Number.isInteger(amount) || amount < 1) { setStatus('dia-status', 'Дүнгээ оруулна уу (1+ 💎)', 'error'); return; }
    const ok = await showConfirm('Diamond шилжүүлэх', `${target.username} (#${target.id}) руу ${fmtN(amount)} 💎 шилжүүлэх үү? Шилжүүлэг буцаагдахгүй.`);
    if (!ok) return;
    const btn = el('btn-dia-send');
    btn.disabled = true;
    setStatus('dia-status', 'Илгээж байна…');
    try {
      const r = await api('post', '/diamonds/transfer', { to: target.id, amount, note: el('dia-note').value.trim() });
      setStatus('dia-status', `✅ ${fmtN(r.amount)} 💎 → ${r.to.username}`, 'ok');
      showToast(`${fmtN(r.amount)} 💎 ${r.to.username}-д шилжүүллээ`, 'success');
      if (currentUser && !r.unlimited && r.diamonds != null) currentUser.diamonds = r.diamonds;
      prem().renderAll?.();
      await refreshMe();
      setTimeout(closeTransfer, 900);
    } catch (e) {
      setStatus('dia-status', errMsg(e), 'error');
    } finally { btn.disabled = false; }
  });
  el('btn-diamond-transfer')?.addEventListener('click', () => openTransfer(null));

  // Профайл popup дээрх "💎 Diamond илгээх" товч
  let popupUser = null;
  const _open = openUserProfile;
  openUserProfile = async function (userId) {
    const r = await _open(userId);
    popupUser = { id: String(userId), username: el('popup-username')?.textContent || '' };
    const b = el('btn-popup-diamond');
    if (b) b.classList.toggle('hidden', !currentUser || String(currentUser.id) === String(userId));
    return r;
  };
  el('btn-popup-diamond')?.addEventListener('click', () => {
    if (!popupUser) return;
    el('user-profile-modal')?.classList.add('hidden');
    openTransfer({ id: popupUser.id, username: el('popup-username')?.textContent || popupUser.username });
  });

  // ─── Багц авах (QPay) ───
  let packs = null;
  async function openBuy() {
    const m = el('diamond-buy-modal');
    if (!m) return;
    m.classList.remove('hidden');
    setStatus('dia-buy-status', '');
    try {
      if (!packs) packs = await api('get', '/diamonds/packs');
      const grid = el('dia-pack-grid');
      grid.innerHTML = (packs.packs || []).map((p) => `<button type="button" class="dia-pack" data-pack="${escHtml(p.key)}"><b>💎 ${fmtN(p.diamonds)}</b><small>${fmtN(p.price)}₮</small></button>`).join('');
      if (!packs.payments_enabled) setStatus('dia-buy-status', 'QPay төлбөр хараахан идэвхжээгүй — админаас Diamond авах боломжтой.', 'error');
    } catch (e) { setStatus('dia-buy-status', errMsg(e), 'error'); }
  }
  el('btn-diamond-buy')?.addEventListener('click', openBuy);
  el('btn-dia-buy-close')?.addEventListener('click', () => el('diamond-buy-modal')?.classList.add('hidden'));
  el('dia-pack-grid')?.addEventListener('click', async (e) => {
    const b = e.target.closest('.dia-pack[data-pack]');
    if (!b) return;
    b.disabled = true;
    try {
      const order = await api('post', '/diamonds/buy', { pack: b.dataset.pack });
      el('diamond-buy-modal')?.classList.add('hidden');
      prem().openPayModal?.(order, `${fmtN(order.diamonds)} 💎 — QPay`);
    } catch (err) { setStatus('dia-buy-status', errMsg(err), 'error'); }
    finally { b.disabled = false; }
  });

  // ─── Гүйлгээний түүх ───
  const TYPE_TEXT = { block_bonus: '10 тоглолтын бонус', membership: 'Гишүүнчлэл', purchase: 'QPay багц', transfer_in: 'Хүлээн авсан', transfer_out: 'Шилжүүлсэн', admin_grant: 'Админ олголт' };
  async function openHistory() {
    const m = el('diamond-history-modal');
    if (!m) return;
    m.classList.remove('hidden');
    const body = el('dia-history-body');
    body.innerHTML = '<tr><td colspan="4">Ачааллаж байна…</td></tr>';
    try {
      const rows = await api('get', '/diamonds/transactions');
      body.innerHTML = (rows || []).length
        ? rows.map((t) => `<tr><td>${escHtml(new Date(t.created_at).toLocaleString('mn-MN'))}</td><td class="amt ${t.amount > 0 ? 'pos' : (t.amount < 0 ? 'neg' : '')}">${t.amount > 0 ? '+' : ''}${fmtN(t.amount)} 💎</td><td>${escHtml(TYPE_TEXT[t.type] || t.type)}</td><td class="note">${escHtml(t.note || '')}</td></tr>`).join('')
        : '<tr><td colspan="4">Гүйлгээ алга — тоглоод 10 тоглолтоос 5-д хожвол +30 💎</td></tr>';
    } catch (e) { body.innerHTML = `<tr><td colspan="4">${escHtml(errMsg(e))}</td></tr>`; }
  }
  el('btn-diamond-history')?.addEventListener('click', openHistory);
  el('btn-dia-history-close')?.addEventListener('click', () => el('diamond-history-modal')?.classList.add('hidden'));

  // ─── Админ самбар (вэб) ───
  el('btn-admin-dashboard')?.addEventListener('click', () => {
    window.api.openExternal?.(`${SERVER}/admin`);
    showToast('Админ самбар browser дээр нээгдэнэ — Discord-оор нэвтэрнэ', 'info');
  });

  // ─── Socket мэдэгдэл: diamonds:received / diamonds:updated / membership:updated ───
  function attach(s) {
    s.on('diamonds:received', (d) => {
      if (currentUser && d.diamonds != null && !currentUser.unlimited_diamonds) currentUser.diamonds = d.diamonds;
      prem().renderAll?.();
      const who = d.from_username || 'Garena.mn';
      showToast(`💎 +${fmtN(d.amount)} Diamond — ${who}${d.note ? `: ${d.note}` : ''}`, 'success');
      try { playSound?.('join'); } catch {}
      refreshMe();
    });
    s.on('diamonds:updated', (d) => {
      if (currentUser && d.diamonds != null && !currentUser.unlimited_diamonds) currentUser.diamonds = d.diamonds;
      prem().renderAll?.();
      if (d.reason === 'purchase') showToast(`💎 +${fmtN(d.delta)} Diamond нэмэгдлээ (QPay)`, 'success');
      if (d.reason === 'admin_grant' && d.amount < 0) showToast(`💎 ${fmtN(d.amount)} Diamond (админ)`, 'warning');
    });
    s.on('membership:updated', (d) => {
      showToast(`Гишүүнчлэл: ${String(d.tier || '').toUpperCase()}${d.membership_until ? ` — ${new Date(d.membership_until).toLocaleDateString('mn-MN')} хүртэл` : ''}`, 'success');
      refreshMe();
    });
  }
  setInterval(() => {
    if (typeof socket !== 'undefined' && socket && !socket.__diaHandlers) { socket.__diaHandlers = true; attach(socket); }
  }, 1000);

  // Esc → modal-уудыг хаах
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    ['diamond-transfer-modal', 'diamond-buy-modal', 'diamond-history-modal'].forEach((id) => el(id)?.classList.add('hidden'));
  });
})();
