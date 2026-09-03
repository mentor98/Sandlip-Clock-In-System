const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'oasis-jwt-secret-key-default-2026-safe-dev';

function signSession({ studentId, role }) {
  return jwt.sign({ sub: studentId, role }, JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRY || '7d',
  });
}

function verifySession(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { signSession, verifySession };

