const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const serverDir = path.resolve(__dirname, '..');
const serverIndexPath = path.join(serverDir, 'src', 'index.js');
const dbModulePath = path.join(serverDir, 'src', 'config', 'db.js');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(url, timeoutMs = 10000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await wait(250);
  }
  throw new Error(`Server did not start in time: ${url}`);
}

function clearServerModules() {
  const srcPrefix = path.join(serverDir, 'src');
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(srcPrefix)) delete require.cache[key];
  }
}

function installMockDb(mockDb) {
  require.cache[dbModulePath] = {
    id: dbModulePath,
    filename: dbModulePath,
    loaded: true,
    exports: mockDb,
  };
}

function makeAuthToken(user, secret = 'test-secret') {
  return jwt.sign(user, secret, { expiresIn: '1h' });
}

async function startServer(envOverrides = {}, options = {}) {
  const port = 4100 + Math.floor(Math.random() * 500);
  const previousEnv = {};
  const mergedEnv = {
    PORT: String(port),
    JWT_SECRET: 'test-secret',
    NODE_ENV: 'test',
    SKIP_DB_MIGRATIONS: 'true',
    DISCORD_CLIENT_ID: 'dummy-client',
    DISCORD_CLIENT_SECRET: 'dummy-secret',
    DISCORD_REDIRECT_URI: 'http://localhost/callback',
    ...envOverrides,
  };

  for (const [key, value] of Object.entries(mergedEnv)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }

  clearServerModules();
  if (options.mockDb) installMockDb(options.mockDb);
  const serverModule = require(serverIndexPath);
  await serverModule.start(port);
  await waitForServer(`http://127.0.0.1:${port}/`);

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: async () => {
      await new Promise((resolve) => serverModule.io.close(resolve));
      await new Promise((resolve) => serverModule.server.close(resolve));
      clearServerModules();
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

async function runTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

async function testSmokeFlow() {
  const server = await startServer();
  try {
    const rootRes = await fetch(`${server.baseUrl}/health`);
    assert.equal(rootRes.status, 200);
    const rootJson = await rootRes.json();
    assert.equal(rootJson.status, 'ok');

    const email = `user${Date.now()}@example.com`;
    const registerRes = await fetch(`${server.baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Tester', email, password: 'secret123' }),
    });
    assert.equal(registerRes.status, 201);
    const registerJson = await registerRes.json();
    assert.ok(registerJson.token);

    const loginRes = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'secret123' }),
    });
    assert.equal(loginRes.status, 200);
    const loginJson = await loginRes.json();
    assert.ok(loginJson.token);

    const meRes = await fetch(`${server.baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${loginJson.token}` },
    });
    assert.equal(meRes.status, 200);
    const meJson = await meRes.json();
    assert.equal(meJson.username, 'Tester');
    assert.equal(meJson.email, email);

    const forgotRes = await fetch(`${server.baseUrl}/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    assert.equal(forgotRes.status, 503);

    const resultRes = await fetch(`${server.baseUrl}/stats/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginJson.token}`,
      },
      body: JSON.stringify({
        room_id: 1,
        winner_team: 1,
        duration_minutes: 45,
        replay_path: 'C:\\fake\\game.w3g',
        players: [{ name: 'Tester', team: 1 }],
      }),
    });
    assert.equal(resultRes.status, 503);

    const discordLinkRes = await fetch(`${server.baseUrl}/auth/discord?link=1`, {
      redirect: 'manual',
    });
    assert.equal(discordLinkRes.status, 401);
  } finally {
    await server.stop();
  }
}

async function testDiscordLinkedUsernameIsReadOnly() {
  let updateAttempted = false;
  const mockDb = {
    query: async (sql) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (s.startsWith('SELECT discord_id FROM users WHERE id')) {
        return { rows: [{ discord_id: '777' }] };
      }
      if (s.startsWith('UPDATE users SET username')) {
        updateAttempted = true;
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({}, { mockDb });
  try {
    const token = makeAuthToken({ id: 7, username: 'DiscordName', discord_id: '777' });
    const res = await fetch(`${server.baseUrl}/auth/username`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'OtherName' }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Discord nickname/);
    assert.equal(updateAttempted, false);
  } finally {
    await server.stop();
  }
}

async function testAuthMeReturnsDiscordUsername() {
  const mockDb = {
    query: async (sql) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (s.startsWith('SELECT id, username, email, discord_id, discord_username')) {
        return {
          rows: [{
            id: 7,
            username: 'tuguldurkhas',
            email: null,
            discord_id: '777',
            discord_username: 'Lil',
            avatar_url: null,
            wins: 0,
            losses: 0,
          }],
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({}, { mockDb });
  try {
    const token = makeAuthToken({ id: 7, username: 'tuguldurkhas', discord_id: '777' });
    const res = await fetch(`${server.baseUrl}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.username, 'tuguldurkhas');
    assert.equal(body.discord_username, 'Lil');
  } finally {
    await server.stop();
  }
}

async function testProductionRoomGuard() {
  const server = await startServer({ NODE_ENV: 'production' });
  try {
    const roomsRes = await fetch(`${server.baseUrl}/rooms`);
    assert.equal(roomsRes.status, 503);
    const roomsJson = await roomsRes.json();
    assert.equal(roomsJson.error, 'Service temporarily unavailable');
  } finally {
    await server.stop();
  }
}

async function testRoomStartRequiresHost() {
  const mockDb = {
    query: async (sql) => {
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('SELECT host_id, status FROM rooms WHERE id = $1')) {
        return { rows: [{ host_id: 99, status: 'waiting' }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({}, { mockDb });
  try {
    const token = makeAuthToken({ id: 5, username: 'NotHost' });
    const res = await fetch(`${server.baseUrl}/rooms/123/start`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error, 'Only the host can start the game');
  } finally {
    await server.stop();
  }
}

async function testRoomTeamRequiresMembership() {
  const mockDb = {
    query: async (sql) => {
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('SELECT max_players FROM rooms WHERE id = $1')) {
        return { rows: [{ max_players: 10 }] };
      }
      if (sql.includes('SELECT COUNT(*) FROM room_players WHERE room_id = $1 AND team = $2')) {
        return { rows: [{ count: '0' }] };
      }
      if (sql.includes('UPDATE room_players SET team = $1 WHERE room_id = $2 AND user_id = $3 RETURNING user_id')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({}, { mockDb });
  try {
    const token = makeAuthToken({ id: 5, username: 'Player' });
    const res = await fetch(`${server.baseUrl}/rooms/222/team`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ team: 1 }),
    });

    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error, 'You are not a member of this room');
  } finally {
    await server.stop();
  }
}

async function testStatsResultRequiresHost() {
  const mockDb = {
    query: async (sql) => {
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('SELECT 1 FROM room_players WHERE room_id=$1 AND user_id=$2')) {
        return { rows: [{}] };
      }
      if (sql.includes('SELECT host_id, status FROM rooms WHERE id=$1')) {
        return { rows: [{ host_id: 99, status: 'playing' }] };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({}, { mockDb });
  try {
    const token = makeAuthToken({ id: 5, username: 'Member' });
    const res = await fetch(`${server.baseUrl}/stats/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        room_id: 7,
        winner_team: 1,
        duration_minutes: 30,
        replay_path: 'C:\\fake\\game.w3g',
        players: [{ user_id: 5, team: 1 }],
      }),
    });

    assert.equal(res.status, 403);
    const json = await res.json();
    assert.equal(json.error, 'Зөвхөн host үр дүн бүртгэнэ');
  } finally {
    await server.stop();
  }
}

async function testStatsResultRejectsPlayersOutsideRoom() {
  const mockDb = {
    query: async (sql, params) => {
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('SELECT 1 FROM room_players WHERE room_id=$1 AND user_id=$2')) {
        return { rows: [{}] };
      }
      if (sql.includes('SELECT host_id, status FROM rooms WHERE id=$1')) {
        return { rows: [{ host_id: 5, status: 'playing' }] };
      }
      if (sql.includes('SELECT id FROM game_results WHERE room_id=$1')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id, u.username, u.discord_id')) {
        return {
          rows: [
            { id: 5, username: 'Host', discord_id: null },
            { id: 7, username: 'Member', discord_id: null },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({}, { mockDb });
  try {
    const token = makeAuthToken({ id: 5, username: 'Host' });
    const res = await fetch(`${server.baseUrl}/stats/result`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        room_id: 7,
        winner_team: 1,
        duration_minutes: 30,
        replay_path: 'C:\\fake\\game.w3g',
        players: [{ user_id: 999, team: 1 }],
      }),
    });

    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error, 'Submitted player does not belong to the room');
  } finally {
    await server.stop();
  }
}

async function testDbBackedBlockCheck() {
  clearServerModules();
  installMockDb({
    query: async (sql, params) => {
      if (sql.includes('FROM blocked_users')) {
        return { rows: params[0] === '2' && params[1] === '1' ? [{}] : [] };
      }
      if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
      return { rows: [], rowCount: 0 };
    },
  });

  try {
    const socialRoutes = require(path.join(serverDir, 'src', 'routes', 'social.js'));
    assert.equal(await socialRoutes.isUserBlocked('2', '1'), true);
    assert.equal(await socialRoutes.isUserBlocked('2', '3'), false);
  } finally {
    clearServerModules();
  }
}

async function testAdminDashboardAccess() {
  const server = await startServer({ ADMIN_DISCORD_IDS: '999,888' });
  try {
    // The dashboard shell is public; the API behind it is gated.
    const pageRes = await fetch(`${server.baseUrl}/admin`);
    assert.equal(pageRes.status, 200);
    const html = await pageRes.text();
    assert.ok(html.includes('Admin'));

    // Login kicks off Discord OAuth in admin mode.
    const loginRes = await fetch(`${server.baseUrl}/admin/login`, { redirect: 'manual' });
    assert.equal(loginRes.status, 302);
    assert.equal(loginRes.headers.get('location'), '/auth/discord?admin=1');

    // No token → 401.
    const noTokenRes = await fetch(`${server.baseUrl}/admin/api/me`);
    assert.equal(noTokenRes.status, 401);

    // Valid token but Discord ID not whitelisted → 403.
    const nonAdmin = makeAuthToken({ id: 5, username: 'Nobody', discord_id: '111' });
    const deniedRes = await fetch(`${server.baseUrl}/admin/api/me`, {
      headers: { Authorization: `Bearer ${nonAdmin}` },
    });
    assert.equal(deniedRes.status, 403);

    // Whitelisted Discord ID → 200.
    const admin = makeAuthToken({ id: 1, username: 'Boss', discord_id: '999' });
    const meRes = await fetch(`${server.baseUrl}/admin/api/me`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(meRes.status, 200);
    const me = await meRes.json();
    assert.equal(me.discord_id, '999');

    // Online list is admin-gated and returns a shape the dashboard expects.
    const onlineRes = await fetch(`${server.baseUrl}/admin/api/online`, {
      headers: { Authorization: `Bearer ${admin}` },
    });
    assert.equal(onlineRes.status, 200);
    const online = await onlineRes.json();
    assert.ok(Array.isArray(online.users));
    assert.equal(typeof online.count, 'number');
  } finally {
    await server.stop();
  }
}

async function testAdminEmptyWhitelistDeniesEveryone() {
  const server = await startServer({ ADMIN_DISCORD_IDS: '' });
  try {
    const anyone = makeAuthToken({ id: 1, username: 'Boss', discord_id: '999' });
    const res = await fetch(`${server.baseUrl}/admin/api/me`, {
      headers: { Authorization: `Bearer ${anyone}` },
    });
    assert.equal(res.status, 403);
  } finally {
    await server.stop();
  }
}

async function testAdminManagement() {
  const store = new Set(); // dynamically-added admin Discord IDs
  const mockDb = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (s.includes('SELECT 1 FROM admin_whitelist')) {
        return { rows: store.has(String(params[0])) ? [{ x: 1 }] : [] };
      }
      if (s.startsWith('SELECT discord_id, note, added_by, created_at FROM admin_whitelist')) {
        return { rows: [...store].map((id) => ({ discord_id: id, note: '', added_by: '999', created_at: new Date() })) };
      }
      if (s.startsWith('INSERT INTO admin_whitelist')) { store.add(String(params[0])); return { rows: [], rowCount: 1 }; }
      if (s.startsWith('DELETE FROM admin_whitelist')) {
        const had = store.delete(String(params[0]));
        return { rows: [], rowCount: had ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({ ADMIN_DISCORD_IDS: '999' }, { mockDb });
  const boss = makeAuthToken({ id: 1, username: 'Boss', discord_id: '999' });
  const hdr = { Authorization: `Bearer ${boss}` };
  try {
    // Env superadmin appears, locked.
    let res = await fetch(`${server.baseUrl}/admin/api/admins`, { headers: hdr });
    assert.equal(res.status, 200);
    let list = (await res.json()).admins;
    assert.equal(list.length, 1);
    assert.equal(list[0].discord_id, '999');
    assert.equal(list[0].locked, true);

    // Add a dynamic admin by Discord ID.
    res = await fetch(`${server.baseUrl}/admin/api/admins`, {
      method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: '123456789012345678', note: 'friend' }),
    });
    assert.equal(res.status, 201);

    // The newly-added Discord ID can now reach the admin API.
    const friend = makeAuthToken({ id: 2, username: 'Friend', discord_id: '123456789012345678' });
    res = await fetch(`${server.baseUrl}/admin/api/me`, { headers: { Authorization: `Bearer ${friend}` } });
    assert.equal(res.status, 200);

    // Invalid Discord ID is rejected.
    res = await fetch(`${server.baseUrl}/admin/api/admins`, {
      method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
      body: JSON.stringify({ discord_id: 'not-a-number' }),
    });
    assert.equal(res.status, 400);

    // The env superadmin cannot be removed via the dashboard.
    res = await fetch(`${server.baseUrl}/admin/api/admins/999`, { method: 'DELETE', headers: hdr });
    assert.equal(res.status, 400);

    // Removing the dynamic admin revokes their access.
    res = await fetch(`${server.baseUrl}/admin/api/admins/123456789012345678`, { method: 'DELETE', headers: hdr });
    assert.equal(res.status, 200);
    res = await fetch(`${server.baseUrl}/admin/api/me`, { headers: { Authorization: `Bearer ${friend}` } });
    assert.equal(res.status, 403);
  } finally {
    await server.stop();
  }
}

async function testWarkeyTracking() {
  const wkStore = new Map(); // discord_id -> row
  const mockDb = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (s.startsWith('INSERT INTO warkey_users')) {
        wkStore.set(String(params[0]), { discord_id: String(params[0]), username: params[1], version: params[2] });
        return { rows: [], rowCount: 1 };
      }
      if (s.includes('FROM warkey_users WHERE last_seen')) return { rows: [{ c: wkStore.size }] };
      if (s.startsWith('SELECT COUNT(*)::int AS c FROM warkey_users')) return { rows: [{ c: wkStore.size }] };
      if (s.startsWith('SELECT w.discord_id')) {
        return { rows: [...wkStore.values()].map((u) => ({
          discord_id: u.discord_id, username: u.username, avatar_url: null, version: u.version,
          first_seen: new Date(), last_seen: new Date(), online: true,
        })) };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({ ADMIN_DISCORD_IDS: '999' }, { mockDb });
  try {
    // A Discord-linked WarKey user's heartbeat registers them.
    const user = makeAuthToken({ id: 7, username: 'Gamer', discord_id: '777' });
    let res = await fetch(`${server.baseUrl}/warkey/heartbeat`, {
      method: 'POST', headers: { Authorization: `Bearer ${user}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '2.1.0' }),
    });
    assert.equal(res.status, 200);
    assert.ok(wkStore.has('777'));
    assert.equal(wkStore.get('777').version, '2.1.0');

    // A non-Discord (local) account is not tracked as a WarKey user.
    const local = makeAuthToken({ id: 8, username: 'Local' });
    res = await fetch(`${server.baseUrl}/warkey/heartbeat`, {
      method: 'POST', headers: { Authorization: `Bearer ${local}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: '2.1.0' }),
    });
    assert.equal(res.status, 400);

    // The admin dashboard lists the WarKey user with their version.
    const admin = makeAuthToken({ id: 1, username: 'Boss', discord_id: '999' });
    res = await fetch(`${server.baseUrl}/admin/api/warkey/users`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.total, 1);
    assert.equal(data.users[0].discord_id, '777');
    assert.equal(data.users[0].version, '2.1.0');

    // Non-admins cannot read the WarKey user list.
    res = await fetch(`${server.baseUrl}/admin/api/warkey/users`, { headers: { Authorization: `Bearer ${user}` } });
    assert.equal(res.status, 403);
  } finally {
    await server.stop();
  }
}

async function testAdminUserEditDelete() {
  const users = new Map([[1, { id: 1, username: 'Old', wins: 2, losses: 3 }]]);
  const mockDb = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (s.startsWith('UPDATE users SET')) {
        const id = params[params.length - 1];
        const u = users.get(id);
        if (!u) return { rows: [] };
        const setPart = s.substring('UPDATE users SET '.length, s.indexOf(' WHERE'));
        for (const m of setPart.matchAll(/(\w+) = \$(\d+)/g)) u[m[1]] = params[parseInt(m[2], 10) - 1];
        return { rows: [{ id: u.id, username: u.username, wins: u.wins, losses: u.losses }] };
      }
      if (s.startsWith('DELETE FROM users WHERE id')) {
        const had = users.delete(params[0]);
        return { rows: [], rowCount: had ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({ ADMIN_DISCORD_IDS: '999' }, { mockDb });
  const admin = makeAuthToken({ id: 1, username: 'Boss', discord_id: '999' });
  const hdr = { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' };
  try {
    // Edit name and stats.
    let res = await fetch(`${server.baseUrl}/admin/api/users/1`, {
      method: 'PATCH', headers: hdr, body: JSON.stringify({ username: 'New', wins: 10, losses: 1 }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.username, 'New');
    assert.equal(body.user.wins, 10);
    assert.equal(users.get(1).username, 'New');

    // Negative stats are rejected.
    res = await fetch(`${server.baseUrl}/admin/api/users/1`, {
      method: 'PATCH', headers: hdr, body: JSON.stringify({ wins: -5 }),
    });
    assert.equal(res.status, 400);

    // A non-admin cannot edit.
    const nobody = makeAuthToken({ id: 9, username: 'No', discord_id: '111' });
    res = await fetch(`${server.baseUrl}/admin/api/users/1`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${nobody}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Hacked' }),
    });
    assert.equal(res.status, 403);
    assert.equal(users.get(1).username, 'New');

    // Delete, then deleting again is a 404.
    res = await fetch(`${server.baseUrl}/admin/api/users/1`, { method: 'DELETE', headers: hdr });
    assert.equal(res.status, 200);
    assert.ok(!users.has(1));
    res = await fetch(`${server.baseUrl}/admin/api/users/1`, { method: 'DELETE', headers: hdr });
    assert.equal(res.status, 404);
  } finally {
    await server.stop();
  }
}

async function testWarkeyBanRestore() {
  const users = new Map();
  const bans = new Map();
  const mockDb = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (s === 'SELECT 1 FROM warkey_bans WHERE discord_id = $1')
        return { rows: bans.has(String(params[0])) ? [{ x: 1 }] : [] };
      if (s.startsWith('INSERT INTO warkey_users')) { users.set(String(params[0]), { username: params[1], version: params[2] }); return { rows: [], rowCount: 1 }; }
      if (s.startsWith('SELECT username, version FROM warkey_users')) { const u = users.get(String(params[0])) || {}; return { rows: [{ username: u.username, version: u.version }] }; }
      if (s.startsWith('INSERT INTO warkey_bans')) { bans.set(String(params[0]), { discord_id: String(params[0]), username: params[1], version: params[2], banned_at: new Date() }); return { rows: [], rowCount: 1 }; }
      if (s.startsWith('DELETE FROM warkey_users WHERE discord_id')) { users.delete(String(params[0])); return { rows: [], rowCount: 1 }; }
      if (s.startsWith('SELECT b.discord_id')) { return { rows: [...bans.values()].map((b) => ({ discord_id: b.discord_id, username: b.username, avatar_url: null, version: b.version, banned_by: '999', banned_at: b.banned_at })) }; }
      if (s.startsWith('DELETE FROM warkey_bans WHERE discord_id')) { const had = bans.delete(String(params[0])); return { rows: [], rowCount: had ? 1 : 0 }; }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({ ADMIN_DISCORD_IDS: '999' }, { mockDb });
  const ah = { Authorization: `Bearer ${makeAuthToken({ id: 1, username: 'Boss', discord_id: '999' })}` };
  const gh = { Authorization: `Bearer ${makeAuthToken({ id: 7, username: 'Gamer', discord_id: '777' })}`, 'Content-Type': 'application/json' };
  const beat = () => fetch(`${server.baseUrl}/warkey/heartbeat`, { method: 'POST', headers: gh, body: JSON.stringify({ version: '2.4.0' }) });
  try {
    // Works before the ban.
    let res = await beat();
    assert.equal(res.status, 200);
    assert.ok(users.has('777'));

    // Admin "deletes" (bans) the user → moved to the banned list.
    res = await fetch(`${server.baseUrl}/admin/api/warkey/users/777`, { method: 'DELETE', headers: ah });
    assert.equal(res.status, 200);
    assert.ok(bans.has('777'));
    assert.ok(!users.has('777'));

    res = await fetch(`${server.baseUrl}/admin/api/warkey/banned`, { headers: ah });
    const bl = await res.json();
    assert.equal(bl.users.length, 1);
    assert.equal(bl.users[0].discord_id, '777');

    // The banned user can no longer use WarKey.
    res = await beat();
    assert.equal(res.status, 403);
    assert.equal((await res.json()).error, 'banned');
    assert.ok(!users.has('777'));

    // Restore → able to use it again.
    res = await fetch(`${server.baseUrl}/admin/api/warkey/banned/777`, { method: 'DELETE', headers: ah });
    assert.equal(res.status, 200);
    assert.ok(!bans.has('777'));

    res = await beat();
    assert.equal(res.status, 200);
    assert.ok(users.has('777'));
  } finally {
    await server.stop();
  }
}

async function testTierBotSyncImportsRankData() {
  const users = new Map();
  let nextId = 1;
  const mockDb = {
    query: async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s === 'SELECT 1') return { rows: [{ '?column?': 1 }] };
      if (s.startsWith('ALTER TABLE users')) return { rows: [], rowCount: 0 };
      if (s.startsWith('SELECT id FROM users WHERE discord_id')) {
        const found = [...users.values()].find((u) => u.discord_id === params[0]);
        return { rows: found ? [{ id: found.id }] : [] };
      }
      if (s.startsWith('SELECT id FROM users WHERE tierbot_id')) {
        const found = [...users.values()].find((u) => u.tierbot_id === params[0]);
        return { rows: found ? [{ id: found.id }] : [] };
      }
      if (s.startsWith('SELECT id FROM users WHERE LOWER(username)')) {
        const found = [...users.values()].find((u) => u.username.toLowerCase() === String(params[0]).toLowerCase());
        return { rows: found ? [{ id: found.id }] : [] };
      }
      if (s.startsWith('INSERT INTO users')) {
        const user = {
          id: nextId++,
          username: params[0],
          discord_id: params[1],
          wins: params[2],
          losses: params[3],
          tierbot_id: params[4],
          tierbot_rating: params[5],
          tierbot_tier: params[6],
          tierbot_rank: params[7],
        };
        users.set(user.id, user);
        return { rows: [user], rowCount: 1 };
      }
      if (s.startsWith('UPDATE users SET username')) {
        const user = users.get(params[8]);
        if (user) {
          user.username = params[0];
          user.discord_id = params[1] || user.discord_id;
          user.wins = params[2];
          user.losses = params[3];
          user.tierbot_id = params[4] || user.tierbot_id;
          user.tierbot_rating = params[5];
          user.tierbot_tier = params[6];
          user.tierbot_rank = params[7];
        }
        return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };

  const server = await startServer({ ADMIN_DISCORD_IDS: '999' }, { mockDb });
  const admin = makeAuthToken({ id: 1, username: 'Boss', discord_id: '999' });
  try {
    const res = await fetch(`${server.baseUrl}/stats/tierbot/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players: [
          { username: 'Alpha', discord_id: '111', wins: 12, losses: 3, rating: 1840, tier: 'Gold', rank: 1 },
          { name: 'Beta', playerId: 'tb-2', w: 4, l: 6, points: 990, division: 'Bronze' },
        ],
      }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.imported, 2);
    assert.equal(body.created, 2);
    assert.equal(users.size, 2);
    assert.equal([...users.values()][0].tierbot_rating, 1840);
    assert.equal([...users.values()][1].tierbot_tier, 'Bronze');
  } finally {
    await server.stop();
  }
}


// ── Diamond 💎: шилжүүлэг, эзний unlimited, админы олголт ──────────────────
function makeDiamondMockDb(users) {
  const ledger = [];
  const orders = [];
  const query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s === 'SELECT 1' || s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (s.startsWith('SELECT 1 FROM admin_whitelist')) return { rows: [...users.values()].some((u) => String(u.discord_id) === String(params[0]) && u.is_db_admin) ? [{ '?column?': 1 }] : [] };
    if (s.startsWith('SELECT id, username, diamonds FROM users WHERE id = $1')) {
      const u = users.get(Number(params[0]));
      return { rows: u ? [{ id: u.id, username: u.username, diamonds: u.diamonds }] : [] };
    }
    if (s.startsWith('SELECT id, username, diamonds FROM users WHERE LOWER(username)')) {
      const rows = [...users.values()].filter((u) => u.username.toLowerCase() === String(params[0]).toLowerCase()).map((u) => ({ id: u.id, username: u.username, diamonds: u.diamonds }));
      return { rows };
    }
    if (s.startsWith('SELECT id, username, email, discord_id, discord_username, avatar_url,') && s.includes('membership')) {
      const u = users.get(Number(params[0]));
      return { rows: u ? [{ ...u }] : [] };
    }
    if (s.startsWith('SELECT id, username, membership, membership_until, name_effect, diamonds')) {
      const u = users.get(Number(params[0]));
      return { rows: u ? [{ ...u }] : [] };
    }
    if (s.startsWith('UPDATE users SET diamonds = diamonds - $1 WHERE id = $2 AND COALESCE(diamonds, 0) >= $1')) {
      const u = users.get(Number(params[1]));
      if (!u || u.diamonds < params[0]) return { rows: [], rowCount: 0 };
      u.diamonds -= params[0];
      return { rows: [{ diamonds: u.diamonds }], rowCount: 1 };
    }
    if (s.startsWith('UPDATE users SET diamonds = GREATEST(0, COALESCE(diamonds, 0) + $1)')) {
      const u = users.get(Number(params[1]));
      if (!u) return { rows: [], rowCount: 0 };
      u.diamonds = Math.max(0, u.diamonds + params[0]);
      return { rows: [{ diamonds: u.diamonds }], rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO diamond_transactions')) {
      ledger.push({ user_id: params[0], amount: params[1], type: params[2], ref: params[3], note: params[4] });
      return { rows: [], rowCount: 1 };
    }
    if (s.startsWith('INSERT INTO payment_orders')) { orders.push(params); return { rows: [], rowCount: 1 }; }
    if (s.startsWith('UPDATE users SET membership = $1, membership_until = $2')) {
      const u = users.get(Number(params[2]));
      if (u) { u.membership = params[0]; u.membership_until = params[1]; }
      return { rows: [], rowCount: u ? 1 : 0 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { query, connect: async () => ({ query, release() {} }), ledger, orders };
}

async function testDiamondTransfer() {
  const users = new Map([
    [1, { id: 1, username: 'Alice', discord_id: '111', diamonds: 100, membership: 'bronze', xp: 0, level: 1, block_games: 0, block_wins: 0 }],
    [2, { id: 2, username: 'Bob', discord_id: '222', diamonds: 5, membership: 'bronze', xp: 0, level: 1, block_games: 0, block_wins: 0 }],
  ]);
  const mockDb = makeDiamondMockDb(users);
  const server = await startServer({ ADMIN_DISCORD_IDS: '999' }, { mockDb });
  const alice = makeAuthToken({ id: 1, username: 'Alice', discord_id: '111' });
  const post = (token, body) => fetch(`${server.baseUrl}/diamonds/transfer`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  try {
    // Хүрэлцэхгүй
    let res = await post(alice, { to: 2, amount: 500 });
    assert.equal(res.status, 402);
    assert.equal(users.get(1).diamonds, 100);
    assert.equal(mockDb.ledger.length, 0);

    // Өөртөө
    res = await post(alice, { to: 'Alice', amount: 10 });
    assert.equal(res.status, 400);

    // Буруу дүн
    res = await post(alice, { to: 2, amount: 0 });
    assert.equal(res.status, 400);

    // Амжилттай (нэрээр)
    res = await post(alice, { to: 'bob', amount: 40, note: 'gg' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.diamonds, 60);
    assert.equal(body.to.id, 2);
    assert.equal(users.get(1).diamonds, 60);
    assert.equal(users.get(2).diamonds, 45);
    assert.deepEqual(mockDb.ledger.map((l) => [l.user_id, l.amount, l.type]), [[1, -40, 'transfer_out'], [2, 40, 'transfer_in']]);

    // Олдохгүй
    res = await post(alice, { to: 'Nobody', amount: 1 });
    assert.equal(res.status, 404);
  } finally {
    await server.stop();
  }
}

async function testOwnerUnlimitedDiamonds() {
  const users = new Map([
    [1, { id: 1, username: 'Owner', discord_id: '999', diamonds: 0, membership: 'bronze', xp: 0, level: 1, block_games: 0, block_wins: 0 }],
    [2, { id: 2, username: 'Bob', discord_id: '222', diamonds: 0, membership: 'bronze', xp: 0, level: 1, block_games: 0, block_wins: 0 }],
  ]);
  const mockDb = makeDiamondMockDb(users);
  const server = await startServer({ ADMIN_DISCORD_IDS: '999' }, { mockDb });
  const owner = makeAuthToken({ id: 1, username: 'Owner', discord_id: '999' });
  const headers = { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' };
  try {
    const me = await fetch(`${server.baseUrl}/auth/me`, { headers });
    assert.equal(me.status, 200);
    const meJson = await me.json();
    assert.equal(meJson.unlimited_diamonds, true);
    assert.equal(meJson.is_owner, true);

    // 0 үлдэгдэлтэй ч шилжүүлнэ — хасагдахгүй, хүлээн авагчид нэмэгдэнэ
    const res = await fetch(`${server.baseUrl}/diamonds/transfer`, { method: 'POST', headers, body: JSON.stringify({ to: 2, amount: 1500 }) });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.unlimited, true);
    assert.equal(users.get(1).diamonds, 0);
    assert.equal(users.get(2).diamonds, 1500);

    // Эзэн Diamond-оор Gold авахад хасагдахгүй
    const order = await fetch(`${server.baseUrl}/membership/order`, { method: 'POST', headers, body: JSON.stringify({ tier: 'gold', months: 1, pay_with: 'diamonds' }) });
    assert.equal(order.status, 200);
    const oj = await order.json();
    assert.equal(oj.paid, true);
    assert.equal(oj.cost, 0);
    assert.equal(users.get(1).membership, 'gold');
  } finally {
    await server.stop();
  }
}

async function testAdminDiamondGrantIsOwnerOnly() {
  const users = new Map([
    [1, { id: 1, username: 'Owner', discord_id: '999', diamonds: 0, membership: 'bronze', xp: 0, level: 1, block_games: 0, block_wins: 0 }],
    [2, { id: 2, username: 'Staff', discord_id: '555', is_db_admin: true, diamonds: 0, membership: 'bronze', xp: 0, level: 1, block_games: 0, block_wins: 0 }],
    [3, { id: 3, username: 'Player', discord_id: '333', diamonds: 10, membership: 'bronze', xp: 0, level: 1, block_games: 0, block_wins: 0 }],
  ]);
  const mockDb = makeDiamondMockDb(users);
  const server = await startServer({ ADMIN_DISCORD_IDS: '999' }, { mockDb });
  const owner = makeAuthToken({ id: 1, username: 'Owner', discord_id: '999' });
  const staff = makeAuthToken({ id: 2, username: 'Staff', discord_id: '555' });
  const player = makeAuthToken({ id: 3, username: 'Player', discord_id: '333' });
  const call = (token, path, body) => fetch(`${server.baseUrl}${path}`, {
    method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  });
  try {
    // Энгийн хэрэглэгч → 403 (adminMW)
    let res = await call(player, '/admin/api/diamonds/grant', { user: 3, amount: 100 });
    assert.equal(res.status, 403);
    // DB whitelist админ → дэвтэр харна, олгож чадахгүй
    res = await call(staff, '/admin/api/diamonds/ledger');
    assert.equal(res.status, 200);
    res = await call(staff, '/admin/api/diamonds/grant', { user: 3, amount: 100 });
    assert.equal(res.status, 403);
    assert.equal(users.get(3).diamonds, 10);
    // Эзэн → олгоно
    res = await call(owner, '/admin/api/diamonds/grant', { user: 'player', amount: 100, note: 'дансны гүйлгээ #1' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.diamonds, 110);
    assert.equal(users.get(3).diamonds, 110);
    assert.equal(mockDb.ledger[0].type, 'admin_grant');
    // Эзэн → Gold 3 сар үнэгүй
    res = await call(owner, '/admin/api/membership/grant', { user: 3, tier: 'gold', months: 3 });
    assert.equal(res.status, 200);
    assert.equal(users.get(3).membership, 'gold');
    assert.ok(new Date(users.get(3).membership_until).getTime() > Date.now() + 80 * 24 * 3600 * 1000);
    // Хасах (сөрөг дүн) — 0-оос доош орохгүй
    res = await call(owner, '/admin/api/diamonds/grant', { user: 3, amount: -500 });
    assert.equal(res.status, 200);
    assert.equal(users.get(3).diamonds, 0);
  } finally {
    await server.stop();
  }
}

// Бот хост: гишүүн "WC3 нээж нэгдэх" → WC3 нэр + IP бүртгэгдэнэ; дүн ирэхэд GHost++-ийн тоглогч (нэр|IP) →
// платформын хэрэглэгч (ажилд бүртгүүлсэн WC3 нэр → давхцахгүй IP → users.wc3_name → username), нэрийг сурна.
async function testBotResultMapsWc3NamesAndIps() {
  const inserted = [];
  const learned = [];
  const joins = [];
  const job = { id: 9, room_id: 7, status: 'started', map_key: 'lod', map_name: 'LoD', game_name: 'GMN#7 test', owner_name: 'Vito_Andolini_Corleo' };
  const query = async (sql, params = []) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s === 'SELECT 1' || s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (s.startsWith('SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2')) return { rows: [{}] };
    if (s.startsWith('SELECT * FROM bot_jobs WHERE room_id = $1 AND status IN')) return { rows: [job] };
    if (s.startsWith('INSERT INTO bot_job_players')) { joins.push(params); return { rows: [], rowCount: 1 }; }
    if (s.startsWith('SELECT * FROM bot_jobs WHERE id = $1')) return { rows: [job] };
    if (s.startsWith('SELECT id, played_at, source FROM game_results')) return { rows: [] };
    if (s.startsWith('SELECT status FROM rooms WHERE id = $1')) return { rows: [{ status: 'playing' }] };
    if (s.startsWith('SELECT u.id, u.username, u.discord_id, u.wc3_name')) {
      return { rows: [
        { id: 5, username: 'Вито Андолини Корлеон', discord_id: '1', wc3_name: null },
        { id: 7, username: 'BRAVEE', discord_id: '2', wc3_name: 'bravee_old' },
        { id: 8, username: 'Third', discord_id: '3', wc3_name: null },
      ] };
    }
    if (s.startsWith('SELECT user_id, wc3_name, ip FROM bot_job_players')) {
      // Вито нэрээ илгээсэн; BRAVEE зөвхөн IP-тэй (хуучин клиент / нэр ирээгүй)
      return { rows: joins.map((p) => ({ user_id: p[1], wc3_name: p[2], ip: p[3] })).concat([{ user_id: 7, wc3_name: null, ip: '2.2.2.2' }]) };
    }
    if (s.startsWith('INSERT INTO game_results')) return { rows: [{ id: 42 }] };
    if (s.startsWith('UPDATE users SET xp')) return { rows: [{ xp: 40, block_games: 1, block_wins: 1, diamonds: 0 }] };
    if (s.startsWith('INSERT INTO game_players')) { inserted.push(params); return { rows: [], rowCount: 1 }; }
    if (s.startsWith('UPDATE users SET wc3_name = $1 WHERE id = $2 AND')) { learned.push([params[1], params[0]]); return { rows: [], rowCount: 1 }; }
    return { rows: [], rowCount: 0 };
  };
  const mockDb = { query, connect: async () => ({ query, release() {} }) };
  const server = await startServer({ BOT_API_KEY: 'bot-secret' }, { mockDb });
  try {
    const vito = makeAuthToken({ id: 5, username: 'Вито Андолини Корлеон' });
    let res = await fetch(`${server.baseUrl}/rooms/7/bot-host/join`, {
      method: 'POST', headers: { Authorization: `Bearer ${vito}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ wc3_name: 'Vito_Andolini_Corleo' }),
    });
    assert.equal(res.status, 200);
    assert.equal(joins.length, 1);
    assert.equal(joins[0][0], 9);
    assert.equal(joins[0][1], 5);
    assert.equal(joins[0][2], 'Vito_Andolini_Corleo');
    assert.ok(joins[0][3], 'ip must be recorded');

    // bot key-гүй → 401
    res = await fetch(`${server.baseUrl}/bot/jobs/9/result`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ winner_team: 1, players: [] }),
    });
    assert.equal(res.status, 401);

    res = await fetch(`${server.baseUrl}/bot/jobs/9/result`, {
      method: 'POST', headers: { 'x-bot-key': 'bot-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        winner_team: 1, duration_minutes: 35,
        players: [
          { name: 'Vito_Andolini_Corleo', ip: '1.1.1.1', team: 1, kills: 5, deaths: 2, assists: 3 },
          { name: 'BRAVEE', ip: '2.2.2.2', team: 2, kills: 1, deaths: 4, assists: 0 },
          { name: 'Stranger', ip: '9.9.9.9', team: 2 },
        ],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.game_result_id, 42);
    // [game_result_id, user_id, team, is_winner, …, wc3_name]: Вито = WC3 нэрээр, BRAVEE = IP-ээр, Stranger = тааруулагдахгүй
    assert.deepEqual(inserted.map((p) => [p[1], p[3], p[12]]), [[5, true, 'Vito_Andolini_Corleo'], [7, false, 'BRAVEE']]);
    assert.deepEqual(learned, [[5, 'Vito_Andolini_Corleo'], [7, 'BRAVEE']]);
  } finally {
    await server.stop();
  }
}

// Аюулгүй байдал: сөрөг kills/assists XP-г хасахгүй (итгэлгүй хост/replay өгөгдөл)
async function testXpClampsNegativeStats() {
  const { xpFor, RULES } = require(path.join(serverDir, 'src', 'services', 'progression.js'));
  // Сөрөг kills → KDA бонус 0, суурь XP хэвээр
  assert.equal(xpFor({ isWinner: true, kills: -1000000, assists: -5 }), RULES.XP_WIN);
  assert.equal(xpFor({ isWinner: false, kills: -10, assists: 0 }), RULES.XP_LOSS);
  // Эерэг утга дээд хязгаараар хязгаарлагдана
  assert.equal(xpFor({ isWinner: true, kills: 100000, assists: 0 }), RULES.XP_WIN + RULES.XP_KDA_CAP);
}

// Аюулгүй байдал: дуусаагүй/цуцлагдсан жоб дээр дүн бүртгэхийг татгалзана (хуурамч XP/💎/wins-ээс сэргийлнэ)
async function testBotResultRejectsInactiveJob() {
  const inserted = [];
  const job = { id: 11, room_id: 3, status: 'cancelled', map_key: 'lod', map_name: 'LoD', game_name: 'GMN#11' };
  const query = async (sql) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    if (s === 'SELECT 1' || s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return { rows: [{ '?column?': 1 }], rowCount: 1 };
    if (s.startsWith('SELECT * FROM bot_jobs WHERE id = $1')) return { rows: [job] };
    if (s.startsWith('INSERT INTO game_results')) { inserted.push(1); return { rows: [{ id: 1 }] }; }
    return { rows: [], rowCount: 0 };
  };
  const mockDb = { query, connect: async () => ({ query, release() {} }) };
  const server = await startServer({ BOT_API_KEY: 'bot-secret' }, { mockDb });
  try {
    // Цуцлагдсан жоб дээр дүн → 409, дүн бүртгэгдэхгүй
    let res = await fetch(`${server.baseUrl}/bot/jobs/11/result`, {
      method: 'POST', headers: { 'x-bot-key': 'bot-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner_team: 1, duration_minutes: 20, players: [{ name: 'X', team: 1 }] }),
    });
    assert.equal(res.status, 409, 'cancelled job result must be rejected');
    assert.equal(inserted.length, 0, 'no game_results row for inactive job');

    // Цуцлагдсан жоб дээр started → 409
    res = await fetch(`${server.baseUrl}/bot/jobs/11/started`, {
      method: 'POST', headers: { 'x-bot-key': 'bot-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ players: [] }),
    });
    assert.equal(res.status, 409, 'cancelled job cannot be marked started');
  } finally {
    await server.stop();
  }
}

// C4: abuse хамгаалалт — forgot-password IP limiter (10/15 мин) + хэрэглэгч бүрийн perUser limiter
async function testRateLimits() {
  const rl = require(path.join(serverDir, 'src', 'middleware', 'ratelimit.js'));
  rl._reset();
  // perUser: 3 удаа зөвшөөрч 4 дэх нь 429
  const mw = rl.perUser('t', 3, 60000);
  const hits = [];
  for (let i = 0; i < 4; i++) {
    let status = 200;
    const res = { set() {}, status(c) { status = c; return this; }, json() { return this; } };
    mw({ user: { id: 7 }, ip: '1.1.1.1' }, res, () => { status = 'next'; });
    hits.push(status);
  }
  assert.deepEqual(hits, ['next', 'next', 'next', 429]);
  // өөр хэрэглэгч тусдаа тоологдоно
  let other = 200;
  mw({ user: { id: 8 }, ip: '1.1.1.1' }, { set() {}, status(c) { other = c; return this; }, json() { return this; } }, () => { other = 'next'; });
  assert.equal(other, 'next');

  const mockDb = { query: async (sql) => (sql.includes('SELECT 1') ? { rows: [{ '?column?': 1 }] } : { rows: [], rowCount: 0 }) };
  const server = await startServer({}, { mockDb });
  try {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await fetch(`${server.baseUrl}/auth/forgot-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'nobody@example.com' }),
      });
      last = res.status;
    }
    assert.equal(last, 429, 'forgot-password must be rate limited after 10 attempts');
  } finally {
    await server.stop();
  }
}

// C2: бот хостын админ API нь админ эрх шаардана; админд тойм буцаана
async function testBotAdminOverview() {
  const mockDb = { query: async (sql) => {
    if (sql.includes('admin_whitelist')) return { rows: [] };
    if (sql.includes('SELECT 1')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM bot_jobs j')) return { rows: [{ id: 1, room_id: 7, status: 'failed', game_name: 'GMN#7 x', created_at: new Date().toISOString(), room_name: 'x', requested_by_name: 'Host' }] };
    return { rows: [], rowCount: 0 };
  } };
  const server = await startServer({ ADMIN_DISCORD_IDS: '999', BOT_API_KEY: 'k' }, { mockDb });
  try {
    let res = await fetch(`${server.baseUrl}/admin/api/bot/overview`);
    assert.equal(res.status, 401);
    const user = makeAuthToken({ id: 5, username: 'Member', discord_id: '111' });
    res = await fetch(`${server.baseUrl}/admin/api/bot/overview`, { headers: { Authorization: `Bearer ${user}` } });
    assert.equal(res.status, 403);
    const admin = makeAuthToken({ id: 1, username: 'Owner', discord_id: '999' });
    res = await fetch(`${server.baseUrl}/admin/api/bot/overview`, { headers: { Authorization: `Bearer ${admin}` } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.enabled, true);
    assert.equal(body.jobs.length, 1);
    assert.ok(Array.isArray(body.events));
  } finally {
    await server.stop();
  }
}

(async () => {
  await runTest('server smoke flow supports register/login/me and guarded auth endpoints', testSmokeFlow);
  await runTest('Discord-linked usernames are read-only in-app', testDiscordLinkedUsernameIsReadOnly);
  await runTest('auth/me returns the stored Discord nickname', testAuthMeReturnsDiscordUsername);
  await runTest('admin can edit and delete platform users', testAdminUserEditDelete);
  await runTest('warkey users can be banned, listed, blocked, and restored', testWarkeyBanRestore);
  await runTest('TierBot sync imports rank data into users', testTierBotSyncImportsRankData);
  await runTest('admin dashboard gates its API behind a Discord ID whitelist', testAdminDashboardAccess);
  await runTest('admin whitelist that is empty denies everyone', testAdminEmptyWhitelistDeniesEveryone);
  await runTest('admins can be added and removed by Discord ID from the dashboard', testAdminManagement);
  await runTest('warkey heartbeats register Discord users and surface in the dashboard', testWarkeyTracking);
  await runTest('production mode rejects DB-backed room listing when DB is unavailable', testProductionRoomGuard);
  await runTest('rooms/start rejects non-host users', testRoomStartRequiresHost);
  await runTest('rooms/team rejects users who are not room members', testRoomTeamRequiresMembership);
  await runTest('stats/result rejects non-host submitters', testStatsResultRequiresHost);
  await runTest('stats/result rejects players outside the room roster', testStatsResultRejectsPlayersOutsideRoom);
  await runTest('social block checks use DB-backed blocked_users data', testDbBackedBlockCheck);
  await runTest('diamonds/transfer moves balance atomically and writes a double ledger', testDiamondTransfer);
  await runTest('platform owner has unlimited diamonds (transfer + membership without deduction)', testOwnerUnlimitedDiamonds);
  await runTest('admin diamond/membership grants are owner-only; staff can read the ledger', testAdminDiamondGrantIsOwnerOnly);
  await runTest('bot result maps GHost++ players to users by WC3 name, then IP; learns wc3_name', testBotResultMapsWc3NamesAndIps);
  await runTest('bot result/started reject inactive (cancelled) jobs with 409', testBotResultRejectsInactiveJob);
  await runTest('XP calc clamps negative kills/assists to base (no XP drain)', testXpClampsNegativeStats);
  await runTest('rate limits: forgot-password per IP, perUser limiter per account', testRateLimits);
  await runTest('bot admin overview is admin-only and lists jobs/events', testBotAdminOverview);

  if (process.exitCode) process.exit(process.exitCode);
})();
