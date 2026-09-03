const rateLimit = require('express-rate-limit');

// High capacity limiter for auth + clock-in endpoints suitable for campus-wide concurrency
const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 2000, // Up to 2,000 requests per minute across campus
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  skip: (req) => req.path.includes('/stream') || req.method === 'OPTIONS',
  message: { error: 'Too many attempts. Please wait a moment and try again.' },
});

// General limiter for admin dashboard querying and realtime sync
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8000, // Up to 8,000 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  validate: { trustProxy: false },
  skip: (req) => req.path.includes('/stream') || req.path === '/api/health' || req.method === 'OPTIONS',
});

module.exports = { authLimiter, generalLimiter };

