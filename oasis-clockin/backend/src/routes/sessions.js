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

// Allow ?auth= or ?token= query param as fallback for endpoints opened via EventSource / window.open
router.use((req, res, next) => {
  if (!req.headers.authorization) {
    const token = req.query.auth || req.query.token;
    if (token) {
      req.headers.authorization = `Bearer ${token}`;
    }
  }
  next();
});

const eventBus = require('../utils/eventBus');

// ── Public / Live Projector Endpoints ─────────────────────────────────────────

// GET /api/sessions/:id/stream — Real-time Server-Sent Events stream for live session attendance
router.get('/:id/stream', (req, res) => {
  const sessionId = req.params.id;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  // Initial connection event
  res.write(`event: connected\ndata: ${JSON.stringify({ sessionId, connectedAt: new Date().toISOString() })}\n\n`);

  const onAttendance = (eventData) => {
    try {
      if (!eventData) return;
      const rec = eventData.record || eventData;
      const evSessionId = String(eventData.sessionId || rec.session_id || '');
      const reqSessionId = String(sessionId || '');
      if (!evSessionId || !reqSessionId || evSessionId === reqSessionId) {
        const payloadStr = JSON.stringify(rec);
        res.write(`event: attendance\ndata: ${payloadStr}\n\n`);
        res.write(`data: ${payloadStr}\n\n`);
      }
    } catch (e) {
      console.warn('SSE send notice:', e.message);
    }
  };

  eventBus.on('attendance_recorded', onAttendance);

  // Heartbeat comment every 15s to keep proxy connections alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  // Graceful serverless cycling: close cleanly after 50 seconds before Vercel lambda limits
  const serverlessTimeout = setTimeout(() => {
    try {
      res.write(`event: reconnect\ndata: ${JSON.stringify({ reason: 'cycle' })}\n\n`);
      res.end();
    } catch (_) {}
  }, 50000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clearTimeout(serverlessTimeout);
    eventBus.removeListener('attendance_recorded', onAttendance);
  });
});

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

    if (!error && Array.isArray(data)) {
      return res.json({ sessions: data });
    }

    if (error) {
      console.warn('Sessions join query notice:', error.message || error);
      const { data: rawData, error: err2 } = await supabaseAdmin
        .from('attendance_sessions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!err2 && Array.isArray(rawData)) {
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
    // Unlink any attendance records pointing to this session first
    await supabaseAdmin.from('attendance').update({ session_id: null }).eq('session_id', sessionId);
    const { error } = await supabaseAdmin.from('attendance_sessions').delete().eq('id', sessionId);
    if (error) {
      console.warn('Supabase session delete notice:', error.message || error);
    }
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
    const sessionId = req.params.id;
    const { data: session } = await supabaseAdmin
      .from('attendance_sessions')
      .select('id, started_at, closed_at, location_id')
      .eq('id', sessionId)
      .single();

    const inMemSession = inMemorySessions.find((s) => s.id === sessionId);
    const activeSess = session || inMemSession;

    const { data: allAttendance, error } = await supabaseAdmin
      .from('attendance')
      .select('*, students(full_name, student_id, email, registered_mac, registered_ip)')
      .order('recorded_at', { ascending: false });

    if (!error && allAttendance) {
      const filtered = allAttendance.filter((r) => {
        // Direct session ID match
        if (r.session_id === sessionId) return true;

        // Active session time window match
        if (activeSess && activeSess.started_at) {
          const recIso = r.recorded_at || r.created_at;
          if (recIso) {
            const recTime = new Date(recIso).getTime();
            const startTime = new Date(activeSess.started_at).getTime();
            const closeTime = activeSess.closed_at ? new Date(activeSess.closed_at).getTime() : Date.now() + 60000;
            if (recTime >= startTime - 60000 && recTime <= closeTime) {
              if (!activeSess.location_id || r.location_id === activeSess.location_id) {
                return true;
              }
            }
          }
        }
        return false;
      });

      return res.json({ attendance: filtered });
    }
  } catch (err) {
    console.warn('Session attendance load notice:', err.message);
  }

  res.json({ attendance: [] });
});

module.exports = router;
