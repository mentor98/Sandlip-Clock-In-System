const express = require('express');
const crypto = require('crypto');
const bwipjs = require('bwip-js');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { generateLocationToken } = require('../utils/qrToken');
const { signSession } = require('../config/jwt');

const router = express.Router();

// Allow ?auth= query param as fallback for endpoints opened via window.open (no headers)
router.use((req, res, next) => {
  if (!req.headers.authorization && req.query.auth) {
    req.headers.authorization = `Bearer ${req.query.auth}`;
  }
  next();
});

router.use(requireAuth, requireAdmin);

// --- Locations ---

router.post('/locations', async (req, res) => {
  const { name, latitude, longitude, geofence_radius_m, active_start, active_end } = req.body || {};
  if (!name || latitude == null || longitude == null) {
    return res.status(400).json({ error: 'name, latitude, and longitude are required.' });
  }
  const { data, error } = await supabaseAdmin
    .from('locations')
    .insert({
      name,
      latitude,
      longitude,
      geofence_radius_m: geofence_radius_m || 50,
      active_start,
      active_end,
      created_by: req.user.sub,
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not create location.' });
  res.status(201).json({ location: data });
});

router.get('/locations', async (_req, res) => {
  const { data, error } = await supabaseAdmin.from('locations').select('*').order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load locations.' });
  res.json({ locations: data });
});

router.patch('/locations/:id', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('locations')
    .update(req.body)
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not update location.' });
  res.json({ location: data });
});

router.delete('/locations/:id', async (req, res) => {
  const { error } = await supabaseAdmin.from('locations').delete().eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Could not delete location.' });
  res.json({ success: true });
});

// --- QR generation (admin generates on demand, old QR immediately invalidated) ---

router.post('/locations/:id/generate-qr', async (req, res) => {
  const locationId = req.params.id;
  const adminIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.ip || req.socket?.remoteAddress || '127.0.0.1';

  // Verify location exists
  const { data: location } = await supabaseAdmin
    .from('locations')
    .select('id, name')
    .eq('id', locationId)
    .single();
  if (!location) return res.status(404).json({ error: 'Location not found.' });

  // Generate a new nonce — this instantly invalidates any previous QR for this location
  const nonce = crypto.randomBytes(16).toString('hex');
  await supabaseAdmin
    .from('locations')
    .update({
      active_qr_nonce: nonce,
      qr_generated_at: new Date().toISOString(),
      admin_ip: adminIp,
    })
    .eq('id', locationId);

  // Build the token with Admin IP and Admin ID embedded for multi-factor verification
  const token = generateLocationToken({
    locationId,
    nonce,
    adminId: req.user?.sub,
    adminIp,
  });
  const pwaBase = process.env.RP_ORIGIN_PWA || 'http://localhost:3000';
  const deepLink = `${pwaBase}?location_id=${locationId}&token=${encodeURIComponent(token)}`;

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

  const { data: session } = await supabaseAdmin
    .from('attendance_sessions')
    .select('id, title, location_id, locations(name)')
    .eq('id', sessionId)
    .single();

  if (!session) return res.status(404).json({ error: 'Attendance session not found.' });

  const locationId = session.location_id;
  const nonce = crypto.randomBytes(16).toString('hex');

  // Update session & location nonce
  await supabaseAdmin
    .from('attendance_sessions')
    .update({ admin_ip: adminIp, active_qr_nonce: nonce })
    .eq('id', sessionId);

  if (locationId) {
    await supabaseAdmin
      .from('locations')
      .update({ active_qr_nonce: nonce, qr_generated_at: new Date().toISOString(), admin_ip: adminIp })
      .eq('id', locationId);
  }

  const token = generateLocationToken({
    locationId,
    nonce,
    adminId: req.user?.sub,
    adminIp,
    sessionId,
  });

  const pwaBase = process.env.RP_ORIGIN_PWA || 'http://localhost:3000';
  const deepLink = `${pwaBase}?location_id=${locationId}&session_id=${sessionId}&token=${encodeURIComponent(token)}`;

  const png = await bwipjs.toBuffer({
    bcid: 'qrcode',
    text: deepLink,
    scale: 8,
    includetext: false,
  });

  res.json({
    qr_png_base64: png.toString('base64'),
    session_title: session.title,
    location_name: session.locations?.name || 'Classroom',
    nonce,
    admin_ip: adminIp,
    expires_in_seconds: parseInt(process.env.QR_TOKEN_TTL_SECONDS || '25', 10),
  });
});

// Keep old SSE endpoint for backwards compatibility but redirect to new approach
router.get('/locations/:id/qr', async (req, res) => {
  res.status(410).json({ error: 'SSE QR endpoint removed. Use POST /admin/locations/:id/generate-qr instead.' });
});

// --- Device Management ---

router.get('/devices', async (req, res) => {
  const { student_id, status } = req.query;
  let query = supabaseAdmin
    .from('devices')
    .select('*, students(full_name, student_id, email, registered_ip, registered_mac)')
    .order('registered_at', { ascending: false });
  if (student_id) query = query.eq('student_id', student_id);
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not load devices.' });
  res.json({ devices: data });
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
  let query = supabaseAdmin.from('students').select('*, devices(id, revoked_at, registered_at, ip_address, mac_address, user_agent, last_seen_at, webauthn_credential_id, status)');
  if (search) {
    const s = String(search).trim();
    query = query.or(`full_name.ilike.%${s}%,student_id.ilike.%${s}%,email.ilike.%${s}%,registered_ip.ilike.%${s}%,registered_mac.ilike.%${s}%`);
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load students.' });
  res.json({ students: data });
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
  let query = supabaseAdmin
    .from('attendance')
    .select('*, students(full_name, student_id, registered_ip, registered_mac), locations(name)')
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
  if (error) return res.status(500).json({ error: 'Could not load attendance.' });
  res.json({ attendance: data });
});

// GET /admin/attendance/absent — get absent students for a session
router.get('/attendance/absent', async (req, res) => {
  const { session_id, from, to } = req.query;
  let query = supabaseAdmin
    .from('attendance')
    .select('*, students(full_name, student_id, registered_ip, registered_mac), locations(name)')
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
