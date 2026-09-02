const express = require('express');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// ── Organization Config ───────────────────────────────────────────────────────

// GET /api/organization — fetch current config (single row, id = 'default')
router.get('/', async (_req, res) => {
  const { data } = await supabaseAdmin
    .from('organization_config')
    .select('*')
    .eq('id', 'default')
    .single();
  res.json({ config: data || null });
});

// PUT /api/organization — create or update config
router.put('/', async (req, res) => {
  const {
    name, address,
    latitude, longitude, attendance_radius_m,
    require_ip_match, require_gps, require_qr, require_device_auth,
    ip_check_mode, // 'strict' | 'warn' | 'off'
    status,
  } = req.body || {};

  if (!name) return res.status(400).json({ error: 'Organization name is required.' });

  const payload = {
    id: 'default',
    name,
    address: address || null,
    latitude: latitude != null ? parseFloat(latitude) : null,
    longitude: longitude != null ? parseFloat(longitude) : null,
    attendance_radius_m: attendance_radius_m ? parseInt(attendance_radius_m) : 150,
    require_ip_match: require_ip_match ?? false,
    require_gps: require_gps ?? true,
    require_qr: require_qr ?? false,
    require_device_auth: require_device_auth ?? true,
    ip_check_mode: ip_check_mode || 'warn',
    status: status || 'active',
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from('organization_config')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();

  if (error) {
    console.error('org upsert error:', error);
    return res.status(500).json({ error: 'Could not save organization config.' });
  }
  res.json({ config: data });
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
