const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { validateAndRecordAttendance } = require('../services/attendanceValidator');
const eventBus = require('../utils/eventBus');

const router = express.Router();

// Handler factory for clock-in & clock-out
function makeHandler(attendanceType) {
  return async (req, res) => {
    const studentId = req.user.sub;
    const {
      latitude,
      longitude,
      accuracy,
      device_id,
      device_mac,
      location_id,
      location_token,
      session_id,
      clock_in_method = 'LOGIN',
      device_platform = 'web',
    } = req.body || {};
    const clientIp = req.ip || req.headers['x-forwarded-for'] || null;

    if (latitude == null || longitude == null || !device_id) {
      return res.status(400).json({
        error: 'Latitude, longitude, and device_id are required.',
        status: 'REJECTED',
        riskScore: 0,
      });
    }

    // Run authoritative validation and recording pipeline
    const result = await validateAndRecordAttendance({
      studentId,
      deviceId: device_id,
      deviceMac: device_mac,
      latitude,
      longitude,
      accuracy,
      locationId: location_id,
      locationToken: location_token,
      sessionId: session_id,
      attendanceType,
      clockInMethod: clock_in_method,
      clientIp,
      userAgent: req.headers['user-agent'] || 'Oasis Student PWA',
      devicePlatform: device_platform,
    });

    if (!result.approved) {
      return res.status(result.statusCode || 403).json({
        success: false,
        error: result.error || 'Attendance verification failed.',
        status: result.status,
        riskScore: result.riskScore,
        checks: result.checks,
        details: result.details,
        criticalFailures: result.criticalFailures,
      });
    }

    res.status(201).json({
      success: true,
      status: result.status,
      riskScore: result.riskScore,
      punctuality: result.attendance.punctuality,
      isLate: result.attendance.is_late,
      location_name: result.attendance.location_name,
      distanceM: result.attendance.distance_meters,
      checks: result.checks,
      details: result.details,
      attendance: result.attendance,
      message: result.message,
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
