/**
 * Check whether an IP address falls within any of the given CIDR ranges.
 * Supports IPv4 only (covers all realistic office/campus scenarios).
 * Returns true (match), false (no match), or null (invalid input).
 */

function ipToInt(ip) {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (isNaN(n) || n < 0 || n > 255) return null;
    result = (result << 8) + n;
  }
  return result >>> 0;
}

function cidrMatch(ip, cidr) {
  // If it's just an IP (no slash), treat as /32
  const [range, bits = '32'] = cidr.split('/');
  const mask = bits === '0' ? 0 : (~0 << (32 - parseInt(bits, 10))) >>> 0;
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  return (ipInt & mask) === (rangeInt & mask);
}

/**
 * @param {string} ip - client IP
 * @param {string[]} cidrs - array of CIDR strings e.g. ['197.210.65.0/24', '41.58.22.5']
 * @returns {boolean}
 */
function ipRangeCheck(ip, cidrs) {
  if (!ip || !cidrs || cidrs.length === 0) return false;
  // Strip IPv6 prefix if present (e.g. ::ffff:192.168.1.1)
  const cleanIp = ip.replace(/^::ffff:/, '');
  return cidrs.some(cidr => cidrMatch(cleanIp, cidr));
}

module.exports = ipRangeCheck;
