const crypto = require('crypto');

const TTL = () => parseInt(process.env.QR_TOKEN_TTL_SECONDS || '25', 10);
const SECRET = () => process.env.QR_TOKEN_SECRET || 'oasis-qr-secret-key-default-2026-safe-dev';

/**
 * Token payload: base64url(JSON) + "." + HMAC-SHA256 signature.
 * Encodes location_id + issued-at + nonce, so it expires and can't be replayed.
 * The nonce is stored in the locations table — generating a new QR replaces the nonce,
 * instantly invalidating all previously issued tokens for that location.
 */
function generateLocationToken(locationId, nonce) {
  const payload = {
    lid: locationId,
    iat: Date.now(),
    ttl: TTL() * 1000,
    nonce,
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

  if (Date.now() > payload.iat + payload.ttl) {
    return { valid: false, reason: 'expired_token' };
  }

  return { valid: true, payload };
}

/**
 * Full verification — checks signature, expiry, correct location, and that the
 * nonce matches the one currently stored in the DB (so old QRs are instantly invalid).
 */
function verifyLocationToken(token, expectedLocationId, activeNonce) {
  const result = decodeLocationToken(token);
  if (!result.valid) return result;

  const { payload } = result;

  if (payload.lid !== expectedLocationId) {
    return { valid: false, reason: 'wrong_location' };
  }

  // If activeNonce is provided, the token's nonce must match — this invalidates old QRs
  if (activeNonce && payload.nonce !== activeNonce) {
    return { valid: false, reason: 'stale_qr' };
  }

  return { valid: true, payload };
}

module.exports = { generateLocationToken, verifyLocationToken, decodeLocationToken };
