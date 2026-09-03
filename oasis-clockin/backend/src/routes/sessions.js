const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// ── Public: student reads active session ──────────────────────────────────────

// GET /api/sessions/active — student polls this to know if a session is open
router.get('/active', requireAuth, async (_req, res) => {
  const { data } = await supabaseAdmin
    .from('attendance_sessions')
    .select('id, title, location_id, locations(name), started_at, ends_at, status')
    .eq('status', 'ACTIVE')
    .lte('started_at', new Date().toISOString())
    .order('started_at', { ascending: false })
    .limit(1)
    .single();
  res.json({ session: data || null });
});

// ── Admin only below ──────────────────────────────────────────────────────────

router.use(requireAuth, requireAdmin);

// GET /api/sessions — list all sessions
router.get('/', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('attendance_sessions')
    .select('*, locations(name)')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: 'Could not load sessions.' });
  res.json({ sessions: data });
});

// POST /api/sessions — create and immediately start a session
router.post('/', async (req, res) => {
  const { title, location_id, ends_at } = req.body || {};
  if (!title || !location_id) {
    return res.status(400).json({ error: 'title and location_id are required.' });
  }

  // Close any existing active session first
  await supabaseAdmin
    .from('attendance_sessions')
    .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
    .eq('status', 'ACTIVE');

  const { data, error } = await supabaseAdmin
    .from('attendance_sessions')
    .insert({
      title,
      location_id,
      created_by: req.user.sub,
      status: 'ACTIVE',
      started_at: new Date().toISOString(),
      ends_at: ends_at || null,
    })
    .select('*, locations(name)')
    .single();

  if (error) return res.status(500).json({ error: 'Could not create session.' });

  await supabaseAdmin.from('audit_log').insert({
    student_id: req.user.sub,
    event_type: 'admin_action',
    detail: { action: 'session_started', session_id: data.id, title },
  });

  res.status(201).json({ session: data });
});

// PATCH /api/sessions/:id/close — admin closes a session
router.patch('/:id/close', async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('attendance_sessions')
    .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: 'Could not close session.' });

  await supabaseAdmin.from('audit_log').insert({
    student_id: req.user.sub,
    event_type: 'admin_action',
    detail: { action: 'session_closed', session_id: req.params.id },
  });

  res.json({ session: data });
});

// DELETE /api/sessions/:id
router.delete('/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('attendance_sessions')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Could not delete session.' });
  res.json({ success: true });
});

// GET /api/sessions/:id/attendance — who clocked in during this session
router.get('/:id/attendance', async (req, res) => {
  const { data: session } = await supabaseAdmin
    .from('attendance_sessions')
    .select('started_at, closed_at, location_id')
    .eq('id', req.params.id)
    .single();
  if (!session) return res.status(404).json({ error: 'Session not found.' });

  let query = supabaseAdmin
    .from('attendance')
    .select('*, students(full_name, student_id)')
    .eq('location_id', session.location_id)
    .gte('recorded_at', session.started_at)
    .order('recorded_at', { ascending: true });

  if (session.closed_at) query = query.lte('recorded_at', session.closed_at);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not load session attendance.' });
  res.json({ attendance: data });
});

module.exports = router;
