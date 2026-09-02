const express = require('express');
const crypto = require('crypto');
const { supabaseAdmin } = require('../config/supabase');
const { signSession, verifySession } = require('../config/jwt');

const router = express.Router();

// Simple password hashing using Node built-in crypto (PBKDF2)
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}
function verifyPassword(password, hash, salt) {
  return hashPassword(password, salt) === hash;
}


/**
 * POST /api/admin-auth/setup
 * One-time setup to create the first admin account.
 * Body: { full_name, admin_id, email, password }
 * Disabled once any admin_accounts row exists.
 */
router.post('/setup', async (req, res) => {
  const { full_name, admin_id, email, password } = req.body || {};
  if (!full_name || !admin_id || !email || !password) {
    return res.status(400).json({ error: 'full_name, admin_id, email, and password are required.' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  // Check if any admin account already exists
  const { data: existing } = await supabaseAdmin
    .from('admin_accounts')
    .select('id')
    .limit(1);

  if (existing && existing.length > 0) {
    return res.status(409).json({ error: 'Admin account already exists. Use /login instead.' });
  }

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = hashPassword(password, salt);

  const { data, error } = await supabaseAdmin
    .from('admin_accounts')
    .insert({ full_name, admin_id, email, password_hash: hash, password_salt: salt })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An admin with that ID or email already exists.' });
    console.error('setup error:', error);
    return res.status(500).json({ error: 'Could not create admin account.' });
  }

  const token = signSession({ studentId: data.id, role: 'admin' });
  res.status(201).json({ message: 'Admin account created.', sessionToken: token });
});

/**
 * POST /api/admin-auth/login
 * Body: { admin_id, password }
 */
router.post('/login', async (req, res) => {
  const { admin_id, password } = req.body || {};
  if (!admin_id || !password) {
    return res.status(400).json({ error: 'admin_id and password are required.' });
  }

  const { data: admin } = await supabaseAdmin
    .from('admin_accounts')
    .select('*')
    .eq('admin_id', admin_id)
    .single();

  if (!admin) {
    // Check if table is currently empty and credentials match initial default admin
    const { data: allAdmins } = await supabaseAdmin
      .from('admin_accounts')
      .select('id')
      .limit(1);

    if ((!allAdmins || allAdmins.length === 0) && (admin_id === 'ADMIN-001' || admin_id === 'admin')) {
      if (password === 'admin12345' || password === 'admin') {
        const salt = crypto.randomBytes(32).toString('hex');
        const hash = hashPassword(password, salt);
        const { data: newAdmin } = await supabaseAdmin
          .from('admin_accounts')
          .insert({
            full_name: 'System Administrator',
            admin_id: 'ADMIN-001',
            email: 'admin@oasis.edu',
            password_hash: hash,
            password_salt: salt,
          })
          .select()
          .single();

        if (newAdmin) {
          const token = signSession({ studentId: newAdmin.id, role: 'admin' });
          return res.json({
            sessionToken: token,
            admin: { id: newAdmin.id, full_name: newAdmin.full_name, email: newAdmin.email },
          });
        }
      }
    }

    return res.status(401).json({ error: 'Invalid admin ID or password.' });
  }

  if (!verifyPassword(password, admin.password_hash, admin.password_salt)) {
    return res.status(401).json({ error: 'Invalid admin ID or password.' });
  }

  const token = signSession({ studentId: admin.id, role: 'admin' });
  res.json({ sessionToken: token, admin: { id: admin.id, full_name: admin.full_name, email: admin.email } });
});

/**
 * POST /api/admin-auth/change-password
 * Body: { current_password, new_password }
 * Requires Bearer token.
 */
router.post('/change-password', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });

  let payload;
  try {
    payload = verifySession(token);
  } catch {
    return res.status(401).json({ error: 'Invalid session.' });
  }


  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required.' });
  }
  if (new_password.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const { data: admin } = await supabaseAdmin
    .from('admin_accounts')
    .select('*')
    .eq('id', payload.sub)
    .single();

  if (!admin || !verifyPassword(current_password, admin.password_hash, admin.password_salt)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = hashPassword(new_password, salt);
  await supabaseAdmin
    .from('admin_accounts')
    .update({ password_hash: hash, password_salt: salt })
    .eq('id', admin.id);

  res.json({ message: 'Password updated successfully.' });
});

module.exports = router;
