const express = require('express');
const crypto = require('crypto');
const bwipjs = require('bwip-js');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateLocationToken } = require('../utils/qrToken');
const { signSession } = require('../config/jwt');
const { findSession, generateSessionQrPayload } = require('../utils/sharedSessions');
const eventBus = require('../utils/eventBus');

const router = express.Router();

// Allow ?auth= or ?token= query param as fallback for endpoints opened via window.open / EventSource (no headers)
router.use((req, res, next) => {
  if (!req.headers.authorization && (req.query.auth || req.query.token)) {
    req.headers.authorization = `Bearer ${req.query.auth || req.query.token}`;
  }
  next();
});

router.use(requireAuth, requireAdmin);

// Realtime SSE stream for Admin Dashboard to get 0ms push updates
router.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  res.write(`event: connected\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);

  const onRealtimeEvent = (payload) => {
    try {
      res.write(`event: realtime\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (_) {}
  };

  const onAttendanceRecorded = (payload) => {
    try {
      res.write(`event: attendance\ndata: ${JSON.stringify(payload)}\n\n`);
    } catch (_) {}
  };

  eventBus.on('realtime_event', onRealtimeEvent);
  eventBus.on('attendance_recorded', onAttendanceRecorded);

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 12000);

  // Graceful serverless cycling: close cleanly after 50 seconds before Vercel lambda limits.
  // Standard EventSource automatically reconnects cleanly with zero errors.
  const serverlessTimeout = setTimeout(() => {
    try {
      res.write(`event: reconnect\ndata: ${JSON.stringify({ reason: 'cycle' })}\n\n`);
      res.end();
    } catch (_) {}
  }, 50000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(serverlessTimeout);
    eventBus.removeListener('realtime_event', onRealtimeEvent);
    eventBus.removeListener('attendance_recorded', onAttendanceRecorded);
  });
});

// --- Locations & Geofence Resilience ---

function toValidUuid(val, defaultUuid = 'a0000000-0000-0000-0000-000000000001') {
  if (!val || typeof val !== 'string') return defaultUuid;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) {
    return val;
  }
  if (/^adm-[0-9a-fA-F-]+$/.test(val)) return 'a0000000-0000-0000-0000-000000000001';
  if (/^loc-[0-9a-fA-F-]+$/.test(val)) return 'c0000000-0000-0000-0000-000000000001';
  if (/^stu-[0-9a-fA-F-]+$/.test(val)) return 'b0000000-0000-0000-0000-000000000001';
  return defaultUuid;
}

const inMemoryLocations = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    name: 'Sandlip Oasis - Lecture & Hall Complex',
    latitude: 8.9280843,
    longitude: 11.3307533,
    geofence_radius_m: 200,
    active_start: '06:00:00',
    active_end: '22:00:00',
    created_by: 'a0000000-0000-0000-0000-000000000001',
    created_at: new Date().toISOString(),
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    name: 'Sandlip Oasis - Innovation & Tech Wing',
    latitude: 8.9280843,
    longitude: 11.3307533,
    geofence_radius_m: 200,
    active_start: '06:00:00',
    active_end: '22:00:00',
    created_by: 'a0000000-0000-0000-0000-000000000001',
    created_at: new Date().toISOString(),
  },
];

router.post('/locations', async (req, res) => {
  const { name, latitude, longitude, geofence_radius_m, active_start, active_end } = req.body || {};
  if (!name || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'name, latitude, and longitude are required.' });
  }

  const cleanCreatedBy = toValidUuid(req.user?.sub, 'a0000000-0000-0000-0000-000000000001');
  const newLocId = crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now().toString(16).padEnd(31, '0');

  const newLoc = {
    id: newLocId,
    name,
    latitude: parseFloat(latitude) || 8.9280843,
    longitude: parseFloat(longitude) || 11.3307533,
    geofence_radius_m: parseInt(geofence_radius_m, 10) || 200,
    active_start: active_start || null,
    active_end: active_end || null,
    created_by: cleanCreatedBy,
    created_at: new Date().toISOString(),
  };

  let saved = null;
  try {
    const { data, error } = await supabaseAdmin
      .from('locations')
      .insert(newLoc)
      .select()
      .single();

    if (!error && data) saved = data;
    else console.warn('Supabase location insert notice:', error?.message || error);
  } catch (err) {
    console.warn('Location insert exception:', err.message);
  }

  const result = saved || newLoc;
  inMemoryLocations.unshift(result);
  res.status(201).json({ location: result });
});

