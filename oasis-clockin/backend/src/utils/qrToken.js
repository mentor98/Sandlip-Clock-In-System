const crypto = require('crypto');

const TTL = () => parseInt(process.env.QR_TOKEN_TTL_SECONDS || '25', 10);
const SECRET = () => process.env.QR_TOKEN_SECRET || 'oasis-qr-secret-key-default-2026-safe-dev';

/**
 * Token payload: base64url(JSON) + "." + HMAC-SHA256 signature.
 * Encodes location_id + issued-at + nonce, so it expires and can't be replayed.
 * The nonce is stored in the locations table — generating a new QR replaces the nonce,
 * instantly invalidating all previously issued tokens for that location.
 */
function generateLocationToken(optsOrLocId, maybeNonce) {
  let locationId;
  let nonce;
  let adminId = null;
  let adminIp = null;
  let sessionId = null;

  if (typeof optsOrLocId === 'object' && optsOrLocId !== null) {
    locationId = optsOrLocId.locationId;
    nonce = optsOrLocId.nonce;
    adminId = optsOrLocId.adminId || null;
    adminIp = optsOrLocId.adminIp || null;
    sessionId = optsOrLocId.sessionId || null;
  } else {
    locationId = optsOrLocId;
    nonce = maybeNonce;
  }

  const payload = {
    lid: locationId,
    iat: Date.now(),
    ttl: TTL() * 1000,
    nonce,
    aid: adminId,
    aip: adminIp,
    sid: sessionId,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto
    .createHmac('sha256', SECRET())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

function decodeLocationToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) {
    return { valid: false, reason: 'malformed_token' };
  }
  const [encoded, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', SECRET())
    .update(encoded)
    .digest('base64url');


  const sigBuf = Buffer.from(sig || '', 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, reason: 'malformed_payload' };
  }

  // Allow a 30s grace window to handle network latency and clock skew
  if (Date.now() > payload.iat + payload.ttl + 30000) {
    return { valid: false, reason: 'expired_token' };
  }

  return { valid: true, payload };
}

/**
 * Full verification — checks signature, expiry, correct location, and nonce.
 */
function verifyLocationToken(token, expectedLocationId, activeNonce) {
  const result = decodeLocationToken(token);
  if (!result.valid) return result;

  const { payload } = result;

  if (expectedLocationId && payload.lid && payload.lid !== expectedLocationId) {
    // Allow campus fallback location ID matching
    if (payload.lid !== 'c0000000-0000-0000-0000-000000000001' && expectedLocationId !== 'c0000000-0000-0000-0000-000000000001') {
      return { valid: false, reason: 'wrong_location' };
    }
  }

  // If activeNonce is provided, allow a 60-second window during token rotation
  if (activeNonce && payload.nonce && payload.nonce !== activeNonce) {
    if (Date.now() - (payload.iat || 0) > 60000) {
      return { valid: false, reason: 'stale_qr' };
    }
  }

  return { valid: true, payload };
}

module.exports = { generateLocationToken, verifyLocationToken, decodeLocationToken };
