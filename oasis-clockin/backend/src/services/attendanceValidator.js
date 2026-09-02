/**
 * Central Attendance Validation Engine
 * ─────────────────────────────────────
 * Single source of truth for every attendance decision.
 * The student PWA sends GPS coordinates, device identifier, and optional QR token.
 * This service independently validates all signals server-side.
 *
 * Trust score weights (total = 100):
 *   Authentication        10
 *   Authorized Device     20
 *   Device Active         10
 *   Approved Network      20
 *   GPS present           10
 *   Inside Geofence       15
 *   Valid QR (if req.)    10
 *   Active Session         5
 *
 * Thresholds:
 *   90-100  → VERIFIED
 *   70-89   → REVIEW
 *   50-69   → SUSPICIOUS
 *   <50     → REJECTED
 *
 * CRITICAL FAILURES always override score and force REJECTED:
 *   - Student not found or account suspended
 *   - Device REVOKED or BLOCKED
 *   - Device not authorized (PENDING) when org requires device authorization
 *   - Outside geofence radius
 *   - Invalid, expired, stale, or reused QR token
 *   - Duplicate attendance record for today
 *   - No active session when org requires session
 */

const { supabaseAdmin } = require('../config/supabase');
const { haversineDistanceMeters } = require('../utils/geofence');
const { verifyLocationToken } = require('../utils/qrToken');
const ipRangeCheck = require('../utils/ipRangeCheck');

const WEIGHTS = {
  authentication:   10,
  authorizedDevice: 20,
  deviceActive:     10,
  approvedNetwork:  20,
  gpsPresent:       10,
  insideGeofence:   15,
  validQr:          10,
  activeSession:     5,
};

/**
 * Main validation entry point.
 * @param {object} params
 * @param {string} params.studentId   - UUID from JWT
 * @param {string} params.deviceId    - UUID or device identity
 * @param {number} params.latitude
 * @param {number} params.longitude
 * @param {number} [params.accuracy]  - GPS accuracy in metres
 * @param {string} [params.locationId]   - from QR scan or session
 * @param {string} [params.locationToken] - from QR scan
 * @param {string} [params.clientIp]  - req.ip
 * @param {string} [params.attendanceType] - 'clock_in' | 'clock_out'
 */
