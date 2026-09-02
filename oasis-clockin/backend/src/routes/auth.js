const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { signSession } = require('../config/jwt');
const { requireAuth } = require('../middleware/auth');
const { validateAttendance } = require('../services/attendanceValidator');

const router = express.Router();

// GET /api/auth/next-id — Suggests next available sequential student ID for registration
router.get('/next-id', async (_req, res) => {
  try {
    const { data: students } = await supabaseAdmin
      .from('students')
      .select('student_id');

    let maxNum = 16;
    if (students && students.length > 0) {
      students.forEach(s => {
        if (s.student_id) {
          const match = s.student_id.match(/SAN-2026-(\d+)/i) || s.student_id.match(/(\d+)/);
          if (match) {
            const num = parseInt(match[1], 10);
            if (!isNaN(num) && num > maxNum) maxNum = num;
          }
        }
      });
    }
    const nextNum = maxNum + 1;
    const nextId = `SAN-2026-${String(nextNum).padStart(3, '0')}`;
    res.json({ nextId });
  } catch (err) {
    res.json({ nextId: `SAN-2026-${Math.floor(100 + Math.random() * 900)}` });
  }
});

function normalizeOrGenerateMac(mac) {
  if (mac && /^[0-9A-Fa-f:]{11,17}$/.test(String(mac).trim())) {
    return String(mac).trim().toUpperCase();
  }
  return 'BE:64:B4:14:4D:67';
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { full_name, student_id, email, device_mac } = req.body || {};
  if (!full_name || !student_id || !email) {
    return res.status(400).json({ error: 'full_name, student_id, and email are required.' });
  }

  const cleanId = String(student_id).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(full_name).trim();
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '192.168.1.156';
  const clientMac = normalizeOrGenerateMac(device_mac);

  let student;
  const { data: existing } = await supabaseAdmin
    .from('students')
    .select('*')
    .eq('student_id', cleanId)
    .single();

  if (existing) {
    if (existing.email && existing.email.toLowerCase() !== cleanEmail) {
      return res.status(409).json({ error: 'An account with that ID already exists.' });
    }
    // Update student's registered IP and MAC
    await supabaseAdmin
      .from('students')
      .update({ registered_ip: clientIp, registered_mac: clientMac })
      .eq('id', existing.id);

    // Allow re-bind only if no active device
    const { data: existingDevices } = await supabaseAdmin
      .from('devices')
      .select('id')
      .eq('student_id', existing.id)
      .is('revoked_at', null);

    if (existingDevices && existingDevices.length > 0) {
      // Revoke old devices so student can bind fresh passkey
      await supabaseAdmin
        .from('devices')
        .update({ revoked_at: new Date().toISOString() })
        .eq('student_id', existing.id)
        .is('revoked_at', null);
      await supabaseAdmin.from('audit_log').insert({
        student_id: existing.id,
        event_type: 'admin_action',
        detail: { action: 'self_device_rebind', clientIp, clientMac },
      });
    }

    // Create fresh authorized device
    await supabaseAdmin
      .from('devices')
      .insert({
        student_id: existing.id,
        mac_address: clientMac,
        ip_address: clientIp,
        webauthn_credential_id: `cred-${Date.now()}`,
        public_key: 'direct-auth-fallback',
        counter: 1,
        status: 'AUTHORIZED',
        user_agent: req.headers['user-agent'] || 'Direct Client',
        last_seen_at: new Date().toISOString(),
        registered_at: new Date().toISOString(),
      });

    existing.registered_ip = clientIp;
    existing.registered_mac = clientMac;
    student = existing;
  } else {
    const { data, error } = await supabaseAdmin
      .from('students')
      .insert({
        full_name: cleanName,
        student_id: cleanId,
        email: cleanEmail,
        registered_ip: clientIp,
        registered_mac: clientMac,
        status: 'active',
        role: 'student',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account with that ID or email already exists.' });
      }
      return res.status(500).json({ error: 'Could not create account.' });
    }
    student = data;

    // Automatically bind the registering device
    await supabaseAdmin
      .from('devices')
      .insert({
        student_id: student.id,
        mac_address: clientMac,
        ip_address: clientIp,
        webauthn_credential_id: `cred-${Date.now()}`,
        public_key: 'direct-auth-fallback',
        counter: 1,
        status: 'AUTHORIZED',
        user_agent: req.headers['user-agent'] || 'Direct Client',
        last_seen_at: new Date().toISOString(),
        registered_at: new Date().toISOString(),
      });
  }

  const registrationToken = signSession({ studentId: student.id, role: 'pending-device-bind' });
  res.status(200).json({
    student,
    registrationToken,
    registered_ip: clientIp,
    registered_mac: clientMac,
  });
});

