const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { signSession } = require('../config/jwt');
const { requireAuth } = require('../middleware/auth');
const { validateAttendance, validateAndRecordAttendance, registerStudentScanned } = require('../services/attendanceValidator');
const eventBus = require('../utils/eventBus');

const router = express.Router();

// GET /api/auth/verify-student?id=SAN-2026-014 — Look up and verify student in database
router.get('/verify-student', async (req, res) => {
  try {
    const rawId = (req.query.id || req.query.student_id || '').trim();
    if (!rawId) {
      return res.status(400).json({ exists: false, error: 'Student ID is required.' });
    }

    // Direct lookup in DB
    let student = null;
    const { data: bySid } = await supabaseAdmin
      .from('students')
      .select('id, full_name, student_id, email, status')
      .eq('student_id', rawId)
      .maybeSingle();

    if (bySid) {
      student = bySid;
    } else {
      const { data: byId } = await supabaseAdmin
        .from('students')
        .select('id, full_name, student_id, email, status')
        .eq('id', rawId)
        .maybeSingle();
      if (byId) student = byId;
    }

    if (!student) {
      // Case-insensitive fallback
      const { data: allStudents } = await supabaseAdmin
        .from('students')
        .select('id, full_name, student_id, email, status');
      if (allStudents) {
        student = allStudents.find(s =>
          (s.student_id && s.student_id.toLowerCase() === rawId.toLowerCase()) ||
          (s.id && s.id.toLowerCase() === rawId.toLowerCase())
        ) || null;
      }
    }

    if (!student) {
      return res.status(404).json({
        exists: false,
        error: `Student ID "${rawId}" not found in database. Please verify your Matric ID.`,
      });
    }

    res.json({
      exists: true,
      student: {
        id: student.id,
        student_id: student.student_id,
        full_name: student.full_name,
        email: student.email,
        status: student.status || 'active',
      },
    });
  } catch (err) {
    console.error('Verify student error:', err);
    res.status(500).json({ exists: false, error: 'Server error checking student.' });
  }
});

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
    try {
      const devRes = await supabaseAdmin
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
      if (devRes && devRes.error) {
        await supabaseAdmin
          .from('devices')
          .insert({
            student_id: existing.id,
            webauthn_credential_id: `cred-${Date.now()}`,
            public_key: 'direct-auth-fallback',
            counter: 1,
            registered_at: new Date().toISOString(),
          });
      }
    } catch (_) {}

    existing.registered_ip = clientIp;
    existing.registered_mac = clientMac;
    student = existing;
  } else {
    let insertPayload = {
      full_name: cleanName,
      student_id: cleanId,
      email: cleanEmail,
      registered_ip: clientIp,
      registered_mac: clientMac,
      status: 'active',
      role: 'student',
    };
    let { data, error } = await supabaseAdmin
      .from('students')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account with that ID or email already exists.' });
      }
      console.warn('Initial student insert notice, retrying with core fields:', error.message || error);
      const fallbackPayload = {
        full_name: cleanName,
        student_id: cleanId,
        email: cleanEmail,
        status: 'active',
        role: 'student',
      };
      const retry = await supabaseAdmin
        .from('students')
        .insert(fallbackPayload)
        .select()
        .single();

      if (retry.error) {
        console.error('Final student insert failed:', retry.error);
        if (retry.error.code === '23505') {
          return res.status(409).json({ error: 'An account with that ID or email already exists.' });
        }
        return res.status(500).json({ error: 'Could not create account: ' + (retry.error.message || 'Database error') });
      }
      data = retry.data;
    }
    student = data;

    // Automatically bind the registering device
    try {
      const devRes = await supabaseAdmin
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
      if (devRes && devRes.error) {
        console.warn('Initial device insert notice, retrying with core columns:', devRes.error.message || devRes.error);
        const retry1 = await supabaseAdmin
          .from('devices')
          .insert({
            student_id: student.id,
            ip_address: clientIp,
            webauthn_credential_id: `cred-${Date.now()}`,
            public_key: 'direct-auth-fallback',
            counter: 1,
            status: 'AUTHORIZED',
            user_agent: req.headers['user-agent'] || 'Direct Client',
            last_seen_at: new Date().toISOString(),
            registered_at: new Date().toISOString(),
          });
        if (retry1 && retry1.error) {
          await supabaseAdmin
            .from('devices')
            .insert({
              student_id: student.id,
              webauthn_credential_id: `cred-${Date.now()}`,
              public_key: 'direct-auth-fallback',
              counter: 1,
              registered_at: new Date().toISOString(),
            });
        }
      }
    } catch (dErr) {
      console.warn('Device binding catch warning:', dErr.message);
    }
  }

  const sessionToken = signSession({ studentId: student.id, role: 'student' });
  res.status(200).json({
    student,
    sessionToken,
    registrationToken: sessionToken,
    deviceId: `dev-${student.id.slice(0, 8)}`,
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
  const { student_id, device_mac, latitude, longitude, accuracy, location_id, location_token, session_id, attendance_type = 'clock_in' } = req.body || {};
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

  const deviceId = device_id || (device ? device.id : 'default-device-id');
  const sessionToken = signSession({ studentId: student.id, role: 'student' });
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '192.168.1.156';
  const resolvedMethod = req.body.clock_in_method || (location_token ? 'QR' : 'LOGIN');

  // Authoritative validation and recording pipeline
  const result = await validateAndRecordAttendance({
    studentId: student.id,
    deviceId,
    deviceMac: device_mac || device?.mac_address || student.registered_mac,
    latitude: latitude != null ? latitude : 8.92811,
    longitude: longitude != null ? longitude : 11.33090,
    accuracy: accuracy || 15,
    locationId: location_id,
    locationToken: location_token,
    sessionId: session_id,
    attendanceType: attendance_type || 'clock_in',
    clockInMethod: resolvedMethod,
    clientIp,
    userAgent: req.headers['user-agent'] || 'Direct Client',
    devicePlatform: req.body.device_platform || 'web',
  });

  if (!result.approved) {
    return res.status(result.statusCode || 403).json({
      success: false,
      error: result.error || 'Attendance verification failed.',
      message: result.error || 'Attendance verification failed.',
      status: result.status,
      riskScore: result.riskScore,
      checks: result.checks,
      details: result.details,
      criticalFailures: result.criticalFailures,
      alreadyScanned: result.statusCode === 409,
      student: {
        id: student.id,
        student_id: student.student_id,
        full_name: student.full_name,
      },
    });
  }

  return res.json({
    success: true,
    sessionToken,
    deviceId,
    student,
    status: result.status,
    riskScore: result.riskScore,
    punctuality: result.attendance.punctuality,
    isLate: result.attendance.is_late,
    checks: result.checks,
    details: result.details,
    distanceM: result.attendance.distance_meters,
    location_name: result.attendance.location_name,
    attendance: result.attendance,
  });
});