router.get('/locations', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('locations')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data && data.length > 0) {
      return res.json({ locations: data });
    }
    if (error) {
      console.warn('Locations query notice:', error.message || error);
    }
  } catch (err) {
    console.warn('Locations query exception:', err.message);
  }

  res.json({ locations: inMemoryLocations });
});

router.patch('/locations/:id', async (req, res) => {
  const locId = req.params.id;
  let updated = null;
  try {
    const { data, error } = await supabaseAdmin
      .from('locations')
      .update(req.body)
      .eq('id', locId)
      .select()
      .single();
    if (!error && data) updated = data;
  } catch (err) {
    console.warn('Update location notice:', err.message);
  }

  const inMem = inMemoryLocations.find(l => l.id === locId);
  if (inMem) {
    Object.assign(inMem, req.body);
    if (!updated) updated = inMem;
  }

  res.json({ location: updated || { id: locId, ...req.body } });
});

router.delete('/locations/:id', async (req, res) => {
  const locId = req.params.id;
  try {
    await supabaseAdmin.from('locations').delete().eq('id', locId);
  } catch (err) {
    console.warn('Delete location notice:', err.message);
  }

  const idx = inMemoryLocations.findIndex(l => l.id === locId);
  if (idx !== -1) inMemoryLocations.splice(idx, 1);

  res.json({ success: true });
});

// --- QR generation (admin generates on demand, old QR immediately invalidated) ---

router.post('/locations/:id/generate-qr', async (req, res) => {
  const locationId = req.params.id;
  const adminIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1';

  // Verify location exists
  let location = null;
  try {
    const { data } = await supabaseAdmin
      .from('locations')
      .select('id, name')
      .eq('id', locationId)
      .single();
    if (data) location = data;
  } catch (_) {}

  if (!location) {
    location = inMemoryLocations.find(l => l.id === locationId);
  }

  if (!location) {
    location = { id: locationId, name: 'Campus Complex' };
  }

  // Generate a new nonce — this instantly invalidates any previous QR for this location
  const nonce = crypto.randomBytes(16).toString('hex');
  try {
    await supabaseAdmin
      .from('locations')
      .update({
        active_qr_nonce: nonce,
        qr_generated_at: new Date().toISOString(),
        admin_ip: adminIp,
      })
      .eq('id', locationId);
  } catch (_) {}

  // Build the token with Admin IP and Admin ID embedded for multi-factor verification
  const token = generateLocationToken({
    locationId,
    nonce,
    adminId: req.user?.sub,
    adminIp,
  });
  const forwardedProto = req.headers['x-forwarded-proto'] || (req.secure ? 'https' : 'http');
  const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host;
  const detectedOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : null;
  const pwaBase = process.env.RP_ORIGIN_PWA || detectedOrigin || '';
  const deepLink = pwaBase
    ? `${pwaBase}?location_id=${locationId}&token=${encodeURIComponent(token)}`
    : `/?location_id=${locationId}&token=${encodeURIComponent(token)}`;

  // Generate QR image as base64 PNG
  const png = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: deepLink,
    scale: 8,
    includetext: false,
  });

  res.json({
    qr_png_base64: png.toString('base64'),
    location_name: location.name,
    nonce,
    admin_ip: adminIp,
    expires_in_seconds: parseInt(process.env.QR_TOKEN_TTL_SECONDS || '25', 10),
  });
});

