const { verifySession } = require('../config/jwt');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  let token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token && req.query) {
    token = req.query.token || req.query.auth || null;
  }
  if (!token) return res.status(401).json({ error: 'Authentication required.' });

  try {
    req.user = verifySession(token); // { sub: id, role }
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
