const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// ── Organization Config ───────────────────────────────────────────────────────

// In-memory overlay for organization config in case remote schema lacks newer columns
let inMemoryOrgOverlay = {};

// GET /api/organization — fetch current config (single row, id = 'default')
router.get('/', async (_req, res) => {
  const defaultConfig = {
    id: 'default',
    name: 'Sandlip Oasis',
    address: 'Sandlip Oasis Campus',
    latitude: 8.928084,
    longitude: 11.330753,
    attendance_radius_m: 200,
    require_ip_match: true,
    require_wifi_match: true,
    require_gps: true,
    require_qr: false,
    require_device_auth: true,
    ip_check_mode: 'warn',
    work_start_time: '08:00',
    grace_period_minutes: 15,
    early_threshold_minutes: 15,
    wifi_mac: 'be:64:b4:14:4d:67',
    wifi_ip: '192.168.1.156',
    wifi_ssid: 'Sandlip-Oasis-WiFi',
    status: 'active',
  };

  try {
    const { data } = await supabaseAdmin
      .from('organization_config')
      .select('*')
      .eq('id', 'default')
      .single();

    res.json({ config: { ...defaultConfig, ...(data || {}), ...inMemoryOrgOverlay } });
  } catch (err) {
    console.warn('Organization config fetch notice:', err.message);
    res.json({ config: { ...defaultConfig, ...inMemoryOrgOverlay } });
  }
});

// PUT /api/organization — create or update config
router.put('/', async (req, res) => {
  const {
    name, address,
    latitude, longitude, attendance_radius_m,
    require_ip_match, require_wifi_match, require_gps, require_qr, require_device_auth,
    ip_check_mode, // 'strict' | 'warn' | 'off'
    work_start_time, grace_period_minutes, early_threshold_minutes,
    wifi_mac, wifi_ip, wifi_ssid,
    status,
  } = req.body || {};

  if (!name) return res.status(400).json({ error: 'Organization name is required.' });

  const payload = {
    id: 'default',
    name,
    address: address || null,
    latitude: latitude != null ? parseFloat(latitude) : null,
    longitude: longitude != null ? parseFloat(longitude) : null,
    attendance_radius_m: attendance_radius_m ? parseInt(attendance_radius_m, 10) : 150,
    require_ip_match: require_ip_match ?? true,
    require_wifi_match: require_wifi_match ?? true,
    require_gps: require_gps ?? true,
    require_qr: require_qr ?? false,
    require_device_auth: require_device_auth ?? true,
    ip_check_mode: ip_check_mode || 'warn',
    work_start_time: work_start_time || '08:00',
    grace_period_minutes: grace_period_minutes != null ? parseInt(grace_period_minutes, 10) : 15,
    early_threshold_minutes: early_threshold_minutes != null ? parseInt(early_threshold_minutes, 10) : 15,
    wifi_mac: wifi_mac || 'be:64:b4:14:4d:67',
    wifi_ip: wifi_ip || '192.168.1.156',
    wifi_ssid: wifi_ssid || 'Sandlip-Oasis-WiFi',
    status: status || 'active',
    updated_at: new Date().toISOString(),
  };

  // Keep all requested values in memory so they are preserved even if DB schema hasn't added columns yet
  inMemoryOrgOverlay = { ...payload };

  let currentPayload = { ...payload };
  let savedData = null;

  // Resilient retry loop: if remote schema lacks columns (PGRST204), remove them and retry
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await supabaseAdmin
      .from('organization_config')
      .upsert(currentPayload, { onConflict: 'id' })
      .select()
      .single();

    if (!error) {
      savedData = data;
      break;
    }

    console.warn(`org upsert notice (attempt ${attempt + 1}):`, error.message || error);

    // If a specific column is missing from Supabase schema cache (e.g. PGRST204)
    const match = error.message && error.message.match(/Could not find the '([^']+)' column/i);
    if (match && match[1] && currentPayload[match[1]] !== undefined) {
      const col = match[1];
      console.warn(`Stripping unmapped column '${col}' and retrying upsert...`);
      delete currentPayload[col];
      continue;
    }

    // Fallback: strip optional schedule and WiFi columns
    const extendedColumns = [
      'early_threshold_minutes',
      'grace_period_minutes',
      'work_start_time',
      'require_wifi_match',
      'wifi_mac',
      'wifi_ip',
      'wifi_ssid',
    ];
    let stripped = false;
    for (const c of extendedColumns) {
      if (currentPayload[c] !== undefined) {
        delete currentPayload[c];
        stripped = true;
      }
    }

    if (!stripped) {
      // If even base columns fail, log and break
      console.error('Core organization config upsert failed:', error);
      break;
    }
  }

  // Always return the complete configuration to the caller
  res.json({ config: { ...payload, ...(savedData || {}) } });
});

// ── Approved Networks ─────────────────────────────────────────────────────────

// GET /api/organization/networks
router.get('/networks', async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('approved_networks')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: 'Could not load networks.' });
  res.json({ networks: data });
});

// POST /api/organization/networks — add an approved IP or CIDR range
router.post('/networks', async (req, res) => {
  const { cidr, label } = req.body || {};
  if (!cidr) return res.status(400).json({ error: 'cidr is required (e.g. 197.210.65.0/24 or 41.58.22.5).' });

  const { data, error } = await supabaseAdmin
    .from('approved_networks')
    .insert({ cidr, label: label || cidr, created_by: req.user.sub })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'That network is already listed.' });
    return res.status(500).json({ error: 'Could not add network.' });
  }
  res.status(201).json({ network: data });
});

// DELETE /api/organization/networks/:id
router.delete('/networks/:id', async (req, res) => {
  const { error } = await supabaseAdmin
    .from('approved_networks')
    .delete()
    .eq('id', req.params.id);
  if (error) return res.status(500).json({ error: 'Could not remove network.' });
  res.json({ success: true });
});

module.exports = router;