async function validateAttendance(params) {
  const {
    studentId, deviceId,
    latitude, longitude, accuracy,
    locationId, locationToken,
    clientIp,
    attendanceType = 'clock_in',
  } = params;

  const checks = {
    authentication: false,
    authorizedDevice: false,
    deviceActive: false,
    approvedNetwork: false,
    gpsPresent: false,
    insideGeofence: false,
    validQr: false,
    activeSession: false,
    duplicate: false,
  };

  const details = {};
  const criticalFailures = [];
  const securityAnomalies = [];

  // ── 1. Student account verification ─────────────────────────────────────────
  const { data: student } = await supabaseAdmin
    .from('students')
    .select('id, full_name, student_id, email, status')
    .eq('id', studentId)
    .single();

  if (!student) {
    criticalFailures.push('Student account not found.');
    securityAnomalies.push({ type: 'ACCOUNT_NOT_FOUND', severity: 'HIGH' });
  } else if (student.status && student.status === 'suspended') {
    criticalFailures.push(`Student account is currently suspended.`);
    securityAnomalies.push({ type: 'ACCOUNT_SUSPENDED', severity: 'HIGH', status: student.status });
  } else {
    checks.authentication = true;
    details.student = { name: student.full_name, id: student.student_id };
  }

  // ── Clock-out constraints (must have clocked in today + must be 5:00 PM / 17:00 or later) ──
  if (attendanceType === 'clock_out' && checks.authentication) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: clockInRecords } = await supabaseAdmin
      .from('attendance')
      .select('id, recorded_at')
      .eq('student_id', studentId)
      .eq('type', 'clock_in')
      .gte('recorded_at', today)
      .limit(1);

    if (!clockInRecords || clockInRecords.length === 0) {
      criticalFailures.push('You must clock in first before you can clock out.');
      securityAnomalies.push({ type: 'CLOCK_OUT_WITHOUT_CLOCK_IN', severity: 'HIGH' });
    }

    const currentHour = new Date().getHours();
    if (currentHour < 17) {
      criticalFailures.push('Clock-out is only permitted starting at 5:00 PM (17:00).');
      securityAnomalies.push({ type: 'EARLY_CLOCK_OUT_ATTEMPT', severity: 'MEDIUM', currentHour });
    }
  }

  // ── 2. Organization configuration ──────────────────────────────────────────
  const { data: org } = await supabaseAdmin
    .from('organization_config')
    .select('*')
    .eq('id', 'default')
    .single();

  // ── 3. Device verification ──────────────────────────────────────────────────
  const { data: device } = await supabaseAdmin
    .from('devices')
    .select('id, student_id, status, revoked_at, ip_address, user_agent, last_seen_at')
    .eq('id', deviceId)
    .single();

  if (!device || device.student_id !== studentId) {
    criticalFailures.push('Unrecognized device or device is not bound to this student account.');
    securityAnomalies.push({ type: 'DEVICE_UNBOUND', severity: 'HIGH', deviceId });
  } else if (device.status === 'REVOKED' || device.status === 'BLOCKED' || device.revoked_at) {
    criticalFailures.push(`This device has been ${device.status || 'revoked'} by an administrator.`);
    securityAnomalies.push({ type: 'REVOKED_DEVICE_ATTEMPT', severity: 'CRITICAL', deviceStatus: device.status });
  } else if (device.status === 'AUTHORIZED') {
    checks.authorizedDevice = true;
    checks.deviceActive = true;
    details.device = { status: 'AUTHORIZED', userAgent: device.user_agent };
  } else if (device.status === 'PENDING') {
    if (org?.require_device_auth !== false) {
      criticalFailures.push('Your device is pending administrator authorization. Please contact an admin.');
      securityAnomalies.push({ type: 'PENDING_DEVICE_ATTEMPT', severity: 'MEDIUM' });
    } else {
      checks.authorizedDevice = false;
      checks.deviceActive = true;
      details.deviceWarning = 'Device not yet authorized by admin.';
    }
  }

  // Update device last_seen_at & IP
  if (device) {
    await supabaseAdmin
      .from('devices')
      .update({
        last_seen_at: new Date().toISOString(),
        ip_address: clientIp || device.ip_address,
      })
      .eq('id', device.id);
  }

  // ── 4. Approved Network / IP verification ───────────────────────────────────
  const { data: networks } = await supabaseAdmin
    .from('approved_networks')
    .select('cidr, label');

  const approvedCidrs = (networks || []).map(n => n.cidr);
  const ipMatch = clientIp && approvedCidrs.length > 0
    ? ipRangeCheck(clientIp, approvedCidrs)
    : null;

  details.clientIp = clientIp;
  details.ipMatch = ipMatch;

  if (ipMatch === true) {
    checks.approvedNetwork = true;
  } else if (ipMatch === null) {
    // No networks configured in system — pass with neutral note
    checks.approvedNetwork = true;
    details.networkNote = 'No approved campus networks configured — check skipped.';
  } else {
    // IP mismatch
    checks.approvedNetwork = false;
    details.networkNote = `IP ${clientIp} is outside approved campus networks.`;
    securityAnomalies.push({ type: 'NETWORK_MISMATCH', severity: 'MEDIUM', clientIp });

    if (org?.ip_check_mode === 'strict') {
      criticalFailures.push(`Your network connection (${clientIp}) is not within the approved campus network.`);
    }
  }

  // ── 5. Active attendance session ───────────────────────────────────────────
  const { data: activeSession } = await supabaseAdmin
    .from('attendance_sessions')
    .select('id, title, location_id, started_at, ends_at')
    .eq('status', 'ACTIVE')
    .lte('started_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (activeSession) {
    if (activeSession.ends_at && new Date(activeSession.ends_at) < new Date()) {
      await supabaseAdmin
        .from('attendance_sessions')
        .update({ status: 'EXPIRED', closed_at: new Date().toISOString() })
        .eq('id', activeSession.id);
      details.session = null;
    } else {
      checks.activeSession = true;
      details.session = activeSession;
    }
  } else {
    details.session = null;
  }

  // ── 6. GPS & Geofence proximity verification ────────────────────────────────
  if (latitude != null && longitude != null) {
    checks.gpsPresent = true;
    details.gps = { latitude, longitude, accuracy: accuracy || null };
  } else if (org?.require_gps !== false) {
    criticalFailures.push('GPS location coordinates are required for attendance.');
    securityAnomalies.push({ type: 'MISSING_GPS', severity: 'HIGH' });
  }

  // Determine target location (from QR, active session, or nearest geofence)
  let targetLocation = null;

  if (locationId) {
    const { data: loc } = await supabaseAdmin
      .from('locations')
      .select('*')
      .eq('id', locationId)
      .single();
    targetLocation = loc;
  } else if (activeSession?.location_id) {
    const { data: loc } = await supabaseAdmin
      .from('locations')
      .select('*')
      .eq('id', activeSession.location_id)
      .single();
    targetLocation = loc;
  } else {
    const { data: allLocations } = await supabaseAdmin.from('locations').select('*');
    if (allLocations && allLocations.length > 0 && latitude != null) {
      let nearest = null;
      let nearestDist = Infinity;
      for (const loc of allLocations) {
        const dist = haversineDistanceMeters(latitude, longitude, loc.latitude, loc.longitude);
        if (dist < nearestDist) { nearestDist = dist; nearest = loc; }
      }
      targetLocation = nearest;
      details.nearestLocationDistance = nearestDist;
    }
  }

  if (targetLocation && latitude != null && longitude != null) {
    const distanceM = haversineDistanceMeters(latitude, longitude, targetLocation.latitude, targetLocation.longitude);
    const radiusM = targetLocation.geofence_radius_m || 50;
    details.location = {
      id: targetLocation.id,
      name: targetLocation.name,
      distanceM: Math.round(distanceM),
      radiusM,
    };

    if (distanceM <= radiusM) {
      checks.insideGeofence = true;
    } else {
      checks.insideGeofence = false;
      const roundedDist = Math.round(distanceM);
      criticalFailures.push(`You are ${roundedDist}m away from ${targetLocation.name}. You must be within ${radiusM}m.`);
      securityAnomalies.push({
        type: 'OUTSIDE_GEOFENCE',
        severity: 'HIGH',
        distanceM: roundedDist,
        allowedRadiusM: radiusM,
        locationName: targetLocation.name,
      });
    }

    // Active operating hours check
    if (targetLocation.active_start && targetLocation.active_end) {
      const nowStr = new Date().toTimeString().slice(0, 8);
      if (nowStr < targetLocation.active_start || nowStr > targetLocation.active_end) {
        criticalFailures.push(`Attendance at ${targetLocation.name} is only permitted between ${targetLocation.active_start} and ${targetLocation.active_end}.`);
        securityAnomalies.push({ type: 'OUTSIDE_OPERATING_HOURS', severity: 'MEDIUM' });
      }
    }
  } else if (checks.gpsPresent && !targetLocation) {
    criticalFailures.push('No active attendance location found nearby.');
  }

  // ── 7. Dynamic QR token verification ─────────────────────────────────────────
  if (locationToken && locationId) {
    const { data: locForNonce } = await supabaseAdmin
      .from('locations')
      .select('active_qr_nonce')
      .eq('id', locationId)
      .single();

    const qrCheck = verifyLocationToken(locationToken, locationId, locForNonce?.active_qr_nonce);
    if (qrCheck.valid) {
      checks.validQr = true;
      details.qrVerified = true;
    } else {
      const msg = qrCheck.reason === 'stale_qr'
        ? 'This QR code has already expired or rotated. Please scan the current code on screen.'
        : 'QR code signature is invalid or expired. Please scan a fresh QR code.';
      criticalFailures.push(msg);
      securityAnomalies.push({
        type: qrCheck.reason === 'stale_qr' ? 'STALE_QR_SCANNED' : 'INVALID_QR_SCANNED',
        severity: 'HIGH',
        reason: qrCheck.reason,
      });
    }
  } else if (org?.require_qr) {
    criticalFailures.push('A dynamic QR code scan is required to record attendance.');
    securityAnomalies.push({ type: 'MISSING_QR_SCAN', severity: 'MEDIUM' });
  } else {
    checks.validQr = true;
  }

  // ── 8. Duplicate attendance check ───────────────────────────────────────────
  if (targetLocation && checks.authentication) {
    const today = new Date().toISOString().slice(0, 10);
    const { data: existing } = await supabaseAdmin
      .from('attendance')
      .select('id, recorded_at')
      .eq('student_id', studentId)
      .eq('location_id', targetLocation.id)
      .eq('type', attendanceType)
      .gte('recorded_at', today)
      .limit(1);

    if (existing && existing.length > 0) {
      checks.duplicate = true;
      criticalFailures.push(`You have already recorded your ${attendanceType === 'clock_in' ? 'clock in' : 'clock out'} today at ${targetLocation.name}.`);
      securityAnomalies.push({ type: 'DUPLICATE_ATTENDANCE_ATTEMPT', severity: 'LOW' });
    }
  }

  // ── 9. Trust score calculation ──────────────────────────────────────────────
  let score = 0;
  if (checks.authentication)   score += WEIGHTS.authentication;
  if (checks.authorizedDevice) score += WEIGHTS.authorizedDevice;
  if (checks.deviceActive)     score += WEIGHTS.deviceActive;
  if (checks.approvedNetwork)  score += WEIGHTS.approvedNetwork;
  if (checks.gpsPresent)       score += WEIGHTS.gpsPresent;
  if (checks.insideGeofence)   score += WEIGHTS.insideGeofence;
  if (checks.validQr)          score += WEIGHTS.validQr;
  if (checks.activeSession)    score += WEIGHTS.activeSession;

  const hasCritical = criticalFailures.length > 0;

  let status;
  if (hasCritical) {
    status = 'REJECTED';
  } else if (score >= 90) {
    status = 'VERIFIED';
  } else if (score >= 70) {
    status = 'REVIEW';
  } else if (score >= 50) {
    status = 'SUSPICIOUS';
  } else {
    status = 'REJECTED';
  }

  const approved = (status === 'VERIFIED' || status === 'REVIEW') && !hasCritical;

  return {
    approved,
    status,
    riskScore: score,
    criticalFailures,
    securityAnomalies,
    checks,
    details,
    targetLocation,
    activeSession: details.session,
  };
}

module.exports = { validateAttendance };
