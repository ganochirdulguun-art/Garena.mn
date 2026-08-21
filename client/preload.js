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

  // Тоглоом дуусах event
  onGameResult: (cb) => ipcRenderer.on('game:result', (_, data) => cb(data)),
  onGameExited: (cb) => ipcRenderer.on('game:exited', () => cb()),
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
  setZerotierNetwork:    (id)   => ipcRenderer.invoke('settings:setZerotierNetwork', id),

  // Firewall + сүлжээ тохиргоо
  setupFirewall:     ()          => ipcRenderer.invoke('firewall:setup'),

  // ZeroTier статус
  getZerotierStatus: (networkId) => ipcRenderer.invoke('zt:status', networkId),
  getZerotierIp:     (networkId) => ipcRenderer.invoke('zt:ip', networkId),
  getZerotierNodeId: ()          => ipcRenderer.invoke('zt:nodeId'),
  refreshZerotier:   ()          => ipcRenderer.invoke('zt:refresh'),
  downloadZerotier:  ()          => ipcRenderer.invoke('zt:download'),

  // Game Relay — Host: capture+forward, Player: search+rebroadcast
  startHostRelay:  (playerIps) => ipcRenderer.invoke('relay:startHost', playerIps),
  startGameFinder: (hostIp)    => ipcRenderer.invoke('relay:startFinder', hostIp),
  stopRelay:       ()          => ipcRenderer.invoke('relay:stop'),
  addRelayPlayer:  (ip)        => ipcRenderer.invoke('relay:addHostPlayer', ip),
  startBotBridge:  (opts)      => ipcRenderer.invoke('relay:startBotBridge', opts),
  stopBotBridge:   ()          => ipcRenderer.invoke('relay:stopBotBridge'),

  // Тоглоом эхлүүлэх
  launchGame: (gameType) => ipcRenderer.invoke('game:launch', gameType),

  // Өрөөний шинэ цонх
  openRoomWindow:    (data) => ipcRenderer.invoke('room:openWindow', data),
  onRoomWindowClosed:(cb)   => ipcRenderer.on('room:window-closed', cb),

  // DM тусдаа цонх
  openDMWindow:      (data) => ipcRenderer.invoke('dm:openWindow', data),
  // Найзуудын тусдаа цонх
  openFriendsWindow: () => ipcRenderer.invoke('friends:openWindow'),
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

  // ZeroTier автомат тохиргоо
  onZtSetupComplete: (cb) => ipcRenderer.on('zt:setup-complete', (_, result) => cb(result)),

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
