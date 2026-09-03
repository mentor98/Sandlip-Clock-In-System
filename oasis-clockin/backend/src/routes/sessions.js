const crypto = require('crypto');
const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  inMemorySessions,
  toValidUuid,
  findSession,
  ensureValidLocation,
  generateSessionQrPayload,
} = require('../utils/sharedSessions');

const router = express.Router();

// ── Public: student reads active session ──────────────────────────────────────

// GET /api/sessions/active — student polls this to know if a session is open
router.get('/active', requireAuth, async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('attendance_sessions')
      .select('id, title, location_id, locations(name), started_at, ends_at, status')
      .eq('status', 'ACTIVE')
      .lte('started_at', new Date().toISOString())
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (!error && data) {
      return res.json({ session: data });
    }
  } catch (err) {
    console.warn('Active session query notice:', err.message);
  }

  const active = inMemorySessions.find((s) => s.status === 'ACTIVE') || null;
  res.json({ session: active });
});

// ── Admin only below ──────────────────────────────────────────────────────────

router.use(requireAuth, requireAdmin);

// GET /api/sessions — list all sessions
router.get('/', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('attendance_sessions')
      .select('*, locations(name)')
      .order('created_at', { ascending: false })
      .limit(100);

    if (!error && data && data.length > 0) {
      return res.json({ sessions: data });
    }

    if (error) {
      console.warn('Sessions join query notice:', error.message || error);
      const { data: rawData, error: err2 } = await supabaseAdmin
        .from('attendance_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!err2 && rawData && rawData.length > 0) {
        return res.json({
          sessions: rawData.map((s) => ({
            ...s,
            locations: s.locations || { name: 'Sandlip Oasis Campus' },
          })),
        });
      }
    }
  } catch (err) {
    console.warn('Load sessions query exception:', err.message);
  }

  res.json({ sessions: inMemorySessions });
});

// POST /api/sessions — create and immediately start a session
router.post('/', async (req, res) => {
  const { title, location_id, ends_at } = req.body || {};
  if (!title) {
    return res.status(400).json({ error: 'title is required.' });
  }

  // Ensure location exists in Supabase so foreign key references locations(id) succeeds
  const validLoc = await ensureValidLocation(location_id);
  const cleanLocId = validLoc.id;
  const locName = validLoc.name || 'Sandlip Oasis Campus';
  const cleanCreatedBy = toValidUuid(req.user?.sub, 'a0000000-0000-0000-0000-000000000001');

  // Close existing active sessions in memory
  inMemorySessions.forEach((s) => {
    if (s.status === 'ACTIVE') {
      s.status = 'CLOSED';
      s.closed_at = new Date().toISOString();
    }
  });

  // Close existing active sessions in Supabase
  try {
    await supabaseAdmin
      .from('attendance_sessions')
      .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
      .eq('status', 'ACTIVE');
  } catch (err) {
    console.warn('Close active sessions notice:', err.message);
  }

  const nowIso = new Date().toISOString();
  const newSessionId = crypto.randomUUID
    ? crypto.randomUUID()
    : 'e' + Date.now().toString(16).padEnd(31, '0');

  const fallbackSession = {
    id: newSessionId,
    title,
    location_id: cleanLocId,
    created_by: cleanCreatedBy,
    status: 'ACTIVE',
    started_at: nowIso,
    ends_at: ends_at || null,
    closed_at: null,
    created_at: nowIso,
    locations: { name: locName },
  };

  let savedSession = null;

  try {
    const { data, error } = await supabaseAdmin
      .from('attendance_sessions')
      .insert({
        id: newSessionId,
        title,
        location_id: cleanLocId,
        created_by: null,
        status: 'ACTIVE',
        started_at: nowIso,
        ends_at: ends_at || null,
      })
      .select('*, locations(name)')
      .single();

    if (!error && data) {
      savedSession = data;
    } else {
      console.warn('Session insert attempt 1 notice:', error?.message || error);
      const { data: data2, error: err2 } = await supabaseAdmin
        .from('attendance_sessions')
        .insert({
          id: newSessionId,
          title,
          location_id: cleanLocId,
          created_by: null,
          status: 'ACTIVE',
          started_at: nowIso,
          ends_at: ends_at || null,
        })
        .select('*')
        .single();

      if (!err2 && data2) {
        savedSession = { ...data2, locations: { name: locName } };
      } else {
        console.warn('Session insert attempt 2 notice:', err2?.message || err2);
      }
    }
  } catch (err) {
    console.warn('Session insert exception:', err.message);
  }

  const resultSession = savedSession || fallbackSession;
  inMemorySessions.unshift(resultSession);

  try {
    await supabaseAdmin.from('audit_log').insert({
      student_id: cleanCreatedBy,
      event_type: 'admin_action',
      detail: { action: 'session_started', session_id: resultSession.id, title },
    });
  } catch (_) {}

  res.status(201).json({ session: resultSession });
});

// POST /api/sessions/:id/generate-qr — generate live QR projector code
router.post('/:id/generate-qr', async (req, res) => {
  const sessionId = req.params.id;
  const adminIp =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.ip ||
    req.socket?.remoteAddress ||
    '127.0.0.1';

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

// PATCH /api/sessions/:id/close — admin closes a session
router.patch('/:id/close', async (req, res) => {
  const sessionId = req.params.id;
  let closedSession = null;

  try {
    const { data, error } = await supabaseAdmin
      .from('attendance_sessions')
      .update({ status: 'CLOSED', closed_at: new Date().toISOString() })
      .eq('id', sessionId)
      .select()
      .single();

    if (!error && data) closedSession = data;
  } catch (err) {
    console.warn('Close session notice:', err.message);
  }

  const inMem = inMemorySessions.find((s) => s.id === sessionId);
  if (inMem) {
    inMem.status = 'CLOSED';
    inMem.closed_at = new Date().toISOString();
    if (!closedSession) closedSession = inMem;
  }

  res.json({ session: closedSession || { id: sessionId, status: 'CLOSED' } });
});

// DELETE /api/sessions/:id
router.delete('/:id', async (req, res) => {
  const sessionId = req.params.id;
  try {
    await supabaseAdmin.from('attendance_sessions').delete().eq('id', sessionId);
  } catch (err) {
    console.warn('Delete session notice:', err.message);
  }

  const idx = inMemorySessions.findIndex((s) => s.id === sessionId);
  if (idx !== -1) inMemorySessions.splice(idx, 1);

  res.json({ success: true });
});

// GET /api/sessions/:id/attendance — who clocked in during this session
router.get('/:id/attendance', async (req, res) => {
  try {
    const { data: session } = await supabaseAdmin
      .from('attendance_sessions')
      .select('started_at, closed_at, location_id')
      .eq('id', req.params.id)
      .single();

    const inMemSession = inMemorySessions.find((s) => s.id === req.params.id);
    const activeSess = session || inMemSession;

    if (!activeSess) {
      return res.json({ attendance: [] });
    }

    let query = supabaseAdmin
      .from('attendance')
      .select('*, students(full_name, student_id)')
      .gte('recorded_at', activeSess.started_at)
      .order('recorded_at', { ascending: true });

    if (activeSess.location_id) {
      query = query.eq('location_id', activeSess.location_id);
    }
    if (activeSess.closed_at) {
      query = query.lte('recorded_at', activeSess.closed_at);
    }

    const { data, error } = await query;
    if (!error) {
      return res.json({ attendance: data || [] });
    }
  } catch (err) {
    console.warn('Session attendance load notice:', err.message);
  }

  res.json({ attendance: [] });
});

module.exports = router;
