const express = require('express');
const axios = require('axios');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const authMW = require('../middleware/auth');

let db;
try { db = require('../config/db'); } catch { db = null; }

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

const memUsers = new Map();
let memNextId = 1;
const pendingTokens = new Map();

function memFindByEmail(email) {
  const lower = email.toLowerCase();
  for (const user of memUsers.values()) {
    if ((user.email || '').toLowerCase() === lower) return user;
  }
  return null;
}

function memFindByDiscord(discordId) {
  for (const user of memUsers.values()) {
    if (user.discord_id === discordId) return user;
  }
  return null;
}

function memFindById(id) {
  return memUsers.get(id);
}

function makeJWT(user) {
  return jwt.sign(
    {
      id: user.id,
      discord_id: user.discord_id || null,
      discord_username: user.discord_username || null,
      username: user.username,
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function signDiscordLinkState(userId, qrState = '') {
  return `link:${jwt.sign(
    { type: 'discord-link', userId: String(userId), qrState: String(qrState || '') },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  )}`;
}

function parseDiscordState(rawState) {
  if (!rawState || !String(rawState).startsWith('link:')) {
    return { linkUserId: null, qrState: String(rawState || '') };
  }

  const payload = jwt.verify(String(rawState).slice(5), process.env.JWT_SECRET);
  if (payload?.type !== 'discord-link' || !payload?.userId) {
    throw new Error('Invalid state');
  }

  return {
    linkUserId: String(payload.userId),
    qrState: String(payload.qrState || ''),
  };
}

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  const email = (req.body.email || '').trim().toLowerCase();

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const hash = await bcrypt.hash(password, 10);

  if (await dbOk()) {
    try {
      const exists = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
      if (exists.rows[0]) return res.status(409).json({ error: 'Email already registered' });

      const result = await db.query(
        'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
        [username, email, hash]
      );
      return res.status(201).json({ token: makeJWT(result.rows[0]), user: result.rows[0] });
    } catch (e) {
      console.error(e);
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  if (memFindByEmail(email)) return res.status(409).json({ error: 'Email already registered' });

  const user = {
    id: memNextId++,
    username,
    email,
    password_hash: hash,
    discord_id: null,
    discord_username: null,
    avatar_url: null,
    wins: 0,
    losses: 0,
  };
  memUsers.set(user.id, user);
  return res.status(201).json({
    token: makeJWT(user),
    user: { id: user.id, username, email, avatar_url: null },
  });
});

router.post('/login', async (req, res) => {
  const { password } = req.body;
  const email = (req.body.email || '').trim().toLowerCase();

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  if (await dbOk()) {
    try {
      const result = await db.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
      const user = result.rows[0];
      if (!user || !user.password_hash) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
      return res.json({ token: makeJWT(user), user });
    } catch (e) {
      console.error(e);
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const user = memFindByEmail(email);
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid email or password' });
  return res.json({
    token: makeJWT(user),
    user: { id: user.id, username: user.username, email: user.email, avatar_url: user.avatar_url },
  });
});

router.get('/discord', (req, res) => {
  let stateVal = req.query.state || '';

  // Админ веб dashboard-ийн нэвтрэлт: callback хэрэглэгчийн апп руу биш,
  // browser дээрх /admin руу буцаана. Whitelist шалгалт callback дээр хийгдэнэ.
  if (req.query.admin) {
    stateVal = 'admin';
  } else if (req.query.link) {
    const token = req.query.token;
    if (!token || typeof token !== 'string') {
      return res.status(401).send('Unauthorized');
    }

    try {
      const user = jwt.verify(token, process.env.JWT_SECRET);
      stateVal = signDiscordLinkState(user.id, stateVal);
    } catch {
      return res.status(401).send('Unauthorized');
    }
  }

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify',
  });
  if (stateVal) params.set('state', stateVal);

  return res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

router.get('/discord/callback', async (req, res) => {
  const { code, state: rawState } = req.query;
  if (!code) return res.status(400).send('Missing code');

  const isAdminFlow = rawState === 'admin';
  let linkUserId = null;
  let qrState = '';
  if (!isAdminFlow) {
    try {
      const parsedState = parseDiscordState(rawState);
      linkUserId = parsedState.linkUserId;
      qrState = parsedState.qrState;
    } catch {
      return res.status(400).send('Invalid state');
    }
  }

  try {
    const tokenRes = await axios.post(
      'https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenRes.data.access_token;
    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const {
      id: discordId,
      username,
      global_name: globalName,
      avatar,
    } = userRes.data;
    const discordName = String(globalName || username || `Discord-${discordId}`).trim();
    const avatarUrl = avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${avatar}.png`
      : null;

    let jwtToken = null;

    if (await dbOk()) {
      try {
        let userRow;

        if (linkUserId) {
          const existing = await db.query(
            'SELECT id FROM users WHERE discord_id = $1 AND id <> $2',
            [discordId, linkUserId]
          );
          if (existing.rows[0]) {
            return res.status(409).send('Discord account already linked');
          }

          await db.query(
            'UPDATE users SET discord_id = $1, discord_username = $2, username = $2, avatar_url = COALESCE(avatar_url, $3) WHERE id = $4',
            [discordId, discordName, avatarUrl, linkUserId]
          );
          const result = await db.query('SELECT * FROM users WHERE id = $1', [linkUserId]);
          userRow = result.rows[0];
        } else {
          const result = await db.query(
            `INSERT INTO users (discord_id, username, discord_username, avatar_url)
             VALUES ($1, $2, $2, $3)
             ON CONFLICT (discord_id) DO UPDATE SET username = $2, discord_username = $2, avatar_url = $3
             RETURNING *`,
            [discordId, discordName, avatarUrl]
          );
          userRow = result.rows[0];
        }

        jwtToken = makeJWT(userRow);
      } catch (e) {
        console.error(e);
      }
    }

    if (!jwtToken) {
      if (!allowInMemoryFallback) return requireOperationalDb(res);

      let user;
      if (linkUserId) {
        user = memFindById(Number(linkUserId));
        if (user) {
          user.discord_id = discordId;
          user.discord_username = discordName;
          user.username = discordName;
          user.avatar_url = user.avatar_url || avatarUrl;
        }
      } else {
        user = memFindByDiscord(discordId);
        if (!user) {
          user = {
            id: memNextId++,
            username: discordName,
            discord_username: discordName,
            email: null,
            password_hash: null,
            discord_id: discordId,
            avatar_url: avatarUrl,
            wins: 0,
            losses: 0,
          };
          memUsers.set(user.id, user);
        } else {
          user.discord_username = discordName;
          user.username = discordName;
          user.avatar_url = avatarUrl;
        }
      }

      jwtToken = makeJWT(user || { id: discordId, discord_id: discordId, discord_username: discordName, username: discordName });
    }

    // Админ dashboard руу токеныг URL fragment-аар буцаана. Fragment сервер рүү
    // илгээгддэггүй тул access log-д ордоггүй; browser талд localStorage-д хадгална.
    if (isAdminFlow) {
      return res.redirect(`/admin#token=${jwtToken}`);
    }

    if (qrState) {
      pendingTokens.set(qrState, jwtToken);
      // Client 10 минут polling хийдэг — TTL-ийг үүнтэй ижил байлгана
      setTimeout(() => pendingTokens.delete(qrState), 10 * 60 * 1000);
      return res.send(`<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Нэвтрэлт амжилттай</title>
<style>body{font-family:sans-serif;background:#0d0d1a;color:#e0e0e0;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:12px;text-align:center;padding:20px}h2{color:#43b581}p{color:#a0a0b0}</style>
</head><body><div style="font-size:48px">✅</div><h2>Нэвтрэлт амжилттай!</h2><p>Компьютер дээрх апп руугаа буцна уу — хэдхэн секундэд автоматаар нэвтэрнэ.</p></body></html>`);
    }

    return res.redirect(`garenamn://auth?token=${jwtToken}`);
  } catch (err) {
    console.error('Discord auth error:', err.response?.data || err.message);
    return res.status(500).send('Authentication failed');
  }
});

router.get('/poll/:sessionId', (req, res) => {
  const token = pendingTokens.get(req.params.sessionId);
  if (token) {
    pendingTokens.delete(req.params.sessionId);
    return res.json({ token });
  }
  return res.json({ token: null });
});

router.put('/password', authMW, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  if (await dbOk()) {
    try {
      const result = await db.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
      const user = result.rows[0];
      if (!user || !user.password_hash) {
        return res.status(400).json({ error: 'Password login is not configured for this account' });
      }

      const ok = await bcrypt.compare(oldPassword, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

      const newHash = await bcrypt.hash(newPassword, 10);
      await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, req.user.id]);
      return res.json({ ok: true });
    } catch (e) {
      console.error(e);
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const user = memFindById(req.user.id);
  if (!user || !user.password_hash) {
    return res.status(400).json({ error: 'Password login is not configured for this account' });
  }

  const ok = await bcrypt.compare(oldPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Current password is incorrect' });

  user.password_hash = await bcrypt.hash(newPassword, 10);
  return res.json({ ok: true });
});

router.put('/avatar', authMW, async (req, res) => {
  const { avatar_url: avatarUrl } = req.body;
  if (!avatarUrl) return res.status(400).json({ error: 'avatar_url is required' });
  if (!avatarUrl.startsWith('data:image/') && !avatarUrl.startsWith('https://')) {
    return res.status(400).json({ error: 'Unsupported avatar format' });
  }
  // Хөдөлгөөнт GIF аватар — зөвхөн GOLD гишүүн
  if (/^data:image\/gif/i.test(avatarUrl) || /\.gif(\?|$)/i.test(avatarUrl)) {
    const { tierOf, perksOf } = require('./membership');
    const tier = await tierOf(req.user.id);
    if (!perksOf(tier).gifAvatar) {
      return res.status(403).json({ error: 'Хөдөлгөөнт GIF аватар зөвхөн GOLD гишүүнд нээлттэй', code: 'TIER_REQUIRED' });
    }
  }

  if (await dbOk()) {
    try {
      await db.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.user.id]);
      const updated = { ...req.user, avatar_url: avatarUrl };
      return res.json({ ok: true, avatar_url: avatarUrl, token: makeJWT(updated) });
    } catch (e) {
      console.error(e);
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const user = memFindById(req.user.id);
  if (user) user.avatar_url = avatarUrl;
  const updated = { ...req.user, avatar_url: avatarUrl };
  return res.json({ ok: true, avatar_url: avatarUrl, token: makeJWT(updated) });
});

router.post('/forgot-password', async (req, res) => {
  const email = (req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!await dbOk()) return requireOperationalDb(res);

  try {
    const user = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (!user.rows[0]) return res.json({ ok: true });

    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    await db.query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.rows[0].id, tokenHash, expiresAt]
    );

    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Auth] Password reset token for ${email}: ${token}`);
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.post('/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  if (!await dbOk()) return requireOperationalDb(res);

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const result = await db.query(
      'SELECT * FROM password_resets WHERE token = $1 AND used = FALSE AND expires_at > NOW()',
      [tokenHash]
    );
    if (!result.rows[0]) {
      return res.status(400).json({ error: 'Token is invalid or expired' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, result.rows[0].user_id]);
    await db.query('UPDATE password_resets SET used = TRUE WHERE id = $1', [result.rows[0].id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.put('/username', authMW, async (req, res) => {
  const { username } = req.body;
  if (!username || username.trim().length < 2 || username.trim().length > 20) {
    return res.status(400).json({ error: 'Username must be 2-20 characters' });
  }

  const clean = username.trim();
  if (await dbOk()) {
    try {
      const current = await db.query('SELECT discord_id FROM users WHERE id = $1', [req.user.id]);
      if (current.rows[0]?.discord_id) {
        return res.status(400).json({ error: 'Discord nickname-ийг апп дотор засах боломжгүй' });
      }

      await db.query('UPDATE users SET username = $1 WHERE id = $2', [clean, req.user.id]);
      return res.json({ ok: true, token: makeJWT({ ...req.user, username: clean }), username: clean });
    } catch (e) {
      console.error(e);
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const user = memFindById(req.user.id);
  if (user?.discord_id) {
    return res.status(400).json({ error: 'Discord nickname-ийг апп дотор засах боломжгүй' });
  }
  if (user) user.username = clean;
  return res.json({ ok: true, token: makeJWT({ ...req.user, username: clean }), username: clean });
});

router.put('/unlink-discord', authMW, async (req, res) => {
  if (!await dbOk()) return requireOperationalDb(res);

  try {
    const user = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    if (!user.rows[0]?.password_hash) {
      return res.status(400).json({ error: 'Set a password before unlinking Discord' });
    }

    await db.query('UPDATE users SET discord_id = NULL, discord_username = NULL WHERE id = $1', [req.user.id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Server error' });
  }
});

router.get('/me', authMW, async (req, res) => {
  if (await dbOk()) {
    try {
      const result = await db.query(
        'SELECT id, username, email, discord_id, discord_username, avatar_url, (COALESCE(wins,0)+COALESCE(platform_wins,0)) AS wins, (COALESCE(losses,0)+COALESCE(platform_losses,0)) AS losses, membership, membership_until, name_effect, diamonds, xp, level, block_games, block_wins, tierbot_tier, tierbot_rank FROM users WHERE id = $1',
        [req.user.id]
      );
      if (result.rows[0]) {
        const { effectiveTier, publicFx } = require('./membership');
        const { levelProgress } = require('../services/progression');
        const adminMW = require('../middleware/admin');
        const row = result.rows[0];
        const isOwner = adminMW.isOwnerUser(req.user);
        const isAdmin = isOwner || await adminMW.isAdminDiscordId(req.user.discord_id);
        return res.json({
          ...row, tier: effectiveTier(row), name_effect: publicFx(row).name_effect,
          diamonds: row.diamonds || 0, ...levelProgress(row.xp || 0),
          block_games: row.block_games || 0, block_wins: row.block_wins || 0,
          is_owner: isOwner, is_admin: isAdmin, unlimited_diamonds: isOwner,
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  if (!allowInMemoryFallback) return requireOperationalDb(res);
  const user = memFindById(req.user.id);
  return res.json(user
    ? {
        id: user.id,
        username: user.username,
        email: user.email,
        discord_id: user.discord_id,
        discord_username: user.discord_username,
        avatar_url: user.avatar_url,
        wins: user.wins || 0,
        losses: user.losses || 0,
      }
    : req.user);
});

module.exports = router;
