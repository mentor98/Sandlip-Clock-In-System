const express = require('express');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const OASIS_LATITUDE = parseFloat(process.env.OASIS_LATITUDE) || 8.92811;
const OASIS_LONGITUDE = parseFloat(process.env.OASIS_LONGITUDE) || 11.33090;
const OASIS_GEOFENCE_RADIUS_METERS = parseInt(process.env.OASIS_GEOFENCE_RADIUS_METERS, 10) || 150;
const OASIS_MAX_GPS_ACCURACY_METERS = parseInt(process.env.OASIS_MAX_GPS_ACCURACY_METERS, 10) || 100;
const OASIS_REFERENCE_PRIVATE_IP = process.env.OASIS_REFERENCE_PRIVATE_IP || '192.168.1.156';
const OASIS_REFERENCE_MAC = process.env.OASIS_REFERENCE_MAC || 'BE:64:B4:14:4D:67';

// ── GET /api/device/location-config (or /api/location/config) ────────────────
router.get(['/config', '/location-config'], async (_req, res) => {
  try {
    const { data: loc } = await supabaseAdmin
      .from('locations')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: org } = await supabaseAdmin
      .from('organization_config')
      .select('*')
      .eq('id', 'default')
      .maybeSingle();

    const name = loc?.name || org?.name || 'Sandlip Oasis - Lecture & Hall Complex';
    const lat = loc?.latitude || (org ? parseFloat(org.latitude) : null) || OASIS_LATITUDE;
    const lng = loc?.longitude || (org ? parseFloat(org.longitude) : null) || OASIS_LONGITUDE;
    const radius = loc?.geofence_radius_m || (org ? parseInt(org.attendance_radius_m, 10) : null) || OASIS_GEOFENCE_RADIUS_METERS;

    res.json({
      location_id: loc?.id || 'c0000000-0000-0000-0000-000000000001',
      location_name: name,
      latitude: lat,
      longitude: lng,
      geofence_radius_meters: radius,
      max_gps_accuracy_meters: OASIS_MAX_GPS_ACCURACY_METERS,
      reference_private_ip: OASIS_REFERENCE_PRIVATE_IP,
      reference_mac: OASIS_REFERENCE_MAC,
      server_timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.json({
      location_id: 'c0000000-0000-0000-0000-000000000001',
      location_name: 'Sandlip Oasis - Lecture & Hall Complex',
      latitude: OASIS_LATITUDE,
      longitude: OASIS_LONGITUDE,
      geofence_radius_meters: OASIS_GEOFENCE_RADIUS_METERS,
      max_gps_accuracy_meters: OASIS_MAX_GPS_ACCURACY_METERS,
      reference_private_ip: OASIS_REFERENCE_PRIVATE_IP,
      reference_mac: OASIS_REFERENCE_MAC,
      server_timestamp: new Date().toISOString(),
    });
  }
});

// ── POST & GET /api/device/identify ──────────────────────────────────────────
// Smart device resolution: Identifies physical hardware across browsers (Chrome, Firefox, Safari) and devices
router.all('/identify', async (req, res) => {
  const body = req.method === 'POST' ? (req.body || {}) : (req.query || {});
  const { hardware_device_id, hardware_mac, student_id, user_agent, platform } = body;
  const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '192.168.1.156';

  try {
    const cleanMac = (hardware_mac || '').trim();
    const cleanDevId = (hardware_device_id || '').trim();
    const cleanSid = (student_id || '').trim();

    let device = null;
    let boundStudent = null;

    // 1. Look up device by hardware MAC
    if (cleanMac) {
      const { data: dByMac } = await supabaseAdmin
        .from('devices')
        .select('*, students(id, student_id, full_name, email, status, registered_mac, registered_ip)')
        .ilike('mac_address', cleanMac)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle();
      if (dByMac) {
        device = dByMac;
        boundStudent = dByMac.students || null;
      }
    }

    // 2. Look up device by hardware device ID
    if (!device && cleanDevId) {
      const { data: dById } = await supabaseAdmin
        .from('devices')
        .select('*, students(id, student_id, full_name, email, status, registered_mac, registered_ip)')
        .eq('device_id', cleanDevId)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle();
      if (dById) {
        device = dById;
        boundStudent = dById.students || null;
      }
    }

    // 3. Look up registered_mac in students table
    if (!boundStudent && cleanMac) {
      const { data: sByMac } = await supabaseAdmin
        .from('students')
        .select('id, student_id, full_name, email, status, registered_mac, registered_ip')
        .ilike('registered_mac', cleanMac)
        .maybeSingle();
      if (sByMac) boundStudent = sByMac;
    }

    // 4. If student_id query supplied, check if that student is registered on another device
    let studentDeviceStatus = null;
    if (cleanSid) {
      const { data: queryStudent } = await supabaseAdmin
        .from('students')
        .select('id, student_id, full_name, email, status, registered_mac, registered_ip')
        .or(`student_id.ilike.${cleanSid},id.eq.${cleanSid}`)
        .maybeSingle();

      if (!queryStudent) {
        studentDeviceStatus = {
          exists: false,
          error: "You don't have an account. Please register to get an ID",
        };
      } else {
        const normStudentMac = (queryStudent.registered_mac || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
        const normHardwareMac = (cleanMac || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
        const isMatched = !normStudentMac || !normHardwareMac || normStudentMac === normHardwareMac;

        studentDeviceStatus = {
          exists: true,
          student: queryStudent,
          isCurrentDevice: isMatched,
          registeredMac: queryStudent.registered_mac,
        };
      }
    }

    // 5. Check today's clock-in status
    const studentToCheck = boundStudent || (studentDeviceStatus?.exists ? studentDeviceStatus.student : null);
    // 5. Check active attendance session first
    const { inMemorySessions } = require('../utils/sharedSessions');
    const { hasStudentAttendedSession, scannedStudentSessions } = require('../services/attendanceValidator');
    let activeSession = null;
    try {
      const { data: s } = await supabaseAdmin
        .from('attendance_sessions')
        .select('id, title, location_id, locations(name), started_at, ends_at, status')
        .eq('status', 'ACTIVE')
        .lte('started_at', new Date().toISOString())
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (s && (!s.ends_at || new Date(s.ends_at) > new Date())) activeSession = s;
    } catch (_) {}
    if (!activeSession) {
      activeSession = inMemorySessions.find(s => s.status === 'ACTIVE' && (!s.ends_at || new Date(s.ends_at) > new Date())) || null;
    }

    // 6. Check today's clock-in status
    let todayStatus = { clockedIn: false, clockedOut: false };
    if (studentToCheck) {
      const today = new Date().toISOString().slice(0, 10);
      try {
        const { data: att } = await supabaseAdmin
          .from('attendance')
          .select('type, recorded_at, session_id')
          .eq('student_id', studentToCheck.id)
          .gte('recorded_at', today);
        if (att && Array.isArray(att)) {
          todayStatus.clockedIn = att.some(a => a.type === 'clock_in');
          todayStatus.clockedOut = att.some(a => a.type === 'clock_out');
        }
      } catch (_) {}

      // Fast check in memory session attendance
      if (activeSession && (hasStudentAttendedSession(studentToCheck.id, activeSession.id) || hasStudentAttendedSession(studentToCheck.student_id, activeSession.id))) {
        todayStatus.clockedIn = true;
      }
      if (scannedStudentSessions && (scannedStudentSessions.has(`${studentToCheck.id}:${activeSession?.id}`) || scannedStudentSessions.has(`${studentToCheck.student_id}:${activeSession?.id}`))) {
        todayStatus.clockedIn = true;
      }
    }

    return res.json({
      success: true,
      recognized: Boolean(device || boundStudent),
      isBound: Boolean(boundStudent),
      hardware_mac: cleanMac,
      hardware_device_id: cleanDevId,
      device: device ? {
        id: device.id,
        device_id: device.device_id || cleanDevId,
        mac_address: device.mac_address || cleanMac,
        status: device.status || 'AUTHORIZED',
        device_name: device.device_name || 'Physical Device',
      } : null,
      boundStudent: boundStudent ? {
        id: boundStudent.id,
        student_id: boundStudent.student_id,
        full_name: boundStudent.full_name,
        email: boundStudent.email,
        status: boundStudent.status,
      } : null,
      studentDeviceStatus,
      todayStatus,
      activeSession,
      hasActiveSession: Boolean(activeSession),
      clientIp,
      oasisNetwork: {
        wifi_ssid: 'The Oasis',
        wifi_mac: 'be:64:b4:14:4d:67',
        wifi_ip: '192.168.1.156',
      },
      server_timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Device identify error:', err);
    res.status(500).json({ error: 'Device identification failed.' });
  }
});

// ── POST /api/device/register ────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { student_id, device_id, device_name, platform, user_agent, mac_address } = req.body || {};
  const clientIp = req.ip || req.headers['x-forwarded-for'] || '192.168.1.156';

  if (!device_id) {
    return res.status(400).json({ error: 'device_id (UUID) is required.' });
  }

  try {
    let student = null;
    if (student_id) {
      const { data: s } = await supabaseAdmin
        .from('students')
        .select('id, full_name, student_id, email, status, registered_mac, registered_ip')
        .or(`id.eq.${student_id},student_id.eq.${student_id}`)
        .maybeSingle();
      student = s;
    }

    // Check if device is already registered
    const { data: existingDevice } = await supabaseAdmin
      .from('devices')
      .select('*')
      .eq('device_id', device_id)
      .maybeSingle();

    if (existingDevice) {
      if (existingDevice.status === 'REVOKED' || existingDevice.status === 'BLOCKED') {
        return res.status(403).json({
          success: false,
          error: 'This device has been revoked or blocked by an administrator.',
          status: existingDevice.status,
        });
      }

      // Update existing device
      const { data: updated } = await supabaseAdmin
        .from('devices')
        .update({
          last_seen_at: new Date().toISOString(),
          last_ip: clientIp,
          ip_address: clientIp,
          user_agent: user_agent || req.headers['user-agent'] || existingDevice.user_agent,
          device_name: device_name || existingDevice.device_name,
          platform: platform || existingDevice.platform,
        })
        .eq('id', existingDevice.id)
        .select()
        .single();

      return res.json({
        success: true,
        message: 'Device authorized.',
        device: updated || existingDevice,
      });
    }

    // Register new device
    const newDevicePayload = {
      student_id: student?.id || null,
      device_id: device_id,
      device_name: device_name || 'Browser Device',
      platform: platform || 'web',
      status: 'AUTHORIZED',
      ip_address: clientIp,
      first_ip: clientIp,
      last_ip: clientIp,
      user_agent: user_agent || req.headers['user-agent'] || 'Oasis Client',
      device_mac_reference: mac_address || OASIS_REFERENCE_MAC,
      mac_address: mac_address || OASIS_REFERENCE_MAC,
      last_seen_at: new Date().toISOString(),
      registered_at: new Date().toISOString(),
    };

    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('devices')
      .insert(newDevicePayload)
      .select()
      .single();

    if (insertErr) {
      console.warn('Device register insert notice:', insertErr.message);
      // Fallback response so user is never blocked
      return res.json({
        success: true,
        message: 'Device registered.',
        device: newDevicePayload,
      });
    }

    res.json({
      success: true,
      message: 'Device registered and authorized.',
      device: inserted,
    });
  } catch (err) {
    console.error('Device register error:', err);
    res.status(500).json({ error: 'Device registration failed.' });
  }
});

// ── POST /api/device/heartbeat ───────────────────────────────────────────────
router.post('/heartbeat', async (req, res) => {
  const { device_id, latitude, longitude, accuracy } = req.body || {};
  const clientIp = req.ip || req.headers['x-forwarded-for'] || null;

  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required.' });
  }

  try {
    await supabaseAdmin
      .from('devices')
      .update({
        last_seen_at: new Date().toISOString(),
        last_ip: clientIp,
        last_location_lat: latitude,
        last_location_lng: longitude,
      })
      .eq('device_id', device_id);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

module.exports = router;
