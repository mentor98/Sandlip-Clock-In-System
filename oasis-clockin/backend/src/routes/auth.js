const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { signSession } = require('../config/jwt');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { full_name, student_id, email } = req.body || {};
  if (!full_name || !student_id || !email) {
    return res.status(400).json({ error: 'full_name, student_id, and email are required.' });
  }

  const cleanId = String(student_id).trim();
  const cleanEmail = String(email).trim().toLowerCase();
  const cleanName = String(full_name).trim();

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
        detail: { action: 'self_device_rebind' },
      });
    }
    student = existing;
  } else {
    const { data, error } = await supabaseAdmin
      .from('students')
      .insert({ full_name: cleanName, student_id: cleanId, email: cleanEmail, status: 'active', role: 'student' })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An account with that ID or email already exists.' });
      }
      return res.status(500).json({ error: 'Could not create account.' });
    }
    student = data;
  }

  const registrationToken = signSession({ studentId: student.id, role: 'pending-device-bind' });
  res.status(200).json({ student, registrationToken });
});

// POST /api/auth/direct-login — allows instant sign-in with student ID
router.post('/direct-login', async (req, res) => {
  const { student_id } = req.body || {};
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

  if (!student || (student.status && student.status === 'suspended')) {
    return res.status(403).json({ error: "Please, you're not a student here or your account is suspended." });
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
  }

  const sessionToken = signSession({ studentId: student.id, role: 'student' });
  res.json({
    verified: true,
    sessionToken,
    deviceId: device ? device.id : 'default-device-id',
    student,
  });
});

// POST /api/auth/direct-bind — direct device binding if WebAuthn is blocked in environment
router.post('/direct-bind', requireAuth, async (req, res) => {
  const studentId = req.user.sub;
  const { data: student } = await supabaseAdmin
    .from('students')
    .select('*')
    .eq('id', studentId)
    .single();

  if (!student) {
    return res.status(404).json({ error: 'Student not found.' });
  }

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
      webauthn_credential_id: `cred-bind-${Date.now()}`,
      public_key: 'direct-bind-key',
      counter: 1,
      transports: ['internal'],
      status: 'AUTHORIZED',
      ip_address: req.ip || '127.0.0.1',
      user_agent: req.headers['user-agent'] || 'Direct Bind',
      last_seen_at: new Date().toISOString(),
    })
    .select()
    .single();

  const sessionToken = signSession({ studentId, role: 'student' });
  res.json({
    verified: true,
    sessionToken,
    deviceId: device ? device.id : 'default-device-id',
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
