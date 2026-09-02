const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV !== 'production';

// Tighter limiter for auth + clock-in endpoints — these are the fraud surface.
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  message: { error: 'Too many attempts. Please wait a moment and try again.' },
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: isDev ? 300 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
});

module.exports = { authLimiter, generalLimiter };
