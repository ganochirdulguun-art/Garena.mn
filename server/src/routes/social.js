const express = require('express');
const authMW = require('../middleware/auth');

let db;
try { db = require('../config/db'); } catch { db = null; }

const allowInMemoryFallback = process.env.NODE_ENV !== 'production';
const router = express.Router();
let _io = null;

async function dbOk() {
  if (!db) return false;
  try {
    await db.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// Гишүүнчлэлийн найзын хязгаар: Bronze 50 / Silver 100 / Gold 200
async function friendLimitError(userId) {
  try {
    const { tierOf, perksOf } = require('./membership');
    const tier = await tierOf(userId);
    const limit = perksOf(tier).friends;
    const c = await db.query(
      `SELECT COUNT(*)::int AS n FROM friendships WHERE (requester_id = $1 OR receiver_id = $1) AND status = 'accepted'`,
      [userId]
    );
    if ((c.rows[0]?.n || 0) >= limit) {
      return { error: `Найзын хязгаар дүүрсэн (${limit}). Silver / Gold гишүүнчлэлээр нэмэгдүүлнэ.`, code: 'FRIEND_LIMIT', limit, tier };
    }
  } catch (e) {
    console.error('[friend-limit]', e.message);
  }
  return null;
}

function requireOperationalDb(res) {
  return res.status(503).json({ error: 'Service temporarily unavailable' });
}

const memFriends = new Map();
const memPendingReceived = new Map();
const memBlocked = new Map();

function getSet(map, key) {
  if (!map.has(String(key))) map.set(String(key), new Set());
  return map.get(String(key));
}

function getMap(map, key) {
  if (!map.has(String(key))) map.set(String(key), new Map());
  return map.get(String(key));
}

function areFriends(id1, id2) {
  return getSet(memFriends, id1).has(String(id2));
}

async function initTables() {
  if (!await dbOk()) return;
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS friendships (
        id SERIAL PRIMARY KEY,
        requester_id INTEGER NOT NULL,
        receiver_id INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(requester_id, receiver_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        blocked_user_id INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, blocked_user_id)
      )
    `);
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation
      ON messages(LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_unread
      ON messages(receiver_id, is_read) WHERE is_read = FALSE
    `);
  } catch (e) {
    console.error('[Social] init:', e.message);
  }
}

function setIO(io) {
  _io = io;
}

async function isUserBlocked(receiverId, senderId) {
  if (await dbOk()) {
    try {
      const result = await db.query(
        `SELECT 1
         FROM blocked_users
         WHERE user_id = $1 AND blocked_user_id = $2
         LIMIT 1`,
        [receiverId, senderId]
      );
      return !!result.rows[0];
    } catch (e) {
      console.error('[isUserBlocked]', e.message);
      return false;
    }
  }

  return getSet(memBlocked, receiverId).has(String(senderId));
}