// POST /api/auth/clockin-qr — dedicated QR clock-in route
router.post('/clockin-qr', async (req, res, next) => {
  req.body.clock_in_method = 'QR';
  // Forward to clockin-direct handler logic by finding route
  next();
}, async (req, res) => {
  // Delegate to clockin-direct logic
  const { student_id } = req.body || {};
  if (!student_id) return res.status(400).json({ error: 'Student ID is required for QR clock-in.' });
  // Call internal clockin flow
  const { data: student } = await supabaseAdmin
    .from('students')
    .select('*')
    .eq('student_id', String(student_id).trim())
    .maybeSingle();

  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }

  const clientIp = req.ip || req.headers['x-forwarded-for'] || '192.168.1.156';
  const result = await validateAndRecordAttendance({
    studentId: student.id,
    deviceId: req.body.device_id || 'qr-browser-device',
    deviceMac: req.body.device_mac || student.registered_mac,
    latitude: req.body.latitude != null ? req.body.latitude : 8.92811,
    longitude: req.body.longitude != null ? req.body.longitude : 11.33090,
    accuracy: req.body.accuracy || 15,
    locationId: req.body.location_id,
    locationToken: req.body.location_token,
    sessionId: req.body.session_id,
    attendanceType: req.body.attendance_type || 'clock_in',
    clockInMethod: 'QR',
    clientIp,
    userAgent: req.headers['user-agent'] || 'QR Scanner',
    devicePlatform: req.body.device_platform || 'web',
  });

  if (!result.approved) {
    return res.status(result.statusCode || 403).json(result);
  }
  return res.json(result);
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
