const { contextBridge, ipcRenderer } = require('electron');

// Renderer процесс руу аюулгүйгээр API-г нээх
contextBridge.exposeInMainWorld('api', {
  // Auth
  register:     (data) => ipcRenderer.invoke('auth:register', data),
  emailLogin:   (data) => ipcRenderer.invoke('auth:emailLogin', data),
  login:        () => ipcRenderer.invoke('auth:login'),
  linkDiscord:  () => ipcRenderer.invoke('auth:linkDiscord'),
  getQR:        () => ipcRenderer.invoke('auth:qr'),
  logout:       () => ipcRenderer.invoke('auth:logout'),
  getUser:      () => ipcRenderer.invoke('auth:getUser'),
  refreshUser:  () => ipcRenderer.invoke('auth:refreshUser'),
  getToken:     () => ipcRenderer.invoke('auth:getToken'),
  onAuthSuccess:(cb) => ipcRenderer.on('auth:success', (_, user) => cb(user)),

  // Rooms
  getRooms:     ()              => ipcRenderer.invoke('rooms:list'),
  quickMatch:   (gameType)      => ipcRenderer.invoke('rooms:quickmatch', gameType),
  getMyRoom:  ()               => ipcRenderer.invoke('rooms:mine'),
  createRoom: (data)           => ipcRenderer.invoke('rooms:create', data),
  joinRoom:   (id, pass)       => ipcRenderer.invoke('rooms:join', id, pass),
  leaveRoom:  (id)             => ipcRenderer.invoke('rooms:leave', id),
  closeRoom:  (id)             => ipcRenderer.invoke('rooms:close', id),
  updateRoom: (id, updates)    => ipcRenderer.invoke('rooms:update', id, updates),
  startRoom:  (id)             => ipcRenderer.invoke('rooms:start', id),
  endRoom:    (id)             => ipcRenderer.invoke('rooms:end', id),
  kickPlayer: (roomId, userId) => ipcRenderer.invoke('rooms:kick', roomId, userId),

  // Stats
  getPlayerStats:   (discordId) => ipcRenderer.invoke('stats:player', discordId),
  getPlayerStatsById: (userId)  => ipcRenderer.invoke('stats:playerById', userId),
  getGameHistory:   (userId, page) => ipcRenderer.invoke('stats:history', userId, page),
  getRanking:       (opts)      => ipcRenderer.invoke('stats:ranking', opts),
  syncTierBot:      (payload)   => ipcRenderer.invoke('stats:tierbotSync', payload),

  // Тоглоом дуусах event — connectSocket() дахин ажиллах бүрт бүртгэгддэг тул
  // хуучин handler-ыг эхлээд устгана (үгүй бол давхарлаж game-end 2 удаа боловсрогдоно)
  onGameResult: (cb) => { ipcRenderer.removeAllListeners('game:result'); ipcRenderer.on('game:result', (_, data) => cb(data)); },
  onGameExited: (cb) => { ipcRenderer.removeAllListeners('game:exited'); ipcRenderer.on('game:exited', () => cb()); },
  onMaphack:    (cb) => { ipcRenderer.removeAllListeners('game:maphack'); ipcRenderer.on('game:maphack', (_, d) => cb(d)); },
  killGame:     ()   => ipcRenderer.invoke('game:kill'),
  setReplayMembers: (members) => ipcRenderer.invoke('replay:setMembers', members),

  // Socket events (main → renderer)
  onRoomClosed: (cb) => ipcRenderer.on('room:closed', (_, d) => cb(d)),
  onRoomKicked: (cb) => ipcRenderer.on('room:kicked', (_, d) => cb(d)),

  // Cache
  getCacheSize:          () => ipcRenderer.invoke('cache:getSize'),
  clearCache:            () => ipcRenderer.invoke('cache:clear'),
  relaunchApp:           () => ipcRenderer.invoke('app:relaunch'),

  // Тохируулга
  getSettings:           () => ipcRenderer.invoke('settings:get'),
  selectGameExe:         () => ipcRenderer.invoke('settings:selectGameExe'),
  addGame:               (data) => ipcRenderer.invoke('settings:addGame', data),
  removeGame:            (id)   => ipcRenderer.invoke('settings:removeGame', id),

  // Firewall + сүлжээ тохиргоо
  setupFirewall:     ()          => ipcRenderer.invoke('firewall:setup'),

  // Game Relay — Host: capture+forward, Player: search+rebroadcast
  startHostRelay:  (playerIps) => ipcRenderer.invoke('relay:startHost', playerIps),
  startGameFinder: (hostIp)    => ipcRenderer.invoke('relay:startFinder', hostIp),
  stopRelay:       ()          => ipcRenderer.invoke('relay:stop'),
  addRelayPlayer:  (ip)        => ipcRenderer.invoke('relay:addHostPlayer', ip),
  startBotBridge:  (opts)      => ipcRenderer.invoke('relay:startBotBridge', opts),
  stopBotBridge:   ()          => ipcRenderer.invoke('relay:stopBotBridge'),
  updateBotBridge: (opts)      => ipcRenderer.invoke('relay:updateBotBridge', opts),
  // Тоглогч-хост LAN (relay)
  startLanHost:    (opts)      => ipcRenderer.invoke('relay:startLanHost', opts),
  stopLanHost:     ()          => ipcRenderer.invoke('relay:stopLanHost'),
  startLanJoin:    (opts)      => ipcRenderer.invoke('relay:startLanJoin', opts),
  updateLanJoin:   (opts)      => ipcRenderer.invoke('relay:updateLanJoin', opts),
  stopLanJoin:     ()          => ipcRenderer.invoke('relay:stopLanJoin'),
  onLanGameInfo:   (cb)        => ipcRenderer.on('lan:gameinfo', (_, d) => cb(d)),
  getWc3Name:      ()          => ipcRenderer.invoke('wc3:name'),
  isWc3LanReady:   ()          => ipcRenderer.invoke('wc3:lanReady'),
  isWc3Running:    ()          => ipcRenderer.invoke('wc3:running'),

  // 1.8.5: Найзууд цонх ↔ үндсэн цонх (удирдлагын товчнууд), реклам
  mainAction:      (a)         => ipcRenderer.invoke('ui:mainAction', a),
  onUiAction:      (cb)        => ipcRenderer.on('ui:action', (_, d) => cb(d)),
  notifyMainShown: ()          => ipcRenderer.invoke('ui:mainShown'),
  getAd:           ()          => ipcRenderer.invoke('config:ad'),
  onBotWc3Join:    (cb)        => ipcRenderer.on('bot:wc3-join', (_, d) => cb(d)),
  onNetLatency:    (cb)        => ipcRenderer.on('net:latency', (_, d) => cb(d)),

  // Тоглоом эхлүүлэх
  launchGame: (gameType) => ipcRenderer.invoke('game:launch', gameType),

  // Өрөөний шинэ цонх
  openRoomWindow:    (data) => ipcRenderer.invoke('room:openWindow', data),
  onRoomWindowClosed:(cb)   => ipcRenderer.on('room:window-closed', cb),

  // DM тусдаа цонх
  openDMWindow:      (data) => ipcRenderer.invoke('dm:openWindow', data),
  // Найзуудын тусдаа цонх
  openFriendsWindow: () => ipcRenderer.invoke('friends:openWindow'),
  openRadarWindow:   (data) => ipcRenderer.invoke('radar:openWindow', data),   // 📡 Радар always-on-top цонх
  radarOnTop:        (on)   => ipcRenderer.invoke('radar:onTop', on),
  onRadarSwitch:     (cb)   => ipcRenderer.on('radar:switch', (_, d) => cb(d)),
  isDMWindowOpen:    (userId) => ipcRenderer.invoke('dm:isWindowOpen', userId),
  onDMWindowClosed:  (cb)   => ipcRenderer.on('dm:window-closed', (_, data) => cb(data)),

  // Профайл зураг
  uploadAvatar: () => ipcRenderer.invoke('auth:uploadAvatar'),

  // Нууц үг солих / сэргээх
  changePassword:  (oldPassword, newPassword) => ipcRenderer.invoke('auth:changePassword', { oldPassword, newPassword }),
  forgotPassword:  (email) => ipcRenderer.invoke('auth:forgotPassword', email),
  resetPassword:   (token, newPassword) => ipcRenderer.invoke('auth:resetPassword', token, newPassword),
  unlinkDiscord:   () => ipcRenderer.invoke('auth:unlinkDiscord'),

  // Нийгмийн функцүүд (friends / block)
  getFriends:          ()             => ipcRenderer.invoke('social:friends'),
  getPendingRequests:  ()             => ipcRenderer.invoke('social:pending'),
  sendFriendRequest:   (toUserId)     => ipcRenderer.invoke('social:friendRequest', toUserId),
  acceptFriendRequest: (fromUserId)   => ipcRenderer.invoke('social:friendAccept', fromUserId),
  declineFriendRequest:(fromUserId)   => ipcRenderer.invoke('social:friendDecline', fromUserId),
  removeFriend:        (friendId)     => ipcRenderer.invoke('social:friendRemove', friendId),
  blockUser:           (targetUserId) => ipcRenderer.invoke('social:block', targetUserId),
  unblockUser:         (targetUserId) => ipcRenderer.invoke('social:unblock', targetUserId),
  getBlockedUsers:     ()             => ipcRenderer.invoke('social:blocked'),
  searchUsers:         (query)        => ipcRenderer.invoke('social:search', query),

  // DM түүх
  getDMHistory:  (userId)              => ipcRenderer.invoke('social:dmHistory', userId),
  getDMHistoryBefore: (userId, before) => ipcRenderer.invoke('social:dmHistory:before', userId, before),
  getUnreadCount: ()                   => ipcRenderer.invoke('social:unread'),
  markDMRead:    (fromUserId)          => ipcRenderer.invoke('social:markRead', fromUserId),

  // Discord Servers
  getDiscordServers:   ()         => ipcRenderer.invoke('discord:getServers'),
  addDiscordServer:    (data)     => ipcRenderer.invoke('discord:addServer', data),
  editDiscordServer:   (id, data) => ipcRenderer.invoke('discord:editServer', id, data),
  deleteDiscordServer: (id)       => ipcRenderer.invoke('discord:deleteServer', id),
  openDiscordInvite:   (url)      => ipcRenderer.invoke('discord:openInvite', url),

  // Streamers
  getStreamers:   ()         => ipcRenderer.invoke('streamers:getAll'),
  addStreamer:     (data)     => ipcRenderer.invoke('streamers:add', data),
  editStreamer:    (id, data) => ipcRenderer.invoke('streamers:edit', id, data),
  deleteStreamer:  (id)       => ipcRenderer.invoke('streamers:delete', id),
  openStreamerUrl: (url)      => ipcRenderer.invoke('streamers:openUrl', url),

  // Auto-update
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_, info) => cb(info)),
  onUpdateProgress:  (cb) => ipcRenderer.on('update:progress',  (_, pct)  => cb(pct)),
  onUpdateDownloaded:(cb) => ipcRenderer.on('update:downloaded', (_, info) => cb(info)),
  installUpdate:     ()   => ipcRenderer.invoke('update:install'),
  onUpdateError:     (cb) => ipcRenderer.on('update:error', (_, msg) => cb(msg)),
  checkForUpdates:   ()   => ipcRenderer.invoke('update:check'),
  getAppVersion:     ()   => ipcRenderer.invoke('update:version'),

  // Ерөнхий API хүсэлт (Diamond 💎, гишүүнчлэл, бот хост)
  request: (method, path, body) => ipcRenderer.invoke('api:request', { method, path, body }),
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
});
