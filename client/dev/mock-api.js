// UI урьдчилан харах (dev only) — preload-гүй хөтөч дотор app.js-ийг хуурамч өгөгдлөөр ажиллуулна.
// Бүтээгдэхүүнд ОРОХГҮЙ (package.json build.files: "!dev/**").
(function () {
  const q = new URLSearchParams(location.search);
  const loggedIn = q.get('login') !== '0';
  const now = Date.now();
  const user = {
    id: 1, username: 'VitoCorleone', discord_username: 'VitoCorleone', tierbot_tier: '1-1',
    avatar_url: '', tier: q.get('tier') || 'gold', membership_until: new Date(now + 20 * 864e5).toISOString(),
    diamonds: 2480, xp: 5320, level: 17, next_level_xp: 7000, block_games: 6, block_wins: 4,
    play_seconds_total: 184000, play_next_diamond_sec: 1400, name_effect: 'neon', is_owner: true, unlimited_diamonds: false, banner_ver: q.get('banner') ? 1 : null,
  };
  const M = (id, name, tier) => ({ id, name, tier });
  const rooms = [
    { id: 11, name: 'dota lod 6.74v5e', game_type: 'Warcraft III: The Frozen Throne', game_mode: 'LoD', status: 'waiting', ranked: true,
      host_id: 1, host_name: 'VitoCorleone', player_count: 7, max_players: 10, has_password: false, description: 'Ranked 5v5 · -ff 12 мин',
      members: [M(1, 'VitoCorleone', '1-1'), M(2, 'Billionaire', '2-3'), M(3, 'Eboshdee', '3-1'), M(4, 'qwe', '4-2'), M(5, 'Benihen', '2-1'), M(6, 'FaSi', '3-2'), M(7, 'Peozzzz', '5-1')] },
    { id: 12, name: 'DotA AP 6.83d', game_type: 'Warcraft III: The Frozen Throne', game_mode: 'AP', status: 'playing', ranked: false,
      host_id: 8, host_name: 'Tom_Noiton', player_count: 10, max_players: 10, has_password: false, playing_since: new Date(now - 23 * 6e4).toISOString(),
      members: [M(8, 'Tom_Noiton', '2-2'), M(9, 'sda', '4-1'), M(10, 'aa', '3-3')] },
    { id: 13, name: 'Test 1.26a 3v3', game_type: 'Warcraft III: The Frozen Throne', game_mode: 'Custom', status: 'waiting',
      host_id: 14, host_name: 'Ferdi', player_count: 1, max_players: 6, has_password: true, members: [M(14, 'Ferdi')] },
    { id: 14, name: 'IMBA 3.84 fun', game_type: 'DotA IMBA', game_mode: 'IM', status: 'waiting',
      host_id: 15, host_name: 'MAYASTRO', player_count: 4, max_players: 10, has_password: false, members: [M(15, 'MAYASTRO'), M(16, 'love68')] },
    { id: 16, name: 'MNL дотоод 5v5', game_type: 'Warcraft III: The Frozen Throne', game_mode: 'CM', status: 'waiting', clan_id: 1, clan_name: 'Mongol Lords', clan_tag: 'MNL', host_id: 2, host_name: 'Billionaire', player_count: 6, max_players: 10, has_password: false, created_at: new Date(now - 9 * 6e4).toISOString(), members: [M(2, 'Billionaire'), M(3, 'Eboshdee')] },
    { id: 15, name: '1v1 mid only', game_type: 'DotA IMBA', game_mode: 'SD', status: 'waiting',
      host_id: 17, host_name: 'AnTyC', player_count: 2, max_players: 2, has_password: true, members: [M(17, 'AnTyC'), M(18, 'bliz')] },
  ];
  const friends = [
    { id: 2, username: 'Billionaire', avatar_url: '' }, { id: 3, username: 'Eboshdee', avatar_url: '' },
    { id: 8, username: 'Tom_Noiton', avatar_url: '' }, { id: 20, username: 'Sarnai', avatar_url: '' },
  ];
  const settings = { games: [{ id: 'w3', name: 'Warcraft III: The Frozen Throne', path: 'C:\\Program Files (x86)\\Warcraft III\\war3.exe' }, { id: 'imba', name: 'DotA IMBA', path: 'C:\\Games\\W3\\war3.exe' }] };
  const noop = () => {};
  const specific = {
    getUser: async () => (loggedIn ? user : null), refreshUser: async () => true, getToken: async () => 'preview',
    getRooms: async () => rooms, getMyRoom: async () => ({ id: 11, game_mode: 'lod', ranked: true, has_password: false, clan_id: q.get('clanroom') ? 1 : null, clan_tag: 'MNL' }), getSettings: async () => settings,
    getFriends: async () => friends, getPendingRequests: async () => [{ id: 30, username: 'Khulan', avatar_url: '' }], getBlockedUsers: async () => [],
    getAppVersion: async () => '2.9.0 (preview)', getUnreadCount: async () => ({}), getDiscordServers: async () => [], getStreamers: async () => [],
    getRanking: async () => ({ rows: [], total: 0 }), getGameHistory: async () => ({ rows: [], total: 0 }), getCacheSize: async () => ({ total: 0 }),
    getAd: async () => null,
    ipGameKind: async (t) => (/counter|cs/i.test(String(t)) ? 'cs16' : /quake/i.test(String(t)) ? 'q3' : null),
    ipGameHost: async () => ({ kind: 'cs16', ip: '100.64.0.1', port: 27015, map: 'de_dust2' }),
    wc3Info: async () => ({ primary: { exe: 'C:\Program Files (x86)\Warcraft 3\war3.exe', exists: true, version: '1, 26, 0, 6401', is126: true, mapsDir: 'C:\Program Files (x86)\Warcraft 3\Maps\Downloads' } }),
    mapsLocal: async () => ({ files: { 'DotA v6.74c LoD v5e.w3x': { size: 1, sha256: 'a'.repeat(64) }, 'DotA IMBA v3.73.4b.w3x': { size: 1, sha256: 'old' } } }), meshStatus: async () => ({ state: 'Running', ip: '100.64.0.1' }), getQR: async () => ({}),
    request: async (method, path) => {
      if (String(path).startsWith('/membership/public')) return [2, 3, 8].map((id) => ({ id, tier: id === 2 ? 'gold' : 'silver', name_effect: 'gradient', level: 9 }));
      const P = String(path);
      if (/\/ipserver$/.test(P)) return q.get('srv') ? { server: { host_user_id: '2', host_username: 'Billionaire', kind: 'cs16', label: 'Counter-Strike 1.6', ip: '100.64.0.4', port: 27015, map: 'de_dust2' } } : { server: null };
      if (P === '/maps') return { can_upload: true, categories: ['DotA', 'LoD', 'IMBA', 'Melee', 'Tower Defense', 'RPG', 'Custom'], maps: [
        { id: 1, name: 'DotA LoD', version: 'v6.74c v5e', category: 'LoD', description: 'Legends of DotA — Garena.mn тэмцээний албан map', filename: 'DotA v6.74c LoD v5e.w3x', size: 8115000, sha256: 'a'.repeat(64), downloads: 412, featured: true },
        { id: 2, name: 'DotA LoD', version: 'v6.85i', category: 'LoD', description: 'LoD шинэ хувилбар', filename: 'DotA v6.85i LoD (1).w3x', size: 7707000, sha256: 'b'.repeat(64), downloads: 133 },
        { id: 3, name: 'DotA IMBA', version: 'v3.73.4b', category: 'IMBA', description: 'IMBA fun горим', filename: 'DotA IMBA v3.73.4b.w3x', size: 8158000, sha256: 'c'.repeat(64), downloads: 97 },
        { id: 4, name: 'Fight of Characters', version: '9.1a (Asia)', category: 'Custom', description: 'Anime баатруудын тулаан', filename: 'Fight_of_Characters9.1a(Asia).w3x', size: 8378000, sha256: 'd'.repeat(64), downloads: 58 },
      ] };
      const clanA = { id: 1, name: 'Mongol Lords', tag: 'MNL', description: 'DotA LoD клан · долоо хоног бүр дотоод тэмцээн', kind: 'player', join_mode: 'request', member_count: 18, owner_name: 'VitoCorleone', role: 'lord', pending_count: 2 };
      const clanB = { id: 2, name: 'LoD Mongolia', tag: 'LOD', description: 'Garena.mn Discord серверийн клан', kind: 'discord', join_mode: 'request', member_count: 342, owner_name: 'Billionaire', invite_url: 'https://discord.gg/x' };
      const clanC = { id: 3, name: 'Night Owls', tag: 'OWL', description: 'Шөнийн тоглогчид', kind: 'player', join_mode: 'open', member_count: 9, owner_name: 'Eboshdee' };
      if (P === '/clans/mine') return { clans: q.get('noclan') ? [] : [clanA], can_create: q.get('bronze') ? false : true, is_staff: true };
      if (P.startsWith('/clans?') || P === '/clans') return [{ ...clanA, my_role: 'lord' }, clanB, { ...clanC, my_pending: false }];
      if (/^\/clans\/\d+$/.test(P)) return { ...clanA, my_role: 'lord', members: [{ id: '1', username: 'VitoCorleone', role: 'lord' }, { id: '2', username: 'Billionaire', role: 'admin', tierbot_tier: '2-3' }, { id: '3', username: 'Eboshdee', role: 'member' }, { id: '4', username: 'qwe', role: 'member' }], requests: [{ id: 5, user_id: '9', username: 'Khulan', discord_username: 'khulan#0', message: 'Намайг оруулна уу' }, { id: 6, user_id: '10', username: 'Temka' }] };
      return {};
    },
  };
  window.api = new Proxy(specific, {
    get(t, k) {
      if (k in t) return t[k];
      if (/^on[A-Z]/.test(String(k))) return noop;
      return async () => ({});
    },
  });
  // Сүлжээнд холбогдохгүй socket
  const fakeSock = () => { const h = {}; const s = { connected: true, on: (e, f) => { (h[e] = h[e] || []).push(f); if (e === 'connect') setTimeout(f, 50); return s; }, off: () => s, emit: () => s, disconnect: noop, io: { on: noop } }; return s; };
  window.io = fakeSock;
  window.__PREVIEW__ = true;
  window.__BANNER_TEST__ = q.get('banner') ? '/covers/wc3.jpg' : null;
  // ?theme=dark|light, ?tab=<name>, ?drawer=friends, ?create=1 — урьдчилан харах туслах
  try { if (q.get('theme')) { localStorage.setItem('gx_theme', q.get('theme')); document.documentElement.dataset.gxTheme = q.get('theme'); } } catch {}
  window.addEventListener('load', () => setTimeout(() => {
    if (q.get('tab')) showTab(q.get('tab'));
    if (q.get('drawer')) window.gx?.openDrawer(q.get('drawer'));
    if (q.get('create')) document.getElementById('btn-create-room')?.click();
    if (q.get('select')) { selectedRoomId = q.get('select'); renderFilteredRooms(); }
    if (q.get('chat')) { showTab('chat'); [['Bibi','gg wp'],['Uka','Өрөө нээлээ, орцгоо'],['FaSi','@VitoCorleone ирлээ']].forEach(([u,t],i)=>appendLobbyMessage({ userId: 30+i, username: u, text: t, time: Date.now()-i*6e4 })); appendLobbyMessage({ userId: 1, username: 'VitoCorleone', text: 'Сайн байна уу бүгдээрээ', time: Date.now() }); }
    if (q.get('room')) window.gxRoom?.openRoom({ mode: 'room', roomId: '11', roomName: 'dota lod 6.74v5e', gameType: 'Warcraft III: The Frozen Throne', isHost: '1', hostId: '1', maxPlayers: '10', theme: q.get('theme') || '' });
    if (q.get('clantab')) document.querySelector(`[data-clan-tab="${q.get('clantab')}"]`)?.click();
    if (q.get('clan')) window.gxClans?.openClan(q.get('clan'));
    if (q.get('info')) window.gxClans?.showLobbyInfo(roomsCache[q.get('info')]);
    if (q.get('newclan')) document.getElementById('gx-clan-create')?.click();
    if (q.get('ctx')) { const row = document.querySelector(`.gx-row[data-room-id="${q.get('ctx')}"]`); const b = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.right - 260, clientY: b.bottom - 6 })); }
  }, 700));
})();
