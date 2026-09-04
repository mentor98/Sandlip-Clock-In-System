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