router.get('/friends', authMW, async (req, res) => {
  const myId = req.user.id;
  if (await dbOk()) {
    try {
      const result = await db.query(`
        SELECT u.id, u.username, u.avatar_url
        FROM friendships f
        JOIN users u ON (
          CASE WHEN f.requester_id = $1 THEN f.receiver_id ELSE f.requester_id END = u.id
        )
        WHERE (f.requester_id = $1 OR f.receiver_id = $1) AND f.status = 'accepted'
        ORDER BY u.username
      `, [myId]);
      return res.json(result.rows);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const ids = [...getSet(memFriends, myId)];
  return res.json(ids.map((id) => ({ id: parseInt(id, 10), username: `User#${id}`, avatar_url: null })));
});

router.get('/pending', authMW, async (req, res) => {
  const myId = req.user.id;
  if (await dbOk()) {
    try {
      const result = await db.query(`
        SELECT u.id, u.username, u.avatar_url, f.created_at
        FROM friendships f
        JOIN users u ON f.requester_id = u.id
        WHERE f.receiver_id = $1 AND f.status = 'pending'
        ORDER BY f.created_at DESC
      `, [myId]);
      return res.json(result.rows);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  return res.json([...getMap(memPendingReceived, myId).values()]);
});

router.post('/friend/request', authMW, async (req, res) => {
  const myId = req.user.id;
  const { toUserId } = req.body;
  if (!toUserId) return res.status(400).json({ error: 'toUserId is required' });
  if (String(toUserId) === String(myId)) return res.status(400).json({ error: 'Cannot friend yourself' });

  if (await dbOk()) {
    try {
      const exists = await db.query(
        `SELECT id, status FROM friendships
         WHERE (requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1)`,
        [myId, toUserId]
      );
      if (exists.rows[0]) {
        if (exists.rows[0].status === 'accepted') return res.status(409).json({ error: 'Already friends' });
        return res.status(409).json({ error: 'Request already exists' });
      }

      const limitErr = await friendLimitError(myId);
      if (limitErr) return res.status(403).json(limitErr);

      const userRow = await db.query('SELECT username, avatar_url FROM users WHERE id = $1', [myId]);
      await db.query(
        `INSERT INTO friendships (requester_id, receiver_id, status) VALUES ($1, $2, 'pending')`,
        [myId, toUserId]
      );

      if (_io) {
        _io.to(`user:${toUserId}`).emit('friend:request', {
          fromUserId: myId,
          fromUsername: userRow.rows[0]?.username || req.user.username,
          fromAvatarUrl: userRow.rows[0]?.avatar_url || req.user.avatar_url,
        });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  if (areFriends(myId, toUserId)) return res.status(409).json({ error: 'Already friends' });

  const pending = getMap(memPendingReceived, toUserId);
  if (pending.has(String(myId))) return res.status(409).json({ error: 'Request already exists' });
  pending.set(String(myId), { id: myId, username: req.user.username, avatar_url: req.user.avatar_url || null });

  if (_io) {
    _io.to(`user:${toUserId}`).emit('friend:request', {
      fromUserId: myId,
      fromUsername: req.user.username,
      fromAvatarUrl: req.user.avatar_url || null,
    });
  }
  return res.json({ ok: true });
});

router.post('/friend/accept', authMW, async (req, res) => {
  const myId = req.user.id;
  const { fromUserId } = req.body;
  if (!fromUserId) return res.status(400).json({ error: 'fromUserId is required' });

  if (await dbOk()) {
    try {
      const myLimit = await friendLimitError(myId);
      if (myLimit) return res.status(403).json(myLimit);
      const theirLimit = await friendLimitError(fromUserId);
      if (theirLimit) return res.status(403).json({ ...theirLimit, error: `Нөгөө талын найзын хязгаар дүүрсэн (${theirLimit.limit}).` });

      const result = await db.query(
        `UPDATE friendships
         SET status = 'accepted'
         WHERE requester_id = $1 AND receiver_id = $2 AND status = 'pending'
         RETURNING id`,
        [fromUserId, myId]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'Request not found' });

      if (_io) {
        _io.to(`user:${fromUserId}`).emit('friend:accepted', {
          byUserId: myId,
          byUsername: req.user.username,
        });
      }
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const pending = getMap(memPendingReceived, myId);
  if (!pending.has(String(fromUserId))) return res.status(404).json({ error: 'Request not found' });
  pending.delete(String(fromUserId));
  getSet(memFriends, myId).add(String(fromUserId));
  getSet(memFriends, fromUserId).add(String(myId));

  if (_io) {
    _io.to(`user:${fromUserId}`).emit('friend:accepted', {
      byUserId: myId,
      byUsername: req.user.username,
    });
  }
  return res.json({ ok: true });
});

router.post('/friend/decline', authMW, async (req, res) => {
  const myId = req.user.id;
  const { fromUserId } = req.body;
  if (!fromUserId) return res.status(400).json({ error: 'fromUserId is required' });

  if (await dbOk()) {
    try {
      await db.query(
        `DELETE FROM friendships WHERE requester_id = $1 AND receiver_id = $2 AND status = 'pending'`,
        [fromUserId, myId]
      );
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  getMap(memPendingReceived, myId).delete(String(fromUserId));
  return res.json({ ok: true });
});

router.post('/friend/remove', authMW, async (req, res) => {
  const myId = req.user.id;
  const { friendId } = req.body;
  if (!friendId) return res.status(400).json({ error: 'friendId is required' });

  if (await dbOk()) {
    try {
      await db.query(
        `DELETE FROM friendships
         WHERE (requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1)`,
        [myId, friendId]
      );
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  getSet(memFriends, myId).delete(String(friendId));
  getSet(memFriends, friendId).delete(String(myId));
  return res.json({ ok: true });
});

router.post('/block', authMW, async (req, res) => {
  const myId = req.user.id;
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });

  if (await dbOk()) {
    try {
      await db.query(
        `DELETE FROM friendships
         WHERE (requester_id = $1 AND receiver_id = $2) OR (requester_id = $2 AND receiver_id = $1)`,
        [myId, targetUserId]
      );
      await db.query(
        `INSERT INTO blocked_users (user_id, blocked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [myId, targetUserId]
      );
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  getSet(memFriends, myId).delete(String(targetUserId));
  getSet(memFriends, targetUserId).delete(String(myId));
  getMap(memPendingReceived, myId).delete(String(targetUserId));
  getMap(memPendingReceived, targetUserId).delete(String(myId));
  getSet(memBlocked, myId).add(String(targetUserId));
  return res.json({ ok: true });
});

router.post('/unblock', authMW, async (req, res) => {
  const myId = req.user.id;
  const { targetUserId } = req.body;
  if (!targetUserId) return res.status(400).json({ error: 'targetUserId is required' });

  if (await dbOk()) {
    try {
      await db.query('DELETE FROM blocked_users WHERE user_id = $1 AND blocked_user_id = $2', [myId, targetUserId]);
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  getSet(memBlocked, myId).delete(String(targetUserId));
  return res.json({ ok: true });
});

router.get('/blocked', authMW, async (req, res) => {
  const myId = req.user.id;
  if (await dbOk()) {
    try {
      const result = await db.query(`
        SELECT u.id, u.username, u.avatar_url
        FROM blocked_users b
        JOIN users u ON b.blocked_user_id = u.id
        WHERE b.user_id = $1
        ORDER BY u.username
      `, [myId]);
      return res.json(result.rows);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const ids = [...getSet(memBlocked, myId)];
  return res.json(ids.map((id) => ({ id: parseInt(id, 10), username: `User#${id}`, avatar_url: null })));
});

router.get('/search', authMW, async (req, res) => {
  const { q } = req.query;
  if (!q || String(q).trim().length < 2) return res.status(400).json({ error: 'Query must be at least 2 characters' });

  if (await dbOk()) {
    try {
      const result = await db.query(
        `SELECT id, username, avatar_url FROM users
         WHERE LOWER(username) LIKE LOWER($1) AND id != $2
         ORDER BY username LIMIT 20`,
        [`%${String(q).trim()}%`, req.user.id]
      );
      return res.json(result.rows);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  return res.json([]);
});

router.get('/messages/:userId', authMW, async (req, res) => {
  const myId = req.user.id;
  const otherId = parseInt(req.params.userId, 10);
  const before = req.query.before ? parseInt(req.query.before, 10) : null;
  if (!otherId) return res.status(400).json({ error: 'userId is required' });

  if (await dbOk()) {
    try {
      const whereClause = before ? 'AND m.id < $3' : '';
      const params = before ? [myId, otherId, before] : [myId, otherId];
      const result = await db.query(`
        SELECT m.id, m.sender_id, m.receiver_id, m.text, m.is_read, m.created_at,
          u.username AS sender_username
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE (
          (m.sender_id = $1 AND m.receiver_id = $2) OR
          (m.sender_id = $2 AND m.receiver_id = $1)
        ) ${whereClause}
        ORDER BY m.created_at DESC
        LIMIT 50
      `, params);
      return res.json(result.rows.reverse());
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  return res.json([]);
});

router.get('/unread', authMW, async (req, res) => {
  const myId = req.user.id;
  if (await dbOk()) {
    try {
      const result = await db.query(`
        SELECT sender_id, COUNT(*) AS count
        FROM messages
        WHERE receiver_id = $1 AND is_read = FALSE
        GROUP BY sender_id
      `, [myId]);
      const mapped = {};
      result.rows.forEach((row) => { mapped[String(row.sender_id)] = parseInt(row.count, 10); });
      return res.json(mapped);
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  return res.json({});
});

router.post('/messages/read', authMW, async (req, res) => {
  const myId = req.user.id;
  const { fromUserId } = req.body;
  if (!fromUserId) return res.status(400).json({ error: 'fromUserId is required' });

  if (await dbOk()) {
    try {
      await db.query(
        'UPDATE messages SET is_read = TRUE WHERE receiver_id = $1 AND sender_id = $2 AND is_read = FALSE',
        [myId, fromUserId]
      );
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Server error' });
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  return res.json({ ok: true });
});

async function saveMessage(senderId, receiverId, text) {
  if (!await dbOk()) return null;
  try {
    const result = await db.query(
      'INSERT INTO messages (sender_id, receiver_id, text) VALUES ($1, $2, $3) RETURNING id, created_at',
      [senderId, receiverId, text]
    );
    return result.rows[0];
  } catch (e) {
    console.error('[saveMessage]', e.message);
    return null;
  }
}

module.exports = router;
module.exports.setIO = setIO;
module.exports.isUserBlocked = isUserBlocked;
module.exports.saveMessage = saveMessage;