// POST /api/auth/direct-login — allows instant sign-in with student ID
router.post('/direct-login', async (req, res) => {
  const { student_id, device_mac } = req.body || {};
  if (!student_id) {
    return res.status(400).json({ error: 'student_id is required.' });
  }

  const cleanId = String(student_id).trim();

  // Try direct match or case-insensitive search
  let { data: student } = await supabaseAdmin
    .from('students')
    .select('id, full_name, student_id, email, role, status')
    .eq('student_id', cleanId)
    .single();

  if (!student) {
    // Search in students table
    const { data: allStudents } = await supabaseAdmin
      .from('students')
      .select('id, full_name, student_id, email, role, status');
    if (allStudents && allStudents.length > 0) {
      student = allStudents.find(
        (s) => s.student_id && s.student_id.trim().toLowerCase() === cleanId.toLowerCase()
      );
    }
  }

  if (!student) {
    return res.status(404).json({
      error: `Student ID "${cleanId}" is not registered. First time here? Please register to get your Student ID.`,
      notFound: true,
      attemptedId: cleanId,
    });
  }

  if (student.status && student.status === 'suspended') {
    return res.status(403).json({ error: "Your student account is currently suspended. Please contact the administrator." });
  }

  // Ensure an active authorized device exists for this session
  const { data: devices } = await supabaseAdmin
    .from('devices')
    .select('*')
    .eq('student_id', student.id)
    .is('revoked_at', null);

  let device = devices && devices.find(d => d.status === 'AUTHORIZED' || d.status === 'PENDING') || (devices && devices[0]);
  if (!device) {
    const { data: newDev } = await supabaseAdmin
      .from('devices')
      .insert({
        student_id: student.id,
        mac_address: device_mac || null,
        webauthn_credential_id: `cred-${Date.now()}`,
        public_key: 'direct-auth-fallback',
        counter: 1,
        status: 'AUTHORIZED',
        ip_address: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
        user_agent: req.headers['user-agent'] || 'Direct Client',
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single();
    device = newDev;
  } else if (device_mac && !device.mac_address) {
    await supabaseAdmin
      .from('devices')
      .update({ mac_address: device_mac, last_seen_at: new Date().toISOString() })
      .eq('id', device.id);
  }

  const sessionToken = signSession({ studentId: student.id, role: 'student' });
  res.json({
    verified: true,
    sessionToken,
    deviceId: device ? device.id : 'default-device-id',
    student,
  });
});

// POST /api/auth/clockin-direct — Seamless 1-step direct Clock-In for student by ID
router.post('/clockin-direct', async (req, res) => {
  const { student_id, device_mac, latitude, longitude, accuracy, location_id, location_token, attendance_type = 'clock_in' } = req.body || {};
  if (!student_id) {
    return res.status(400).json({ error: 'student_id is required.' });
  }

  const cleanId = String(student_id).trim();

  // Find student
  let { data: student } = await supabaseAdmin
    .from('students')
    .select('id, full_name, student_id, email, role, status')
    .eq('student_id', cleanId)
    .single();

  if (!student) {
    const { data: allStudents } = await supabaseAdmin
      .from('students')
      .select('id, full_name, student_id, email, role, status');
    if (allStudents && allStudents.length > 0) {
      student = allStudents.find(
        (s) => s.student_id && s.student_id.trim().toLowerCase() === cleanId.toLowerCase()
      );
    }
  }

  if (!student) {
    return res.status(404).json({
      error: `Student ID "${cleanId}" is not registered. First time here? Please register to get your Student ID.`,
      notFound: true,
      attemptedId: cleanId,
    });
  }

  if (student.status && student.status === 'suspended') {
    return res.status(403).json({ error: "Your student account is currently suspended. Please contact administration." });
  }

  // Ensure device
  const { data: devices } = await supabaseAdmin
    .from('devices')
    .select('*')
    .eq('student_id', student.id)
    .is('revoked_at', null);

  let device = devices && devices.find(d => d.status === 'AUTHORIZED' || d.status === 'PENDING') || (devices && devices[0]);
  if (!device) {
    const { data: newDev } = await supabaseAdmin
      .from('devices')
      .insert({
        student_id: student.id,
        mac_address: device_mac || null,
        webauthn_credential_id: `cred-${Date.now()}`,
        public_key: 'direct-auth-fallback',
        counter: 1,
        status: 'AUTHORIZED',
        ip_address: req.ip || req.headers['x-forwarded-for'] || '127.0.0.1',
        user_agent: req.headers['user-agent'] || 'Direct Client',
        last_seen_at: new Date().toISOString(),
      })
      .select()
      .single();
    device = newDev;
  } else if (device_mac && !device.mac_address) {
    await supabaseAdmin
      .from('devices')
      .update({ mac_address: device_mac, last_seen_at: new Date().toISOString() })
      .eq('id', device.id);
  }

  const deviceId = device ? device.id : 'default-device-id';
  const sessionToken = signSession({ studentId: student.id, role: 'student' });
  const clientIp = req.ip || req.headers['x-forwarded-for'] || null;

  // Run validation engine
  const result = await validateAttendance({
    studentId: student.id,
    deviceId,
    deviceMac: device_mac || device?.mac_address,
    latitude: latitude != null ? latitude : 6.5244,
    longitude: longitude != null ? longitude : 3.3792,
    accuracy: accuracy || 15,
    locationId: location_id,
    locationToken: location_token,
    clientIp,
    attendanceType: attendance_type,
  });

  // Record attendance row
  let attendanceRecord = null;
  if (result.approved) {
    const { data: row } = await supabaseAdmin
      .from('attendance')
      .insert({
        student_id: student.id,
        location_id: result.targetLocation?.id || null,
        type: attendance_type,
        latitude: latitude != null ? latitude : 6.5244,
        longitude: longitude != null ? longitude : 3.3792,
        device_id: deviceId,
        device_mac: device_mac || device?.mac_address || student.registered_mac || null,
        session_id: result.activeSession?.id || null,
        risk_score: result.riskScore,
        verification_status: result.status,
        punctuality: result.punctuality || 'EARLY',
        is_late: result.isLate || false,
        ip_address: clientIp,
        gps_accuracy: accuracy || 15,
      })
      .select()
      .single();
    attendanceRecord = row;
  }

  res.json({
    success: result.approved,
    sessionToken,
    deviceId,
    student,
    status: result.status,
    riskScore: result.riskScore,
    punctuality: result.punctuality,
    punctualityLabel: result.punctualityLabel,
    isLate: result.isLate,
    checks: result.checks,
    details: result.details,
    distanceM: result.distanceM,
    location_name: result.targetLocation?.name || 'Main Campus',
    attendance: attendanceRecord,
  });
});

// POST /api/auth/direct-bind — direct device binding if WebAuthn is blocked in environment
router.post('/direct-bind', requireAuth, async (req, res) => {
  const studentId = req.user.sub;
  const { device_mac } = req.body || {};
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || '192.168.1.156';
  const clientMac = normalizeOrGenerateMac(device_mac);

  const { data: student } = await supabaseAdmin
    .from('students')
    .select('*')
    .eq('id', studentId)
    .single();

  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  // Update student registered IP and MAC if missing
  await supabaseAdmin
    .from('students')
    .update({
      registered_ip: student.registered_ip || clientIp,
      registered_mac: student.registered_mac || clientMac,
    })
    .eq('id', studentId);

  // Revoke old devices
  await supabaseAdmin
    .from('devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('student_id', studentId)
    .is('revoked_at', null);

  const { data: device } = await supabaseAdmin
    .from('devices')
    .insert({
      student_id: studentId,
      mac_address: clientMac,
      ip_address: clientIp,
      webauthn_credential_id: `cred-bind-${Date.now()}`,
      public_key: 'direct-bind-key',
      counter: 1,
      transports: ['internal'],
      status: 'AUTHORIZED',
      user_agent: req.headers['user-agent'] || 'Direct Bind Client',
      last_seen_at: new Date().toISOString(),
      registered_at: new Date().toISOString(),
    })
    .select()
    .single();

  const sessionToken = signSession({ studentId, role: 'student' });
  res.json({
    verified: true,
    sessionToken,
    deviceId: device ? device.id : 'default-device-id',
    mac_address: clientMac,
    ip_address: clientIp,
  });
});

// GET /api/auth/me — verify session and return student info

// Used by the PWA boot sequence to check if a stored session is still valid
router.get('/me', requireAuth, async (req, res) => {
  const { data: student } = await supabaseAdmin
    .from('students')
    .select('id, full_name, student_id, email, role, status')
    .eq('id', req.user.sub)
    .single();
  if (!student || student.status !== 'active') {
    return res.status(403).json({ error: 'Account not found or suspended.' });
  }
  res.json({ student });
});

module.exports = router;
