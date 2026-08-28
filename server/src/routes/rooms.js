const express = require('express');
const bcrypt = require('bcrypt');
const auth = require('../middleware/auth');

const optAuth = auth.optional;
const strictAuth = auth;

let db;
try { db = require('../config/db'); } catch { db = null; }

const zt = require('../services/zerotier');
const allowInMemoryFallback = process.env.NODE_ENV !== 'production';
const router = express.Router();

async function dbOk() {
  if (!db) return false;
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

function requireOperationalDb(res) {
  return res.status(503).json({ error: 'Service temporarily unavailable' });
}

async function ztCreateNetwork(roomName) {
  if (!zt.configured()) return null;
  try {
    return await zt.createNetwork(`WC3-${roomName}`);
  } catch (e) {
    console.error('[ZeroTier] create network:', e.message);
    return null;
  }
}

async function ztDeleteNetwork(networkId) {
  if (!zt.configured() || !networkId) return;
  try {
    await zt.deleteNetwork(networkId);
  } catch (e) {
    console.error('[ZeroTier] delete network:', e.message);
  }
}

const memRooms = new Map();
let memNextId = 1;
let _io = null;
// index.js-ээс өгөгдөнө — өрөө устгагдахад socket талын in-memory
// төлөвийг (чат түүх, ZT IP, ready, гишүүд) цэвэрлэнэ
let _cleanupRoom = null;

function setIO(io) {
  _io = io;
}

function setRoomCleanup(fn) {
  _cleanupRoom = fn;
}

function cleanupRoom(roomId) {
  if (_cleanupRoom) _cleanupRoom(String(roomId));
}

function emitRoomsUpdated() {
  if (_io) _io.emit('rooms:updated');
}

function roomToPublic(room) {
  const members = [...room.players.entries()].map(([id, name]) => ({ id: String(id), name }));
  return {
    id: room.id,
    name: room.name,
    host_id: String(room.host_id),
    host_name: room.host_name,
    max_players: room.max_players,
    game_type: room.game_type,
    description: room.description || '',
    game_mode: room.game_mode || '',
    background_url: room.background_url || '',
    status: room.status,
    has_password: room.has_password,
    zerotier_network_id: room.zerotier_network_id || null,
    player_count: room.players.size,
    members,
  };
}

function findUserRoom(userId) {
  const uid = String(userId);
  for (const room of memRooms.values()) {
    if ([...room.players.keys()].map(String).includes(uid)) return room;
  }
  return null;
}

router.get('/', optAuth, async (req, res) => {
  if (await dbOk()) {
    try {
      const result = await db.query(`
        SELECT r.id, r.name, r.host_id, u.username AS host_name,
          r.max_players, r.game_type, r.description, r.game_mode, r.background_url,
          r.status, r.has_password, r.zerotier_network_id,
          COUNT(rp.user_id) AS player_count,
          JSON_AGG(JSON_BUILD_OBJECT('id', u2.id::text, 'name', u2.username)
            ORDER BY rp.joined_at) FILTER (WHERE u2.username IS NOT NULL) AS members
        FROM rooms r
        JOIN users u ON r.host_id = u.id
        LEFT JOIN room_players rp ON r.id = rp.room_id
        LEFT JOIN users u2 ON rp.user_id = u2.id
        WHERE r.status IN ('waiting','playing')
        GROUP BY r.id, u.username
        ORDER BY r.created_at DESC
      `);
      return res.json(result.rows.map((row) => ({ ...row, members: row.members || [] })));
    } catch (e) {
      console.error(e);
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  return res.json([...memRooms.values()].filter((room) => room.status !== 'done').map(roomToPublic));
});

router.get('/mine', optAuth, async (req, res) => {
  if (!req.user) return res.json(null);

  if (await dbOk()) {
    try {
      const result = await db.query(`
        SELECT r.id, r.name, r.host_id, u.username AS host_name,
          r.max_players, r.game_type, r.description, r.game_mode, r.background_url,
          r.status, r.has_password, r.zerotier_network_id,
          COUNT(rp2.user_id) AS player_count,
          JSON_AGG(JSON_BUILD_OBJECT('id', u2.id::text, 'name', u2.username)
            ORDER BY rp2.joined_at) FILTER (WHERE u2.username IS NOT NULL) AS members
        FROM rooms r
        JOIN users u ON r.host_id = u.id
        JOIN room_players rp ON r.id = rp.room_id AND rp.user_id = $1
        LEFT JOIN room_players rp2 ON r.id = rp2.room_id
        LEFT JOIN users u2 ON rp2.user_id = u2.id
        WHERE r.status IN ('waiting','playing')
        GROUP BY r.id, u.username
        LIMIT 1
      `, [req.user.id]);
      return res.json(result.rows[0] ? { ...result.rows[0], members: result.rows[0].members || [] } : null);
    } catch (e) {
      console.error(e);
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const room = findUserRoom(req.user.id);
  return res.json(room ? roomToPublic(room) : null);
});

router.post('/', strictAuth, async (req, res) => {
  const { name, max_players = 10, game_type = '', password, description = '', game_mode = '', background_url = '' } = req.body;
  if (!name) return res.status(400).json({ error: 'Room name is required' });
  if (!game_type) return res.status(400).json({ error: 'Game type is required' });

  // Өрөөний дэвсгэр зураг — зөвхөн GOLD, зөвхөн https зураг (≤500 тэмдэгт)
  let bgUrl = String(background_url || '').trim().slice(0, 500);
  if (bgUrl) {
    if (!/^https:\/\/\S+$/i.test(bgUrl)) return res.status(400).json({ error: 'Дэвсгэр зураг https:// хаягтай байх ёстой' });
    const { tierOf, perksOf } = require('./membership');
    if (!perksOf(await tierOf(req.user.id)).roomBackground) {
      return res.status(403).json({ error: 'Өрөөний дэвсгэр зураг зөвхөн GOLD гишүүнд нээлттэй', code: 'TIER_REQUIRED' });
    }
  }

  const hasPassword = !!(password?.length);
  const passwordHash = hasPassword ? await bcrypt.hash(password, 8) : null;
  const descTrimmed = String(description || '').trim().slice(0, 200);
  const hostName = req.user.username || 'Guest';
  const userId = req.user.id;

  if (await dbOk()) {
    try {
      const existing = await db.query(
        `SELECT r.id FROM rooms r
         JOIN room_players rp ON r.id = rp.room_id
         WHERE rp.user_id = $1 AND r.status IN ('waiting','playing')
         LIMIT 1`,
        [userId]
      );
      if (existing.rows[0]) {
        return res.status(409).json({ error: 'Leave your current room first' });
      }

      const result = await db.query(
        `INSERT INTO rooms (name, host_id, max_players, game_type, has_password, password_hash, description, game_mode, background_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [name, userId, max_players, game_type, hasPassword, passwordHash, descTrimmed, game_mode || '', bgUrl]
      );

      const room = result.rows[0];
      await db.query('INSERT INTO room_players (room_id, user_id) VALUES ($1, $2)', [room.id, userId]);

      const ztNetId = process.env.ZEROTIER_DEFAULT_NETWORK || null;
      if (ztNetId) {
        await db.query('UPDATE rooms SET zerotier_network_id = $1 WHERE id = $2', [ztNetId, room.id]);
        room.zerotier_network_id = ztNetId;
      }

      emitRoomsUpdated();
      return res.status(201).json({
        ...room,
        host_name: hostName,
        members: [{ id: String(userId), name: hostName }],
        player_count: 1,
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  if (findUserRoom(userId)) return res.status(409).json({ error: 'Leave your current room first' });

  const room = {
    id: String(memNextId++),
    name,
    host_id: userId,
    host_name: hostName,
    max_players,
    game_type,
    status: 'waiting',
    has_password: hasPassword,
    password_hash: passwordHash,
    zerotier_network_id: process.env.ZEROTIER_DEFAULT_NETWORK || null,
    description: descTrimmed,
    game_mode: game_mode || '',
    background_url: bgUrl,
    players: new Map([[userId, hostName]]),
  };
  memRooms.set(room.id, room);
  emitRoomsUpdated();
  return res.status(201).json(roomToPublic(room));
});

router.post('/:id/join', strictAuth, async (req, res) => {
  const { id } = req.params;
  const { password } = req.body;
  const userId = req.user.id;

  if (await dbOk()) {
    try {
      const already = await db.query(
        `SELECT r.id FROM rooms r
         JOIN room_players rp ON r.id = rp.room_id
         WHERE rp.user_id = $1 AND r.status IN ('waiting','playing')
         LIMIT 1`,
        [userId]
      );

      if (already.rows[0]) {
        if (String(already.rows[0].id) === String(id)) {
          const roomResult = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
          return res.json({ message: 'Joined room', room: roomResult.rows[0] });
        }

        const oldId = already.rows[0].id;
        await db.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [oldId, userId]);
        const oldRoom = await db.query('SELECT host_id, zerotier_network_id FROM rooms WHERE id = $1', [oldId]);
        if (String(oldRoom.rows[0]?.host_id) === String(userId)) {
          // Идэвхтэй бот-жобыг цуцална — эс бөгөөс room устахад FK SET NULL-аар өнчирч GHost "сүнс" lobby үлддэг
          await db.query("UPDATE bot_jobs SET status='cancelled', updated_at=NOW() WHERE room_id=$1 AND status IN ('queued','hosting','lobby')", [oldId]).catch(() => {});
          await db.query('DELETE FROM rooms WHERE id = $1', [oldId]);
          if (_io) _io.to(String(oldId)).emit('room:closed', { reason: 'Host left the room' });
          cleanupRoom(oldId);
          if (oldRoom.rows[0]?.zerotier_network_id && !process.env.ZEROTIER_DEFAULT_NETWORK) {
            await ztDeleteNetwork(oldRoom.rows[0].zerotier_network_id);
          }
        }
        emitRoomsUpdated();
      }

      const roomResult = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
      const room = roomResult.rows[0];
      if (!room) return res.status(404).json({ error: 'Room not found' });
      if (room.status === 'done') return res.status(400).json({ error: 'Room is closed' });

      if (room.has_password) {
        if (!password) return res.status(403).json({ error: 'Password required', need_password: true });
        const ok = await bcrypt.compare(password, room.password_hash);
        if (!ok) return res.status(403).json({ error: 'Invalid password' });
      }

      const countResult = await db.query('SELECT COUNT(*) FROM room_players WHERE room_id = $1', [id]);
      if (Number(countResult.rows[0].count) >= room.max_players) {
        return res.status(400).json({ error: 'Room is full' });
      }

      await db.query('INSERT INTO room_players (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, userId]);
      emitRoomsUpdated();
      return res.json({ message: 'Joined room', room });
    } catch (e) {
      console.error('[Join]', e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  if (findUserRoom(userId)) return res.status(409).json({ error: 'Leave your current room first' });

  const room = memRooms.get(id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (room.has_password) {
    if (!password) return res.status(403).json({ error: 'Password required', need_password: true });
    const ok = await bcrypt.compare(password, room.password_hash);
    if (!ok) return res.status(403).json({ error: 'Invalid password' });
  }
  if (room.players.size >= room.max_players) return res.status(400).json({ error: 'Room is full' });

  room.players.set(userId, req.user.username || 'Guest');
  return res.json({ message: 'Joined room', room: roomToPublic(room) });
});

router.post('/:id/leave', strictAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (await dbOk()) {
    try {
      await db.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [id, userId]);
      const result = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
      if (result.rows[0] && String(result.rows[0].host_id) === String(userId)) {
        await db.query("UPDATE bot_jobs SET status='cancelled', updated_at=NOW() WHERE room_id=$1 AND status IN ('queued','hosting','lobby')", [id]).catch(() => {});
        await db.query('DELETE FROM rooms WHERE id = $1', [id]);
        if (_io) _io.to(id).emit('room:closed', { reason: 'Host left the room' });
        cleanupRoom(id);
        if (result.rows[0].zerotier_network_id && !process.env.ZEROTIER_DEFAULT_NETWORK) {
          await ztDeleteNetwork(result.rows[0].zerotier_network_id);
        }
        emitRoomsUpdated();
        return res.json({ message: 'Room deleted' });
      }

      emitRoomsUpdated();
      return res.json({ message: 'Left room' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const room = memRooms.get(id);
  if (room) {
    room.players.delete(userId);
    if (String(room.host_id) === String(userId)) {
      memRooms.delete(id);
      if (_io) _io.to(id).emit('room:closed', { reason: 'Host left the room' });
    }
  }
  return res.json({ message: 'Left room' });
});

router.delete('/:id', strictAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (await dbOk()) {
    try {
      const result = await db.query('SELECT host_id, zerotier_network_id FROM rooms WHERE id = $1', [id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Room not found' });
      if (String(result.rows[0].host_id) !== String(userId)) {
        return res.status(403).json({ error: 'Only the host can close the room' });
      }

      await db.query("UPDATE bot_jobs SET status='cancelled', updated_at=NOW() WHERE room_id=$1 AND status IN ('queued','hosting','lobby')", [id]).catch(() => {});
      await db.query('DELETE FROM rooms WHERE id = $1', [id]);
      if (_io) _io.to(id).emit('room:closed', { reason: 'Host closed the room' });
      cleanupRoom(id);
      if (result.rows[0].zerotier_network_id && !process.env.ZEROTIER_DEFAULT_NETWORK) {
        await ztDeleteNetwork(result.rows[0].zerotier_network_id);
      }
      emitRoomsUpdated();
      return res.json({ message: 'Room closed' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const room = memRooms.get(id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (String(room.host_id) !== String(userId)) {
    return res.status(403).json({ error: 'Only the host can close the room' });
  }
  memRooms.delete(id);
  if (_io) _io.to(id).emit('room:closed', { reason: 'Host closed the room' });
  return res.json({ message: 'Room closed' });
});

router.post('/:id/kick/:targetId', strictAuth, async (req, res) => {
  const { id, targetId } = req.params;
  const userId = req.user.id;

  if (await dbOk()) {
    try {
      const result = await db.query('SELECT host_id FROM rooms WHERE id = $1', [id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Room not found' });
      if (String(result.rows[0].host_id) !== String(userId)) {
        return res.status(403).json({ error: 'Only the host can kick players' });
      }
      if (String(targetId) === String(userId)) {
        return res.status(400).json({ error: 'Cannot kick yourself' });
      }

      await db.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [id, targetId]);
      if (_io) _io.to(id).emit('room:kicked', { userId: String(targetId) });
      return res.json({ message: 'Player kicked' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const room = memRooms.get(id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (String(room.host_id) !== String(userId)) {
    return res.status(403).json({ error: 'Only the host can kick players' });
  }
  room.players.delete(targetId);
  if (_io) _io.to(id).emit('room:kicked', { userId: String(targetId) });
  return res.json({ message: 'Player kicked' });
});

router.post('/:id/start', strictAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (await dbOk()) {
    try {
      const roomResult = await db.query('SELECT host_id, status FROM rooms WHERE id = $1', [id]);
      if (!roomResult.rows[0]) return res.status(404).json({ error: 'Room not found' });
      if (String(roomResult.rows[0].host_id) !== String(userId)) {
        return res.status(403).json({ error: 'Only the host can start the game' });
      }
      if (roomResult.rows[0].status === 'playing') {
        return res.json({ message: 'Game already started' });
      }

      await db.query("UPDATE rooms SET status = 'playing' WHERE id = $1 AND host_id = $2", [id, userId]);
      if (_io) _io.to(id).emit('room:started');
      emitRoomsUpdated();
      return res.json({ message: 'Game started' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const room = memRooms.get(id);
  if (room && String(room.host_id) === String(userId)) {
    room.status = 'playing';
    if (_io) _io.to(id).emit('room:started');
  }
  return res.json({ message: 'Game started' });
});

router.post('/:id/end', strictAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;

  if (await dbOk()) {
    try {
      const result = await db.query('SELECT host_id, status FROM rooms WHERE id = $1', [id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Room not found' });
      if (String(result.rows[0].host_id) !== String(userId)) {
        return res.status(403).json({ error: 'Only the host can end the game' });
      }
      if (result.rows[0].status !== 'playing') {
        return res.json({ message: 'Already waiting' });
      }

      await db.query("UPDATE rooms SET status = 'waiting' WHERE id = $1", [id]);
      if (_io) {
        _io.to(String(id)).emit('room:host_game_ended');
        emitRoomsUpdated();
      }
      return res.json({ message: 'Game ended' });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const room = memRooms.get(id);
  if (room && String(room.host_id) === String(userId)) {
    room.status = 'waiting';
    if (_io) {
      _io.to(String(id)).emit('room:host_game_ended');
      emitRoomsUpdated();
    }
  }
  return res.json({ message: 'Game ended' });
});

router.patch('/:id', strictAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const { name, max_players, password, description, game_mode } = req.body;

  if (await dbOk()) {
    try {
      const roomResult = await db.query('SELECT host_id FROM rooms WHERE id = $1', [id]);
      if (!roomResult.rows[0]) return res.status(404).json({ error: 'Room not found' });
      if (String(roomResult.rows[0].host_id) !== String(userId)) {
        return res.status(403).json({ error: 'Only the host can update the room' });
      }

      const updates = [];
      const params = [];

      if (name && name.trim()) {
        params.push(name.trim());
        updates.push(`name=$${params.length}`);
      }
      if (max_players && Number.isInteger(Number(max_players)) && Number(max_players) > 0) {
        params.push(Number(max_players));
        updates.push(`max_players=$${params.length}`);
      }
      if (password !== undefined) {
        if (password === null || password === '') {
          updates.push('has_password=FALSE', 'password_hash=NULL');
        } else {
          const hash = await bcrypt.hash(password, 8);
          params.push(true, hash);
          updates.push(`has_password=$${params.length - 1}`, `password_hash=$${params.length}`);
        }
      }
      if (description !== undefined) {
        params.push(String(description || '').trim().slice(0, 200));
        updates.push(`description=$${params.length}`);
      }
      if (game_mode !== undefined) {
        params.push(String(game_mode || '').trim());
        updates.push(`game_mode=$${params.length}`);
      }

      if (updates.length > 0) {
        params.push(id);
        await db.query(`UPDATE rooms SET ${updates.join(',')} WHERE id=$${params.length}`, params);
      }

      const updated = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
      if (_io) _io.to(id).emit('room:updated', updated.rows[0]);
      return res.json({ ok: true, room: updated.rows[0] });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const room = memRooms.get(id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (String(room.host_id) !== String(userId)) {
    return res.status(403).json({ error: 'Only the host can update the room' });
  }

  if (name) room.name = name.trim();
  if (max_players) room.max_players = Number(max_players);
  if (description !== undefined) room.description = String(description || '').trim().slice(0, 200);
  if (game_mode !== undefined) room.game_mode = String(game_mode || '').trim();
  if (_io) _io.to(id).emit('room:updated', roomToPublic(room));
  return res.json({ ok: true, room: roomToPublic(room) });
});

router.post('/quickmatch', strictAuth, async (req, res) => {
  const { game_type } = req.body;
  if (!game_type) return res.status(400).json({ error: 'game_type is required' });

  const userId = req.user.id;
  const hostName = req.user.username || 'Guest';

  if (await dbOk()) {
    try {
      const existing = await db.query(
        `SELECT r.id FROM rooms r
         JOIN room_players rp ON r.id = rp.room_id
         WHERE rp.user_id = $1 AND r.status IN ('waiting','playing')
         LIMIT 1`,
        [userId]
      );
      if (existing.rows[0]) {
        return res.status(409).json({ error: 'Leave your current room first' });
      }

      const available = await db.query(`
        SELECT r.id, COUNT(rp.user_id) AS player_count
        FROM rooms r
        LEFT JOIN room_players rp ON r.id = rp.room_id
        WHERE r.status='waiting' AND r.has_password=FALSE AND r.game_type=$1
        GROUP BY r.id
        HAVING COUNT(rp.user_id) < r.max_players
        ORDER BY player_count DESC
        LIMIT 1
      `, [game_type]);

      if (available.rows[0]) {
        const roomId = available.rows[0].id;
        await db.query('INSERT INTO room_players (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roomId, userId]);
        const roomResult = await db.query(`
          SELECT r.id, r.name, r.host_id, u.username AS host_name,
            r.max_players, r.game_type, r.status, r.has_password, r.zerotier_network_id,
            COUNT(rp.user_id) AS player_count,
            JSON_AGG(JSON_BUILD_OBJECT('id', u2.id::text, 'name', u2.username)
              ORDER BY rp.joined_at) FILTER (WHERE u2.username IS NOT NULL) AS members
          FROM rooms r
          JOIN users u ON r.host_id=u.id
          LEFT JOIN room_players rp ON r.id=rp.room_id
          LEFT JOIN users u2 ON rp.user_id=u2.id
          WHERE r.id=$1
          GROUP BY r.id, u.username
        `, [roomId]);
        emitRoomsUpdated();
        return res.json({ joined: true, room: { ...roomResult.rows[0], members: roomResult.rows[0].members || [] } });
      }

      const qname = `Quick Match #${Math.floor(Math.random() * 9000) + 1000}`;
      const ztNetId = process.env.ZEROTIER_DEFAULT_NETWORK || null;
      const result = await db.query(
        'INSERT INTO rooms (name, host_id, max_players, game_type, has_password, zerotier_network_id) VALUES ($1, $2, 10, $3, FALSE, $4) RETURNING *',
        [qname, userId, game_type, ztNetId]
      );
      const room = result.rows[0];
      await db.query('INSERT INTO room_players (room_id, user_id) VALUES ($1, $2)', [room.id, userId]);
      emitRoomsUpdated();
      return res.status(201).json({
        joined: false,
        room: { ...room, host_name: hostName, members: [{ id: String(userId), name: hostName }], player_count: 1 },
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  return requireOperationalDb(res);
});

async function getRoomNetworkId(roomId) {
  if (!roomId) return null;

  if (await dbOk()) {
    try {
      const result = await db.query(
        "SELECT zerotier_network_id FROM rooms WHERE id = $1 AND status IN ('waiting', 'playing')",
        [roomId]
      );
      return result.rows[0]?.zerotier_network_id || null;
    } catch (e) {
      console.error('[RoomNetwork]', e.message);
      return null;
    }
  }

  if (!allowInMemoryFallback) return null;
  const room = memRooms.get(String(roomId)) || memRooms.get(roomId);
  return room?.zerotier_network_id || null;
}

router.patch('/:id/team', strictAuth, async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const team = Number(req.body.team);
  if (![1, 2].includes(team)) return res.status(400).json({ error: 'team must be 1 or 2' });

  if (await dbOk()) {
    try {
      const roomResult = await db.query('SELECT max_players FROM rooms WHERE id = $1', [id]);
      if (!roomResult.rows[0]) return res.status(404).json({ error: 'Room not found' });

      const countResult = await db.query('SELECT COUNT(*) FROM room_players WHERE room_id = $1 AND team = $2', [id, team]);
      const max = Math.ceil(roomResult.rows[0].max_players / 2);
      if (Number(countResult.rows[0].count) >= max) {
        return res.status(400).json({ error: 'Team is full' });
      }

      const updateResult = await db.query(
        'UPDATE room_players SET team = $1 WHERE room_id = $2 AND user_id = $3 RETURNING user_id',
        [team, id, userId]
      );
      if (!updateResult.rows[0]) {
        return res.status(403).json({ error: 'You are not a member of this room' });
      }
      if (_io) _io.to(id).emit('room:team_changed', { userId: String(userId), team });
      return res.json({ ok: true, team });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  return res.json({ ok: true });
});

async function isUserInRoom(userId, roomId) {
  if (!userId || !roomId) return false;

  if (await dbOk()) {
    try {
      const result = await db.query(
        `SELECT 1
         FROM room_players rp
         JOIN rooms r ON r.id = rp.room_id
         WHERE rp.user_id = $1 AND rp.room_id = $2 AND r.status IN ('waiting', 'playing')
         LIMIT 1`,
        [userId, roomId]
      );
      return !!result.rows[0];
    } catch (e) {
      console.error('[RoomMembership]', e.message);
      return false;
    }
  }

  if (!allowInMemoryFallback) return false;
  const room = memRooms.get(String(roomId)) || memRooms.get(roomId);
  return !!room?.players?.has(userId);
}

module.exports = router;
module.exports.setIO = setIO;
module.exports.setRoomCleanup = setRoomCleanup;
module.exports.memRooms = memRooms;
module.exports.isUserInRoom = isUserInRoom;
module.exports.getRoomNetworkId = getRoomNetworkId;
