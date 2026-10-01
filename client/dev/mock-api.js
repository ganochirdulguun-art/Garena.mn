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
  const CHANNELS = Array.from({ length: 20 }, (_, i) => ({ id: 901 + i, name: `WC3 Room ${i + 1}`, kind: 'channel', channel_no: i + 1, visible_cap: 200, max_players: 300, ranked: i < 5, game_type: 'Warcraft III: The Frozen Throne', status: 'waiting', player_count: [213, 200, 187, 164, 121, 96, 74, 52, 31, 18, 9, 4, 0, 0, 0, 0, 0, 0, 0, 0][i], members: [] }));
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
    getRooms: async () => (q.get('nochan') ? rooms : [...CHANNELS, ...rooms]), getMyRoom: async () => ((q.get('ch') || q.get('kind') === 'channel') ? { id: 901, kind: 'channel', ranked: true, visible_cap: 200, game_mode: 'LAN', has_password: false, pinned_notice: '📢 Garena.mn нийтийн өрөөнд тавтай морил!\n🎮 Тоглох: «LAN тоглоом нээх» эсвэл доорх жагсаалтаас «Нэгдэх» → WC3 → Local Area Network.\n⭐ 200/200 дүүрэхэд Silver/Gold шууд орно.\n⚖️ Бүдүүлэг үг, спам, maphack хориотой.' } : { id: 11, game_mode: 'lod', ranked: true, has_password: false, clan_id: q.get('clanroom') ? 1 : null, clan_tag: 'MNL' }), getSettings: async () => settings,
    getFriends: async () => friends, getPendingRequests: async () => [{ id: 30, username: 'Khulan', avatar_url: '' }], getBlockedUsers: async () => [],
    getAppVersion: async () => '2.9.0 (preview)', getUnreadCount: async () => ({}), getDiscordServers: async () => [], getStreamers: async () => [],
    getRanking: async () => ({ rows: [], total: 0 }), getGameHistory: async () => ({ rows: [], total: 0 }), getCacheSize: async () => ({ total: 0 }),
    getAd: async () => (q.get('noad') ? null : [{ image_tall: '/dev/ads/gs-ad-1-tall.png', text: 'GarenaSystem' }, { image_tall: '/dev/ads/gmn-ad-zeon-tall.png', text: 'ZEON' }, { image_tall: '/dev/ads/gmn-ad-diamond-tall.png', text: 'Diamond' }]),
    ipGameKind: async (t) => (/counter|cs/i.test(String(t)) ? 'cs16' : /quake/i.test(String(t)) ? 'q3' : null),
    ipGameHost: async () => ({ kind: 'cs16', ip: '100.64.0.1', port: 27015, map: 'de_dust2' }),
    wc3Info: async () => ({ primary: { exe: 'C:\Program Files (x86)\Warcraft 3\war3.exe', exists: true, version: '1, 26, 0, 6401', is126: true, mapsDir: 'C:\Program Files (x86)\Warcraft 3\Maps\Downloads' } }),
    mapsLocal: async () => ({ files: { 'DotA v6.74c LoD v5e.w3x': { size: 1, sha256: 'a'.repeat(64) }, 'DotA IMBA v3.73.4b.w3x': { size: 1, sha256: 'old' } } }), meshStatus: async () => (q.get('mesh') === 'off' ? { state: 'NotInstalled', error: 'needs-consent' } : { state: 'Running', ip: '100.64.0.1' }), meshEnsure: async () => ({ state: 'NotInstalled', error: 'declined' }), getQR: async () => ({}),
    request: async (method, path) => {
      // RGC маягийн өрөө: OPEN/STARTED GAMES (хуурамч W3GS GAMEINFO)
      if (/\/lan-host$/.test(String(path)) && q.get('kind') === 'channel') {
        const gi = (name, map, host, used, avail) => {
          const te = new TextEncoder(); const dec = [1, 0, 0, 0, 0, 116, 0, 116, 0, 9, 9, 9, 9, ...te.encode('Maps/Download/' + map + '.w3x'), 0, ...te.encode(host), 0, 0];
          const enc = []; for (let i = 0; i < dec.length; i += 7) { const ch = dec.slice(i, i + 7); let mask = 1; const out = ch.map((b, j) => { if (b % 2 === 0) return b + 1; mask |= 1 << (j + 1); return b; }); enc.push(mask, ...out); }
          const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255];
          const bytes = [0xf7, 0x30, 0, 0, ...te.encode('PX3W'), ...u32(26), ...u32(1), ...u32(7), ...te.encode(name), 0, 0, ...enc, 0, ...u32(12), ...u32(1), ...u32(used), ...u32(avail), ...u32(30), 0xe0, 0x17];
          return btoa(String.fromCharCode(...bytes));
        };
        const now2 = Date.now();
        return { relay_configured: true, games: [
          { game_token: 'g1', host_user_id: 2, host_username: 'Billionaire', host_wc3_name: 'Billionaire', created_at: now2 - 120e3, gameinfo_b64: gi('Room1 #12 -ap', 'DotA v6.83d', 'Billionaire', 7, 10) },
          { game_token: 'g2', host_user_id: 5, host_username: 'Benihen', host_wc3_name: 'Benihen', created_at: now2 - 40e3, gameinfo_b64: gi('LoD -sdzm 3k+', 'DotA v6.74c LoD v5e', 'Benihen', 3, 10) },
          { game_token: 'g3', host_user_id: 6, host_username: 'FaSi', host_wc3_name: 'FaSi', created_at: now2 - 900e3, started_at: now2 - 754e3, gameinfo_b64: gi('Room1 #9 -ar', 'DotA v6.83d', 'FaSi', 10, 10) },
          { game_token: 'g4', host_user_id: 7, host_username: 'Peozzzz', host_wc3_name: 'Peozzzz', created_at: now2 - 600e3, started_at: now2 - 233e3, gameinfo_b64: gi('IMBA fun', 'DotA IMBA v3.73.4b', 'Peozzzz', 8, 10) },
        ] };
      }
      if (String(path).startsWith('/membership/public')) return String(path).split('ids=')[1].split(',').map(Number).map((id) => ({ id, tier: id === 2 ? 'gold' : [3, 8].includes(id) ? 'silver' : 'bronze', name_effect: 'gradient', level: [0, 42, 31, 9, 18, 27, 12, 55, 8, 3, 21, 14, 6, 2, 11, 5, 4][id] || 1, xp: 5000 }));
      const P = String(path);
      const staff = !q.get('user') && !(window.parent !== window && window.parent.location.search.includes('user=1'));
      if (P.startsWith('/roles/user/')) return { id: 31, username: 'Uka', role: 'moderator', can_set_admin: true, can_set_mod: true };
      if (P === '/roles/me') return { role: q.get('mod') ? 'moderator' : null, staff, owner: staff, can_host_channel: staff || !!q.get('mod'), pending: null, pending_count: 3 };
      if (P.startsWith('/roles/activity/')) return { rooms: [{ room_id: 5, name: 'dota lod 6.74v5e', game_type: 'Warcraft III', created_at: new Date(Date.now() - 864e5).toISOString(), open_sec: 5400 }], games: [{ created_at: new Date(Date.now() - 36e5).toISOString(), game_sec: 2700, ranked: true, xp: 45 }] };
      if (P.startsWith('/roles/activity')) return { users: [
        { id: 2, username: 'Billionaire', tier: '2-3', play_seconds: 412000, games: 188, games_7d: 21, wins: 102, losses: 86, hosted: 64, rooms_created: 40, last_active_at: new Date().toISOString(), online: true, role: 'moderator' },
        { id: 3, username: 'Eboshdee', tier: '3-1', play_seconds: 305000, games: 141, games_7d: 30, wins: 70, losses: 71, hosted: 22, rooms_created: 9, last_active_at: new Date(Date.now() - 7200e3).toISOString(), online: false, requested: true },
        { id: 4, username: 'Tom_Noiton', tier: '2-2', play_seconds: 98000, games: 52, games_7d: 8, wins: 30, losses: 22, hosted: 3, rooms_created: 1, last_active_at: new Date(Date.now() - 864e5 * 3).toISOString(), online: false },
      ] };
      if (P.startsWith('/roles/requests')) return { pending_count: 1, requests: [{ id: 1, user_id: 3, username: 'Eboshdee', tier: '3-1', note: 'Өдөр бүр LoD хостлодог, 10 хүн цуглуулна', created_at: new Date(Date.now() - 3600e3).toISOString(), wins: 70, losses: 71 }] };
      if (P === '/roles/moderators') return { moderators: [{ user_id: 2, username: 'Billionaire', tier: '2-3', granted_at: new Date(Date.now() - 864e5).toISOString(), granted_by_name: 'VitoCorleone' }] };
      if (P === '/roles/kicks') return { kicks: [{ id: 1, room_id: 903, room_name: 'WC3 Room 3', reason: 'AFK 45 мин', created_at: new Date(Date.now() - 1800e3).toISOString(), target_name: 'afk_guy', by_name: 'Billionaire' }] };
      if (P === '/wishes') return { counts: { umk3: 214, ctr: 187, goldeneye: 96 }, mine: ['ctr'] };
      if (P.startsWith('/wishes/')) return { wished: true, counts: { umk3: 215, ctr: 187, goldeneye: 96 }, mine: ['ctr', 'umk3'] };
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
    if (q.get('noconfirm')) showConfirm = async () => false;
    if (q.get('tab')) showTab(q.get('tab'));
    if (q.get('ctxuser')) setTimeout(() => { const el = document.querySelector('#lobby-chat-messages .clickable-name[data-user-id]'); const b = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.left + 10, clientY: b.top + 8 })); }, 3500);
    if (q.get('owner')) setTimeout(() => document.querySelector('[data-gxo="' + q.get('owner') + '"]')?.click(), 1500);
    if (q.get('drawer')) window.gx?.openDrawer(q.get('drawer'));
    if (q.get('create')) document.getElementById('btn-create-room')?.click();
    if (q.get('select')) { selectedRoomId = q.get('select'); renderFilteredRooms(); }
    if (q.get('chat')) { showTab('chat'); [['Bibi','gg wp'],['Uka','Өрөө нээлээ, орцгоо'],['FaSi','@VitoCorleone ирлээ']].forEach(([u,t],i)=>appendLobbyMessage({ userId: 30+i, username: u, text: t, time: Date.now()-i*6e4 })); appendLobbyMessage({ userId: 1, username: 'VitoCorleone', text: 'Сайн байна уу бүгдээрээ', time: Date.now() }); appendLobbyMessage({ userId: 2, username: 'Billionaire', text: '@everyone 20:00 цагт LoD тэмцээн эхэлнэ!', time: Date.now()+500 }, true); appendLobbyMessage({ userId: 41, username: 'Тэмүүжин Бат', text: 'Сайн, @VitoCorleone өрөөнд ор. @Uka чи бас', time: Date.now()+1000, replyTo: { username: 'VitoCorleone', text: 'Сайн байна уу бүгдээрээ', time: String(Date.now()) } }, true); document.querySelector('#lobby-chat-messages .msg.other .msg-reply')?.click(); const li=document.getElementById('lobby-chat-input'); if (li && q.get('mention')) { li.value='@Тэ'; li.dispatchEvent(new Event('input')); } }
    if (q.get('mode') === 'room') setTimeout(() => { const t0 = new Date(Date.now()-9e4).toISOString(); appendMessage({ userId: 2, username: 'Billionaire', text: 'Бүгд бэлэн үү?', time: t0 }); appendMessage({ userId: 3, username: 'Eboshdee', text: '@VitoCorleone map татчихлаа', time: new Date().toISOString(), replyTo: { username: 'VitoCorleone', text: 'Map-аа татаарай', time: t0 } }); document.querySelector('#chat-messages .msg.other .msg-reply')?.click(); try { renderMembers([{ id: 1, name: 'VitoCorleone', tier: '1-1', cc: 'MN', admin: true }, { id: 2, name: 'Billionaire', tier: '2-3', mod: true, cc: 'MN' }, { id: 3, name: 'Eboshdee', cc: 'MN' }, { id: 4, name: 'Tom_Noiton', tier: '2-2', cc: 'KR' }, ...(q.get('kind') === 'channel' ? ['Benihen', 'FaSi', 'Peozzzz', 'qwe', 'Uka', 'Bibi', 'love68', 'MAYASTRO', 'AnTyC', 'Khulan', 'Temka', 'sda'].map((n, i) => ({ id: 5 + i, name: n, tier: ['3-1', '2-2', '4-1', '1-3', null][i % 5], cc: i === 6 ? 'US' : 'MN' })) : [])]); } catch {} }, 900);
    if (q.get('room')) window.gxRoom?.openRoom({ mode: 'room', roomId: '11', roomName: 'dota lod 6.74v5e', gameType: 'Warcraft III: The Frozen Throne', isHost: '1', hostId: '1', maxPlayers: q.get('ch') ? '300' : '10', theme: q.get('theme') || '', backgroundUrl: q.get('bg') || '', ...(q.get('ch') ? { roomId: '901', roomName: 'WC3 Room 1', isHost: '0', hostId: '', kind: 'channel', visibleCap: '200', gameType: 'Warcraft III: The Frozen Throne' } : {}) });
    if (q.get('clantab')) document.querySelector(`[data-clan-tab="${q.get('clantab')}"]`)?.click();
    if (q.get('clan')) window.gxClans?.openClan(q.get('clan'));
    if (q.get('info')) window.gxClans?.showLobbyInfo(roomsCache[q.get('info')]);
    if (q.get('newclan')) document.getElementById('gx-clan-create')?.click();
    if (q.get('ctx')) { const row = document.querySelector(`.gx-row[data-room-id="${q.get('ctx')}"]`); const b = row.getBoundingClientRect(); row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: b.right - 260, clientY: b.bottom - 6 })); }
  }, 700));
})();
