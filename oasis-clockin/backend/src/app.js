require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');

const { authLimiter, generalLimiter } = require('./middleware/rateLimiter');
const { initSchedules } = require('./jobs/absenceScheduler');
const authRoutes = require('./routes/auth');
const webauthnRoutes = require('./routes/webauthn');
const attendanceRoutes = require('./routes/attendance');
const adminRoutes = require('./routes/admin');
const adminAuthRoutes = require('./routes/adminAuth');
const organizationRoutes = require('./routes/organization');
const sessionRoutes = require('./routes/sessions');
const deviceRoutes = require('./routes/device');

const app = express();
app.set('trust proxy', 1);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json());
app.use(generalLimiter);

// Initialize scheduled jobs if possible
try {
  initSchedules();
} catch (e) {
  console.warn('Scheduled jobs init note:', e.message);
}

app.all(['/api', '/api/'], (_req, res) => res.json({
  ok: true,
  name: 'Oasis ClockIn API',
  wifi_ssid: 'The Oasis',
  wifi_mac: 'be:64:b4:14:4d:67',
  wifi_ip: '192.168.1.156',
  timestamp: new Date().toISOString()
}));

app.all('/api/health', async (_req, res) => {
  const { supabaseAdmin, isSupabaseConfigured } = require('./config/supabase');
  let databaseMode = isSupabaseConfigured ? 'supabase_cloud' : 'in_memory_store';
  let databaseConnected = true;
  let errorMsg = null;

  if (isSupabaseConfigured) {
    try {
      const { error } = await supabaseAdmin.from('students').select('id').limit(1);
      if (error) {
        databaseConnected = false;
        errorMsg = error.message;
      }
    } catch (e) {
      databaseConnected = false;
      errorMsg = e.message;
    }
  }

  res.json({
    ok: true,
    portal: 'online',
    admin: 'online',
    database: {
      mode: databaseMode,
      connected: databaseConnected,
      error: errorMsg,
    },
    wifi_ssid: 'The Oasis',
    wifi_mac: 'be:64:b4:14:4d:67',
    wifi_ip: '192.168.1.156',
    timestamp: new Date().toISOString()
  });
});

// Debug endpoint for student inspection
app.get('/api/debug/student/:student_id', async (req, res) => {
  const { supabaseAdmin } = require('./config/supabase');
  const { data: student } = await supabaseAdmin
    .from('students')
    .select('id, full_name, student_id, email, role, status')
    .eq('student_id', req.params.student_id)
    .single();
  if (!student) return res.json({ found: false });
  const { data: devices } = await supabaseAdmin
    .from('devices')
    .select('id, webauthn_credential_id, registered_at, revoked_at')
    .eq('student_id', student.id);
  res.json({ student, devices });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/auth/webauthn', authLimiter, webauthnRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin-auth', authLimiter, adminAuthRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/device', deviceRoutes);
app.use('/api/location', deviceRoutes);

// Static assets serving for standalone node execution
let adminDistPath = path.join(__dirname, '../../admin-dashboard/dist');
let studentPwaPath = path.join(__dirname, '../../student-pwa');

if (!fs.existsSync(adminDistPath)) {
  const rootDistAdmin = path.join(__dirname, '../../../dist/admin');
  if (fs.existsSync(rootDistAdmin)) adminDistPath = rootDistAdmin;
}

if (!fs.existsSync(studentPwaPath)) {
  const rootDistPwa = path.join(__dirname, '../../../dist');
  if (fs.existsSync(rootDistPwa)) studentPwaPath = rootDistPwa;
}

if (fs.existsSync(adminDistPath)) {
  app.use('/admin', express.static(adminDistPath));
  app.get('/admin', (_req, res) => {
    res.redirect('/admin/');
  });
  app.get('/admin/*', (_req, res) => {
    res.sendFile(path.join(adminDistPath, 'index.html'));
  });
}

if (fs.existsSync(studentPwaPath)) {
  app.use('/pwa', express.static(studentPwaPath));
  app.use(express.static(studentPwaPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (req.path.startsWith('/admin') && fs.existsSync(adminDistPath)) {
      return res.sendFile(path.join(adminDistPath, 'index.html'));
    }
    res.sendFile(path.join(studentPwaPath, 'index.html'));
  });
}

// Generic error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong.' });
});

module.exports = app;