// Session-specific Live Classroom QR generator
router.post('/sessions/:id/generate-qr', async (req, res) => {
  const sessionId = req.params.id;
  const adminIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1';

  const session = await findSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Attendance session not found.' });
  }

  try {
    const payload = await generateSessionQrPayload(session, adminIp, req.user?.sub);
    res.json(payload);
  } catch (err) {
    console.error('Session QR generation error:', err);
    res.status(500).json({ error: 'Failed to generate session QR code: ' + err.message });
  }
});

// Keep old SSE endpoint for backwards compatibility but redirect to new approach
router.get('/locations/:id/qr', async (req, res) => {
  res.status(410).json({ error: 'SSE QR endpoint removed. Use POST /admin/locations/:id/generate-qr instead.' });
});

// --- Device Management ---

router.get('/devices', async (req, res) => {
  const { student_id, status } = req.query;
  try {
    let query = supabaseAdmin
      .from('devices')
      .select('*, students(full_name, student_id, email)')
      .order('registered_at', { ascending: false });
    if (student_id) query = query.eq('student_id', student_id);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) {
      console.warn('Devices join query notice:', error.message || error);
      let fallback = supabaseAdmin.from('devices').select('*').order('registered_at', { ascending: false });
      if (student_id) fallback = fallback.eq('student_id', student_id);
      if (status) fallback = fallback.eq('status', status);
      const { data: rawDevices, error: err2 } = await fallback;
      if (err2) {
        console.error('Fallback devices query error:', err2);
        return res.status(500).json({ error: 'Could not load devices.' });
      }
      let studentsMap = {};
      try {
        const { data: sData } = await supabaseAdmin.from('students').select('*');
        if (Array.isArray(sData)) {
          sData.forEach(s => { studentsMap[s.id] = s; });
        }
      } catch (_) {}
      const devices = (rawDevices || []).map(d => ({
        ...d,
        students: studentsMap[d.student_id] || null,
      }));
      return res.json({ devices });
    }
    res.json({ devices: data || [] });
  } catch (err) {
    console.error('Error loading devices:', err);
    res.status(500).json({ error: 'Could not load devices.' });
  }
});

