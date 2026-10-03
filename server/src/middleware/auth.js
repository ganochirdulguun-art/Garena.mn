const jwt = require('jsonwebtoken');

const allowDevFallback = process.env.NODE_ENV !== 'production';

// Устгагдсан хэрэглэгчид (admin DELETE /api/users/:id) — JWT 7 хоног хүчинтэй хэвээр байдаг байв (аудит 2026-10-02)
const revokedUsers = new Set();
function revokeUser(id) { if (id != null) revokedUsers.add(String(id)); }
function isRevoked(id) { return id != null && revokedUsers.has(String(id)); }

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token required' });
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    if (isRevoked(req.user?.id)) return res.status(403).json({ error: 'Invalid or expired token' });
    next();
  } catch {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      req.user = allowDevFallback ? { id: 0, discord_id: null, username: 'Guest' } : null;
    }
  } else {
    req.user = allowDevFallback ? { id: 0, discord_id: null, username: 'Guest' } : null;
  }

  next();
}

module.exports = authMiddleware;
module.exports.optional = optionalAuth;
module.exports.revokeUser = revokeUser;
module.exports.isRevoked = isRevoked;
