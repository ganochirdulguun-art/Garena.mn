const express = require('express');
const bcrypt = require('bcrypt');
const auth = require('../middleware/auth');

const optAuth = auth.optional;
const strictAuth = auth;

let db;
try { db = require('../config/db'); } catch { db = null; }

const allowInMemoryFallback = process.env.NODE_ENV !== 'production';
const router = express.Router();
const clans = require('./clans');

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
    ranked: !!room.ranked,   // 🏆 Ranked өрөө: хүчинтэй хожил бүр 2💎 (relay дүн), энгийн өрөө 💎 үгүй
    background_url: room.background_url || '',
    status: room.status,
    playing_since: room.playing_since || null,
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
      // Кланы өрөө (clan_id) — зөвхөн тухайн кланы гишүүдэд харагдана (2026-09-30)
      const myClans = await clans.memberClanIds(req.user?.id);
      const result = await db.query(`
        SELECT r.id, r.name, r.host_id, u.username AS host_name,
          r.max_players, r.game_type, r.description, r.game_mode, r.background_url, r.ranked,
          r.status, r.has_password, r.zerotier_network_id, r.playing_since, r.created_at,
          r.clan_id, c.name AS clan_name, c.tag AS clan_tag,
          COALESCE(r.kind, 'room') AS kind, r.channel_no, r.visible_cap,
          COUNT(rp.user_id) AS player_count,
          -- Нийтийн Room 1–20 (channel): 300 хүртэлх гишүүнийг жагсаалтад агрегатлахгүй (зөвхөн тоо)
          JSON_AGG(JSON_BUILD_OBJECT('id', u2.id::text, 'name', u2.username, 'tier', u2.tierbot_tier)
            ORDER BY rp.joined_at) FILTER (WHERE u2.username IS NOT NULL AND COALESCE(r.kind, 'room') <> 'channel') AS members
        FROM rooms r
        LEFT JOIN users u ON r.host_id = u.id
        LEFT JOIN clans c ON c.id = r.clan_id
        LEFT JOIN room_players rp ON r.id = rp.room_id
        LEFT JOIN users u2 ON rp.user_id = u2.id
        WHERE r.status IN ('waiting','playing')
          AND (r.clan_id IS NULL OR r.clan_id = ANY($1::int[]))
        GROUP BY r.id, u.username, c.name, c.tag
        ORDER BY (COALESCE(r.kind, 'room') = 'channel') DESC, r.channel_no ASC NULLS LAST, r.created_at DESC
      `, [myClans]);
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
          r.max_players, r.game_type, r.description, r.game_mode, r.background_url, r.ranked,
          r.status, r.has_password, r.zerotier_network_id, r.playing_since, r.clan_id, r.description,
          COALESCE(r.kind, 'room') AS kind, r.channel_no, r.visible_cap, r.pinned_notice,
          (SELECT c.tag FROM clans c WHERE c.id = r.clan_id) AS clan_tag,
          COUNT(rp2.user_id) AS player_count,
          JSON_AGG(JSON_BUILD_OBJECT('id', u2.id::text, 'name', u2.username, 'tier', u2.tierbot_tier)
            ORDER BY rp2.joined_at) FILTER (WHERE u2.username IS NOT NULL) AS members
        FROM rooms r
        LEFT JOIN users u ON r.host_id = u.id
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
  // 🏆 Ranked зөвхөн нийтийн WC3 Room 1–5-д (2026-10-02, эзний шийдвэр) — хувийн/кланы өрөө Ranked болохгүй
  const ranked = false;
  if (!name) return res.status(400).json({ error: 'Room name is required' });
  if (!game_type) return res.status(400).json({ error: 'Game type is required' });
  // Кланы өрөө — зөвхөн тухайн кланы гишүүн үүсгэнэ
  const clanId = req.body?.clan_id ? Number(req.body.clan_id) : null;
  if (clanId && !await clans.clanAccess(req.user.id, clanId)) {
    return res.status(403).json({ error: 'Зөвхөн кланы гишүүд кланы өрөө үүсгэнэ', code: 'CLAN_ONLY' });
  }

  // 2026-10-02 (эзэн): өөрийн өрөө үүсгэх эрх зөвхөн GOLD (энгийн/Silver нь нийтийн Room 1–20-оор тоглоно).
  // Кланы өрөө (кланы гишүүн) болон эзэн/админ чөлөөлөгдөнө.
  if (!clanId) {
    let allowed = false;
    try { allowed = await require('../middleware/admin').isAdminUser(req.user); } catch {}
    if (!allowed) { try { const { tierOf } = require('./membership'); allowed = (await tierOf(req.user.id)) === 'gold'; } catch {} }
    if (!allowed) return res.status(403).json({ error: 'Өөрийн өрөө үүсгэх нь GOLD гишүүнчлэлийн эрх. Нийтийн Room 1–20-оор тоглоорой.', code: 'TIER_REQUIRED', need_tier: 'gold' });
  }

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
        `INSERT INTO rooms (name, host_id, max_players, game_type, has_password, password_hash, description, game_mode, background_url, ranked, clan_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING *`,
        [name, userId, max_players, game_type, hasPassword, passwordHash, descTrimmed, game_mode || '', bgUrl, ranked, clanId]
      );

      const room = result.rows[0];
      await db.query('INSERT INTO room_players (room_id, user_id) VALUES ($1, $2)', [room.id, userId]);

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
    zerotier_network_id: null,
    description: descTrimmed,
    game_mode: game_mode || '',
    ranked,
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
      // 0) MapHack-аар бандуулсан хэрэглэгч өрөөнд нэгдэхийг хориглоно
      const banChk = await db.query('SELECT COALESCE(banned,FALSE) AS banned, ban_reason FROM users WHERE id = $1', [userId]);
      if (banChk.rows[0]?.banned) {
        return res.status(403).json({ error: 'banned', reason: banChk.rows[0].ban_reason || 'MapHack' });
      }
      // 1) Target өрөөг ЭХЛЭЭД шалгана — хуучин өрөөнөөс гаргахаас ӨМНӨ (эс бөгөөс
      //    'playing' өрөөрүү нэгдэх гэсэн хүн хуучин өрөөгөө дэмий алдана).
      const roomResult = await db.query('SELECT * FROM rooms WHERE id = $1', [id]);
      const room = roomResult.rows[0];
      if (!room) return res.status(404).json({ error: 'Room not found' });
      if (room.status === 'done') return res.status(400).json({ error: 'Room is closed' });
      if (room.clan_id && !await clans.clanAccess(userId, room.clan_id)) {
        return res.status(403).json({ error: 'Энэ бол кланы өрөө — зөвхөн кланы гишүүд нэгдэнэ', code: 'CLAN_ONLY', clan_id: room.clan_id });
      }

      const already = await db.query(
        `SELECT r.id FROM rooms r
         JOIN room_players rp ON r.id = rp.room_id
         WHERE rp.user_id = $1 AND r.status IN ('waiting','playing')
         LIMIT 1`,
        [userId]
      );

      // Энэ өрөөнд аль хэдийн гишүүн бол (тоглолт эхэлсэн ч) зөвшөөрнө
      if (already.rows[0] && String(already.rows[0].id) === String(id)) {
        return res.json({ message: 'Joined room', room });
      }
      // Тоглолт эхэлсэн (LAN тоглоом нээгдсэн) өрөөнд ГАДНЫН/шинэ хүн нэгдэхийг хориглоно —
      // хуучин өрөөг хөндөхөөс ӨМНӨ татгалзана.
      if (room.status === 'playing') {
        return res.status(409).json({ error: 'Тоглолт эхэлсэн тул энэ өрөөнд нэгдэх боломжгүй', code: 'GAME_STARTED' });
      }

      // Өөр өрөөнд байсан бол тэндээс гаргана
      if (already.rows[0]) {
        const oldId = already.rows[0].id;
        await db.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [oldId, userId]);
        const oldRoom = await db.query('SELECT host_id FROM rooms WHERE id = $1', [oldId]);
        if (String(oldRoom.rows[0]?.host_id) === String(userId)) {
          // Идэвхтэй бот-жобыг цуцална — эс бөгөөс room устахад FK SET NULL-аар өнчирч GHost "сүнс" lobby үлддэг
          await db.query("UPDATE bot_jobs SET status='cancelled', updated_at=NOW() WHERE room_id=$1 AND status IN ('queued','hosting','lobby')", [oldId]).catch(() => {});
          await db.query('DELETE FROM rooms WHERE id = $1', [oldId]);
          if (_io) _io.to(String(oldId)).emit('room:closed', { reason: 'Host left the room' });
          cleanupRoom(oldId);
        }
        emitRoomsUpdated();
      }

      if (room.has_password) {
        if (!password) return res.status(403).json({ error: 'Password required', need_password: true });
        const ok = await bcrypt.compare(password, room.password_hash);
        if (!ok) return res.status(403).json({ error: 'Invalid password' });
      }

      const countResult = await db.query('SELECT COUNT(*) FROM room_players WHERE room_id = $1', [id]);
      const cnt = Number(countResult.rows[0].count);
      if (cnt >= room.max_players) {
        return res.status(400).json({ error: room.kind === 'channel' ? 'Өрөө бүрэн дүүрсэн байна — өөр Room сонгоно уу' : 'Room is full' });
      }
      // Нийтийн Room: visible_cap (200) дүүрсэн бол зөвхөн Silver/Gold/ажилтан Premium нөөц slot-оор орно
      if (room.kind === 'channel' && cnt >= Number(room.visible_cap || room.max_players)) {
        if (!await require('./channels').hasPremiumSlot(req.user)) {
          return res.status(403).json({ error: `Өрөө дүүрсэн (${cnt}/${room.visible_cap}). Silver/Gold гишүүд Premium нөөц slot-оор шууд орно.`, code: 'PREMIUM_SLOT', need_tier: 'silver' });
        }
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
      const result = await db.query('SELECT host_id FROM rooms WHERE id = $1', [id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Room not found' });
      if (String(result.rows[0].host_id) !== String(userId)) {
        return res.status(403).json({ error: 'Only the host can close the room' });
      }

      await db.query("UPDATE bot_jobs SET status='cancelled', updated_at=NOW() WHERE room_id=$1 AND status IN ('queued','hosting','lobby')", [id]).catch(() => {});
      await db.query('DELETE FROM rooms WHERE id = $1', [id]);
      if (_io) _io.to(id).emit('room:closed', { reason: 'Host closed the room' });
      cleanupRoom(id);
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

// ── Хост шилжүүлэх (GameRanger маяг, 2026-09-06): хост өрөөнийхөө гишүүнд хост эрхээ өгнө — өрөө хаагдахгүй,
//    хүмүүс дахин орох шаардлагагүй. Зөвхөн тоглолт явахгүй үед (status='waiting'). room:host_changed → өрөөнд.
router.post('/:id/transfer-host/:targetId', strictAuth, async (req, res) => {
  const { id, targetId } = req.params;
  const userId = req.user.id;
  if (String(targetId) === String(userId)) return res.status(400).json({ error: 'Өөртөө шилжүүлэх боломжгүй' });

  if (await dbOk()) {
    try {
      const r = await db.query('SELECT host_id, status FROM rooms WHERE id = $1', [id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Room not found' });
      if (String(r.rows[0].host_id) !== String(userId)) return res.status(403).json({ error: 'Зөвхөн хост шилжүүлнэ' });
      if (r.rows[0].status === 'playing') return res.status(409).json({ error: 'Тоглолт явж байхад хост шилжүүлэх боломжгүй — тоглолт дуусахыг хүлээнэ үү' });
      const m = await db.query('SELECT 1 FROM room_players WHERE room_id = $1 AND user_id = $2', [id, targetId]);
      if (!m.rows[0]) return res.status(400).json({ error: 'Тухайн хүн өрөөнд байхгүй' });
      const u = await db.query('SELECT id, username FROM users WHERE id = $1', [targetId]);
      if (!u.rows[0]) return res.status(404).json({ error: 'User not found' });
      await db.query('UPDATE rooms SET host_id = $1 WHERE id = $2', [targetId, id]);
      const payload = { roomId: String(id), host_id: String(targetId), host_name: u.rows[0].username,
                        by: String(userId), by_name: req.user.username || '' };
      if (_io) _io.to(String(id)).emit('room:host_changed', payload);
      emitRoomsUpdated();
      console.log(`[Room] хост шилжлээ: өрөө ${id} ${req.user.username || userId} → ${u.rows[0].username}`);
      return res.json({ ok: true, ...payload });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const room = memRooms.get(id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  if (String(room.host_id) !== String(userId)) return res.status(403).json({ error: 'Зөвхөн хост шилжүүлнэ' });
  if (!room.players.has(String(targetId)) && !room.players.has(Number(targetId))) return res.status(400).json({ error: 'Тухайн хүн өрөөнд байхгүй' });
  room.host_id = targetId;
  room.host_name = room.players.get(String(targetId)) || room.players.get(Number(targetId)) || room.host_name;
  const payload = { roomId: String(id), host_id: String(targetId), host_name: room.host_name, by: String(userId), by_name: req.user.username || '' };
  if (_io) _io.to(String(id)).emit('room:host_changed', payload);
  emitRoomsUpdated();
  return res.json({ ok: true, ...payload });
});

router.post('/:id/kick/:targetId', strictAuth, async (req, res) => {
  const { id, targetId } = req.params;
  const userId = req.user.id;

  if (await dbOk()) {
    try {
      const result = await db.query("SELECT host_id, COALESCE(kind,'room') AS kind FROM rooms WHERE id = $1", [id]);
      if (!result.rows[0]) return res.status(404).json({ error: 'Room not found' });
      // Нийтийн Room-д хост байхгүй — эзэн/админ гаргана (Ш2: шалтгаан заавал + лог)
      const staffKick = result.rows[0].kind === 'channel' && await require('../middleware/admin').isAdminUser(req.user);
      if (String(result.rows[0].host_id) !== String(userId) && !staffKick) {
        return res.status(403).json({ error: 'Only the host can kick players' });
      }
      if (String(targetId) === String(userId)) {
        return res.status(400).json({ error: 'Cannot kick yourself' });
      }
      // Нийтийн Room-оос гаргахад шалтгаан ЗААВАЛ (хувийн сэтгэл хөдлөлөөр kick хийхийг хянах) — kick_log-д бүртгэнэ
      const reason = String(req.body?.reason || '').replace(/\s+/g, ' ').trim().slice(0, 300);
      if (result.rows[0].kind === 'channel' && reason.length < 3) {
        return res.status(400).json({ error: 'Гаргах шалтгаанаа бичнэ үү (жишээ: «AFK 40 мин», «бүдүүлэг үг»)', code: 'REASON_REQUIRED' });
      }

      await db.query('DELETE FROM room_players WHERE room_id = $1 AND user_id = $2', [id, targetId]);
      if (result.rows[0].kind === 'channel') {
        await db.query('INSERT INTO kick_log (room_id, target_id, by_id, reason) VALUES ($1, $2, $3, $4)', [id, targetId, userId, reason]).catch((e) => console.error('[kick_log]', e.message));
      }
      if (_io) _io.to(id).emit('room:kicked', { userId: String(targetId), reason: reason || undefined });
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

// Бэхэлсэн зарлал (чатын дээд самбар) — эзэн/админ засна
router.patch('/:id/notice', strictAuth, async (req, res) => {
  if (!await dbOk()) return requireOperationalDb(res);
  try {
    if (!await require('../middleware/admin').isAdminUser(req.user)) return res.status(403).json({ error: 'Зөвхөн эзэн/админ' });
    const notice = String(req.body?.notice ?? '').replace(/\r/g, '').slice(0, 1500);
    const r = await db.query('UPDATE rooms SET pinned_notice = $2 WHERE id = $1 RETURNING id', [req.params.id, notice]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Room not found' });
    if (_io) _io.to(String(req.params.id)).emit('room:notice', { notice });
    return res.json({ ok: true, notice });
  } catch (e) { console.error('[notice]', e.message); return res.status(500).json({ error: 'Server error' }); }
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
        WHERE r.status='waiting' AND r.has_password=FALSE AND r.clan_id IS NULL AND r.game_type=$1
        GROUP BY r.id
        HAVING COUNT(rp.user_id) < CASE WHEN COALESCE(r.kind,'room') = 'channel' AND NOT $2::boolean THEN COALESCE(r.visible_cap, r.max_players) ELSE r.max_players END
        ORDER BY (COALESCE(r.kind,'room') = 'channel') DESC, player_count DESC
        LIMIT 1
      `, [game_type, await require('./channels').hasPremiumSlot(req.user)]);   // Нийтийн Room 1–20 эхэлж

      if (available.rows[0]) {
        const roomId = available.rows[0].id;
        await db.query('INSERT INTO room_players (room_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [roomId, userId]);
        const roomResult = await db.query(`
          SELECT r.id, r.name, r.host_id, u.username AS host_name,
            r.max_players, r.game_type, r.status, r.has_password, r.zerotier_network_id,
            COUNT(rp.user_id) AS player_count,
            JSON_AGG(JSON_BUILD_OBJECT('id', u2.id::text, 'name', u2.username, 'tier', u2.tierbot_tier)
              ORDER BY rp.joined_at) FILTER (WHERE u2.username IS NOT NULL) AS members
          FROM rooms r
          LEFT JOIN users u ON r.host_id=u.id
          LEFT JOIN room_players rp ON r.id=rp.room_id
          LEFT JOIN users u2 ON rp.user_id=u2.id
          WHERE r.id=$1
          GROUP BY r.id, u.username
        `, [roomId]);
        emitRoomsUpdated();
        return res.json({ joined: true, room: { ...roomResult.rows[0], members: roomResult.rows[0].members || [] } });
      }

      const qname = `Quick Match #${Math.floor(Math.random() * 9000) + 1000}`;
      const result = await db.query(
        'INSERT INTO rooms (name, host_id, max_players, game_type, has_password) VALUES ($1, $2, 10, $3, FALSE) RETURNING *',
        [qname, userId, game_type]
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