router.patch('/devices/:id/authorize', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .update({ status: 'AUTHORIZED', authorized_by: req.user.sub, authorized_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not authorize device.' });
  await supabaseAdmin.from('audit_log').insert({
    student_id: data.student_id,
    event_type: 'admin_action',
    detail: { action: 'device_authorized', device_id: req.params.id, by: req.user.sub },
  });
  res.json({ device: data });
});

router.patch('/devices/:id/revoke', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .update({ status: 'REVOKED', revoked_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not revoke device.' });
  await supabaseAdmin.from('audit_log').insert({
    student_id: data.student_id,
    event_type: 'admin_action',
    detail: { action: 'device_revoked', device_id: req.params.id, by: req.user.sub },
  });
  res.json({ device: data });
});

router.patch('/devices/:id/block', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .update({ status: 'BLOCKED', revoked_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not block device.' });
  await supabaseAdmin.from('audit_log').insert({
    student_id: data.student_id,
    event_type: 'admin_action',
    detail: { action: 'device_blocked', device_id: req.params.id, by: req.user.sub },
  });
  res.json({ device: data });
});

router.patch('/devices/:id/reactivate', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('devices')
    .update({ status: 'AUTHORIZED', revoked_at: null })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not reactivate device.' });
  await supabaseAdmin.from('audit_log').insert({
    student_id: data.student_id,
    event_type: 'admin_action',
    detail: { action: 'device_reactivated', device_id: req.params.id, by: req.user.sub },
  });
  res.json({ device: data });
});

// --- Students ---

router.get('/students', async (req, res) => {
  const { search } = req.query;
  try {
    let query = supabaseAdmin.from('students').select('*, devices(id, revoked_at, registered_at, webauthn_credential_id)');
    if (search) {
      const s = String(search).trim();
      query = query.or(`full_name.ilike.%${s}%,student_id.ilike.%${s}%,email.ilike.%${s}%`);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
       console.warn('Students join query notice:', error.message || error);
       let fallbackQuery = supabaseAdmin.from('students').select('*').order('created_at', { ascending: false });
       if (search) {
         const s = String(search).trim();
         fallbackQuery = fallbackQuery.or(`full_name.ilike.%${s}%,student_id.ilike.%${s}%,email.ilike.%${s}%`);
       }
       const { data: rawStudents, error: err2 } = await fallbackQuery;
       if (err2) {
         console.error('Fallback students query error:', err2);
         return res.status(500).json({ error: 'Could not load students.' });
       }
       let devicesList = [];
       try {
         const { data: dData } = await supabaseAdmin.from('devices').select('*');
         if (Array.isArray(dData)) devicesList = dData;
       } catch (_) {}
       const students = (rawStudents || []).map(st => ({
         ...st,
         devices: devicesList.filter(d => d.student_id === st.id),
       }));
       return res.json({ students });
    }
    res.json({ students: data || [] });
  } catch (err) {
    console.error('Error loading students:', err);
    res.status(500).json({ error: 'Could not load students.' });
  }
});

router.patch('/students/:id/suspend', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('students')
    .update({ status: 'suspended' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not suspend account.' });
  await supabaseAdmin.from('audit_log').insert({
    student_id: req.params.id,
    event_type: 'admin_action',
    detail: { action: 'suspend', by: req.user.sub },
  });
  res.json({ student: data });
});

router.patch('/students/:id/activate', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('students')
    .update({ status: 'active' })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not activate account.' });
  await supabaseAdmin.from('audit_log').insert({
    student_id: req.params.id,
    event_type: 'admin_action',
    detail: { action: 'activate', by: req.user.sub },
  });
  res.json({ student: data });
});

router.patch('/students/:id', async (req, res) => {
  const { full_name, email } = req.body || {};
  const updates = {};
  if (full_name) updates.full_name = full_name;
  if (email) updates.email = email;
  const { data, error } = await supabaseAdmin
    .from('students')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not update student.' });
  await supabaseAdmin.from('audit_log').insert({
    student_id: req.params.id,
    event_type: 'admin_action',
    detail: { action: 'edit', updates, by: req.user.sub },
  });
  res.json({ student: data });
});

router.delete('/students/:id', async (req, res) => {
  const id = req.params.id;
  // Remove audit log entries and attendance records first to satisfy foreign key constraints
  await supabaseAdmin.from('audit_log').delete().eq('student_id', id);
  await supabaseAdmin.from('attendance').delete().eq('student_id', id);
  await supabaseAdmin.from('devices').delete().eq('student_id', id);
  const { error } = await supabaseAdmin.from('students').delete().eq('id', id);
  if (error) {
    console.error('delete student error:', error);
    return res.status(500).json({ error: 'Could not delete account.' });
  }
  res.json({ success: true });
});

// Revoke old device + issue a fresh, short-lived registration link (replaces "change IP/MAC").
router.post('/students/:id/reset-device', async (req, res) => {
  await supabaseAdmin
    .from('devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('student_id', req.params.id)
    .is('revoked_at', null);

  const registrationToken = signSession({ studentId: req.params.id, role: 'pending-device-bind' });
  await supabaseAdmin.from('audit_log').insert({
    student_id: req.params.id,
    event_type: 'admin_action',
    detail: { action: 'reset_device', by: req.user.sub },
  });
  res.json({ registrationLink: `${process.env.RP_ORIGIN}/register-device?token=${registrationToken}` });
});

// --- Exports & audit ---

router.get('/attendance', async (req, res) => {
  const { from, to, location_id, student, punctuality } = req.query;
  try {
    let query = supabaseAdmin
      .from('attendance')
      .select('*, students(full_name, student_id, email), locations(name)')
      .order('recorded_at', { ascending: false })
      .limit(500);
    if (from) query = query.gte('recorded_at', from);
    if (to) query = query.lte('recorded_at', to + 'T23:59:59');
    if (location_id) query = query.eq('location_id', location_id);
    if (punctuality && punctuality !== 'ALL') query = query.eq('punctuality', punctuality.toUpperCase());
    if (student) {
      // filter by student name or ID via a sub-query approach using student join
      const { data: matched } = await supabaseAdmin
        .from('students')
        .select('id')
        .or(`full_name.ilike.%${student}%,student_id.ilike.%${student}%`);
      const ids = (matched || []).map(s => s.id);
      if (ids.length === 0) return res.json({ attendance: [] });
      query = query.in('student_id', ids);
    }
    const { data, error } = await query;
    if (error) {
      console.warn('Attendance join query notice:', error.message || error);
      let fallback = supabaseAdmin
        .from('attendance')
        .select('*')
        .order('recorded_at', { ascending: false })
        .limit(500);
      if (from) fallback = fallback.gte('recorded_at', from);
      if (to) fallback = fallback.lte('recorded_at', to + 'T23:59:59');
      if (location_id) fallback = fallback.eq('location_id', location_id);
      const { data: rawAtt, error: err2 } = await fallback;
      if (err2) {
        console.error('Fallback attendance query error:', err2);
        return res.status(500).json({ error: 'Could not load attendance.' });
      }

      let studentsMap = {};
      let locationsMap = {};
      try {
        const { data: sData } = await supabaseAdmin.from('students').select('*');
        if (Array.isArray(sData)) sData.forEach(s => { studentsMap[s.id] = s; });
        const { data: lData } = await supabaseAdmin.from('locations').select('*');
        if (Array.isArray(lData)) lData.forEach(l => { locationsMap[l.id] = l; });
      } catch (_) {}

      const attendance = (rawAtt || []).map(a => ({
        ...a,
        students: studentsMap[a.student_id] || null,
        locations: locationsMap[a.location_id] ? { name: locationsMap[a.location_id].name } : null,
      }));
      return res.json({ attendance });
    }
    res.json({ attendance: data || [] });
  } catch (err) {
    console.error('Error loading attendance:', err);
    res.status(500).json({ error: 'Could not load attendance.' });
  }
});

// GET /admin/attendance/absent — get absent students for a session
router.get('/attendance/absent', async (req, res) => {
  const { session_id, from, to } = req.query;
  let query = supabaseAdmin
    .from('attendance')
    .select('*, students(full_name, student_id, email), locations(name)')
    .eq('verification_status', 'AUTO_ABSENT')
    .order('marked_absent_at', { ascending: false });
  
  if (session_id) query = query.eq('session_id', session_id);
  if (from) query = query.gte('marked_absent_at', from);
  if (to) query = query.lte('marked_absent_at', to);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not load absent records.' });
  res.json({ absent: data });
});

router.get('/attendance/export', async (req, res) => {
  const { from, to, location_id, punctuality } = req.query;
  let query = supabaseAdmin
    .from('attendance')
    .select('recorded_at, type, punctuality, device_mac, ip_address, verification_status, students(full_name, student_id), locations(name)')
    .order('recorded_at', { ascending: true });
  if (from) query = query.gte('recorded_at', from);
  if (to) query = query.lte('recorded_at', to);
  if (location_id) query = query.eq('location_id', location_id);
  if (punctuality && punctuality !== 'ALL') query = query.eq('punctuality', punctuality.toUpperCase());

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not export attendance.' });

  const header = 'student_name,student_id,location,type,punctuality,device_mac,ip_address,status,recorded_at\n';
  const rows = data
    .map((r) => [
      `"${r.students?.full_name || ''}"`,
      `"${r.students?.student_id || ''}"`,
      `"${r.locations?.name || ''}"`,
      r.type || 'clock_in',
      r.punctuality || 'EARLY',
      r.device_mac || '—',
      r.ip_address || '—',
      r.verification_status || 'VERIFIED',
      r.recorded_at,
    ].join(','))
    .join('\n');

  res.set('Content-Type', 'text/csv');
  res.set('Content-Disposition', 'attachment; filename="attendance_export.csv"');
  res.send(header + rows);
});

router.get('/audit-log', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('audit_log')
    .select('*, students(full_name, student_id)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ error: 'Could not load audit log.' });
  res.json({ audit_log: data });
});

module.exports = router;
