const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { validateAttendance } = require('../services/attendanceValidator');
const eventBus = require('../utils/eventBus');

const router = express.Router();

async function logAudit(studentId, eventType, detail) {
  try {
    await supabaseAdmin.from('audit_log').insert({
      student_id: studentId,
      event_type: eventType,
      detail,
    });
  } catch (err) {
    console.error('Audit log write error:', err);
  }
}

// Handler factory for clock-in & clock-out
function makeHandler(attendanceType) {
  return async (req, res) => {
    const studentId = req.user.sub;
    const { latitude, longitude, accuracy, device_id, device_mac, location_id, location_token } = req.body || {};
    const clientIp = req.ip || req.headers['x-forwarded-for'] || null;

    if (latitude == null || longitude == null || !device_id) {
      return res.status(400).json({
        error: 'Latitude, longitude, and device_id are required.',
        status: 'REJECTED',
        riskScore: 0,
      });
    }

    // Run authoritative validation engine
    const result = await validateAttendance({
      studentId,
      deviceId: device_id,
      deviceMac: device_mac,
      latitude,
      longitude,
      accuracy,
      locationId: location_id,
      locationToken: location_token,
      clientIp,
      attendanceType,
    });

    // If there were security anomalies or non-verified outcomes, record audit event
    if (result.status !== 'VERIFIED' || result.securityAnomalies.length > 0) {
      await logAudit(studentId, 'attendance_security_event', {
        status: result.status,
        riskScore: result.riskScore,
        criticalFailures: result.criticalFailures,
        securityAnomalies: result.securityAnomalies,
        checks: result.checks,
        details: result.details,
        attendanceType,
        clientIp,
      });
    }

    // If critical failure or rejected
    if (!result.approved) {
      return res.status(403).json({
        success: false,
        error: result.criticalFailures[0] || 'Attendance verification failed.',
        status: result.status,
        riskScore: result.riskScore,
        checks: result.checks,
        details: result.details,
        criticalFailures: result.criticalFailures,
      });
    }

    // Insert attendance record
    const { data: row, error } = await supabaseAdmin
      .from('attendance')
      .insert({
        student_id: studentId,
        location_id: result.targetLocation?.id || null,
        type: attendanceType,
        recorded_at: new Date().toISOString(),
        latitude,
        longitude,
        device_id,
        device_mac: device_mac || null,
        session_id: result.activeSession?.id || null,
        risk_score: result.riskScore,
        verification_status: result.status,
        punctuality: result.punctuality || 'EARLY',
        is_late: result.isLate || false,
        ip_address: clientIp,
        gps_accuracy: accuracy || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({
          error: `You have already clocked ${attendanceType === 'clock_in' ? 'in' : 'out'} today.`,
          status: 'DUPLICATE',
          riskScore: result.riskScore,
        });
      }
      return res.status(500).json({ error: 'Could not record attendance.' });
    }

    // Log successful attendance
    await logAudit(studentId, 'attendance_recorded', {
      attendanceType,
      location: result.targetLocation?.name,
      riskScore: result.riskScore,
      status: result.status,
      punctuality: result.punctuality,
      checks: result.checks,
    });

    if (row) {
      const { data: stu } = await supabaseAdmin
        .from('students')
        .select('id, full_name, student_id, email, registered_ip, registered_mac')
        .eq('id', studentId)
        .maybeSingle();

      const studentData = stu || { id: studentId, full_name: result.details.student?.name || 'Student' };
      eventBus.emit('attendance_recorded', {
        sessionId: result.activeSession?.id || row.session_id,
        record: {
          ...row,
          students: studentData,
        },
      });

      eventBus.emit('realtime_event', {
        table: 'attendance',
        action: 'INSERT',
        record: {
          ...row,
          students: studentData,
          locations: { name: result.targetLocation?.name || 'Sandlip Oasis Campus' },
        },
      });
    }

    res.status(201).json({
      success: true,
      status: result.status,
      riskScore: result.riskScore,
      punctuality: result.punctuality,
      punctualityLabel: result.punctualityLabel,
      isLate: result.isLate,
      location_name: result.targetLocation?.name,
      distanceM: result.details.location?.distanceM,
      checks: result.checks,
      details: result.details,
      attendance: row,
    });
  };
}

router.post('/clock-in', requireAuth, makeHandler('clock_in'));
router.post('/clock-out', requireAuth, makeHandler('clock_out'));

// GET /api/attendance/me — student's history
router.get('/me', requireAuth, async (req, res) => {
  try {
    let { data, error } = await supabaseAdmin
      .from('attendance')
      .select('*, locations(name)')
      .eq('student_id', req.user.sub)
      .order('recorded_at', { ascending: false })
      .limit(50);

    if (error) {
      // Fallback query without relation in case locations relation is not configured in Supabase
      const fallback = await supabaseAdmin
        .from('attendance')
        .select('*')
        .eq('student_id', req.user.sub)
        .order('recorded_at', { ascending: false })
        .limit(50);
      data = fallback.data || [];
    }
    res.json({ attendance: data || [] });
  } catch (err) {
    console.warn('Attendance /me load error:', err.message);
    res.json({ attendance: [] });
  }
});

// GET /api/attendance/status — student checks current day status
router.get('/status', requireAuth, async (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const currentHour = new Date().getHours();
    let { data, error } = await supabaseAdmin
      .from('attendance')
      .select('type, recorded_at, locations(name), verification_status, risk_score')
      .eq('student_id', req.user.sub)
      .gte('recorded_at', today)
      .order('recorded_at', { ascending: false });

    if (error) {
      const fallback = await supabaseAdmin
        .from('attendance')
        .select('type, recorded_at, verification_status, risk_score')
        .eq('student_id', req.user.sub)
        .gte('recorded_at', today)
        .order('recorded_at', { ascending: false });
      data = fallback.data || [];
    }

    const records = data || [];
    const clockedIn = records.some(r => r.type === 'clock_in');
    const clockedOut = records.some(r => r.type === 'clock_out');
    const canClockOut = clockedIn && !clockedOut && currentHour >= 17;

    res.json({
      clockedIn,
      clockedOut,
      canClockOut,
      currentHour,
      records,
    });
  } catch (err) {
    console.warn('Attendance /status error:', err.message);
    res.json({
      clockedIn: false,
      clockedOut: false,
      canClockOut: false,
      currentHour: new Date().getHours(),
      records: [],
    });
  }
});

module.exports = router;
