const express = require('express');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');
const { supabaseAdmin } = require('../config/supabase');
const { requireAuth } = require('../middleware/auth');
const { signSession } = require('../config/jwt');

const router = express.Router();

const rpName = () => process.env.RP_NAME || 'Oasis ClockIn';
const rpID = (req) => {
  if (process.env.RP_ID) return process.env.RP_ID;
  if (req && req.headers.host) {
    return req.headers.host.split(':')[0];
  }
  return 'localhost';
};
const origin = (req) => {
  const origins = [
    process.env.RP_ORIGIN || 'http://localhost:5174',
    process.env.RP_ORIGIN_PWA || 'http://localhost:3000',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
  ];
  if (req && req.headers.origin) {
    origins.push(req.headers.origin);
  }
  if (req && req.headers.host) {
    origins.push(`http://${req.headers.host}`);
    origins.push(`https://${req.headers.host}`);
  }
  return origins;
};


// ── Challenge helpers (Supabase-persisted, survives server restarts) ──────────

async function saveChallenge(key, challenge) {
  // Upsert into a simple webauthn_challenges table keyed by `key`
  await supabaseAdmin.from('webauthn_challenges').upsert(
    { key, challenge, created_at: new Date().toISOString() },
    { onConflict: 'key' }
  );
}

async function getChallenge(key) {
  const { data } = await supabaseAdmin
    .from('webauthn_challenges')
    .select('challenge, created_at')
    .eq('key', key)
    .single();
  if (!data) return null;
  // Expire challenges older than 5 minutes
  const age = Date.now() - new Date(data.created_at).getTime();
  if (age > 5 * 60 * 1000) {
    await deleteChallenge(key);
    return null;
  }
  return data.challenge;
}

async function deleteChallenge(key) {
  await supabaseAdmin.from('webauthn_challenges').delete().eq('key', key);
}

// ── Registration ──────────────────────────────────────────────────────────────

router.post('/register-challenge', requireAuth, async (req, res) => {
  const studentId = req.user.sub;

  const { data: student } = await supabaseAdmin
    .from('students')
    .select('*')
    .eq('id', studentId)
    .single();
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const options = await generateRegistrationOptions({
    rpName: rpName(),
    rpID: rpID(req),
    userID: Buffer.from(studentId),
    userName: student.email,
    userDisplayName: student.full_name,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
      authenticatorAttachment: 'platform',
    },
  });

  await saveChallenge(`reg:${studentId}`, options.challenge);
  res.json(options);
});

router.post('/register-verify', requireAuth, async (req, res) => {
  const studentId = req.user.sub;
  const expectedChallenge = await getChallenge(`reg:${studentId}`);
  if (!expectedChallenge) {
    return res.status(400).json({ error: 'Challenge expired. Please start registration again.' });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: origin(req),
      expectedRPID: rpID(req),
    });

  } catch (err) {
    console.log('register-verify error:', err.message);
    return res.status(400).json({ error: 'Device registration failed: ' + err.message });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return res.status(400).json({ error: 'Device registration failed.' });
  }

  // credentialID from registrationInfo is a Uint8Array.
  // The browser sends assertion.id as a base64url string derived from the same bytes.
  // We MUST store it in the exact same format the browser will send back.
  // The safest source is req.body.id — this is the base64url string the browser already computed.
  const credId = req.body.id; // always a base64url string, directly from browser
  const credPubKey  = verification.registrationInfo.credentialPublicKey;
  const credCounter = verification.registrationInfo.counter ?? 0;
  const credTransports = req.body?.response?.transports ?? [];

  console.log('register-verify: storing credential id from req.body.id:', credId);

  if (!credId || !credPubKey) {
    return res.status(500).json({ error: 'Could not extract credential data.' });
  }

  // Revoke any old active devices before inserting new one
  await supabaseAdmin
    .from('devices')
    .update({ revoked_at: new Date().toISOString() })
    .eq('student_id', studentId)
    .is('revoked_at', null);

  const { error: insertErr } = await supabaseAdmin.from('devices').insert({
    student_id: studentId,
    webauthn_credential_id: credId,
    public_key: Buffer.from(credPubKey).toString('base64url'),
    counter: credCounter,
    transports: credTransports,
    status: 'PENDING', // Admin must authorize before student can clock in
    ip_address: req.ip || req.headers['x-forwarded-for'] || null,
    user_agent: req.headers['user-agent'] || null,
    last_seen_at: new Date().toISOString(),
  });

  if (insertErr) {
    console.error('register-verify: insert error', insertErr);
    return res.status(500).json({ error: 'Could not save device.' });
  }

  await deleteChallenge(`reg:${studentId}`);
  const sessionToken = signSession({ studentId, role: 'student' });
  res.json({ verified: true, sessionToken });
});

// ── Login ─────────────────────────────────────────────────────────────────────

router.post('/login-challenge', async (req, res) => {
  const { student_id } = req.body || {};
  if (!student_id) return res.status(400).json({ error: 'student_id is required.' });

  const cleanId = String(student_id).trim();
  const generic = { error: "Please, you're not a student here." };

  let { data: student } = await supabaseAdmin
    .from('students')
    .select('id, status, student_id')
    .eq('student_id', cleanId)
    .single();

  if (!student) {
    const { data: allStudents } = await supabaseAdmin
      .from('students')
      .select('id, status, student_id');
    if (allStudents && allStudents.length > 0) {
      student = allStudents.find(
        (s) => s.student_id && s.student_id.trim().toLowerCase() === cleanId.toLowerCase()
      );
    }
  }

  if (!student || (student.status && student.status === 'suspended')) {
    console.log('login-challenge: student not found or suspended', { cleanId });
    return res.status(403).json(generic);
  }

  const { data: devices } = await supabaseAdmin
    .from('devices')
    .select('webauthn_credential_id, transports, status')
    .eq('student_id', student.id)
    .is('revoked_at', null);

  if (!devices || devices.length === 0) {
    console.log('login-challenge: no devices found for', cleanId);
    return res.status(403).json(generic);
  }

  console.log('login-challenge: found devices', devices.map(d => d.webauthn_credential_id));

  const options = await generateAuthenticationOptions({
    rpID: rpID(req),
    userVerification: 'required',
    allowCredentials: devices.map((d) => ({
      id: d.webauthn_credential_id,
      transports: d.transports || undefined,
    })),
  });

  await saveChallenge(`login:${student.id}`, options.challenge);
  res.json({ ...options, internalStudentId: student.id });
});

router.post('/login-verify', async (req, res) => {
  const { internalStudentId, assertion } = req.body || {};
  const generic = { error: "Please, you're not a student here." };

  if (!assertion?.id) {
    return res.status(400).json({ error: 'Invalid assertion.' });
  }

  const expectedChallenge = await getChallenge(`login:${internalStudentId}`);
  if (!expectedChallenge) {
    console.log('login-verify: challenge expired or not found for', internalStudentId);
    return res.status(403).json({ error: 'Challenge expired. Please tap "Sign in with device" again.' });
  }

  console.log('login-verify: browser credential id:', assertion.id);

  const { data: device } = await supabaseAdmin
    .from('devices')
    .select('*')
    .eq('webauthn_credential_id', assertion.id)
    .is('revoked_at', null)
    .single();

  if (!device) {
    console.log('login-verify: no device found for credential id', assertion.id);
    await supabaseAdmin.from('audit_log').insert({
      student_id: internalStudentId,
      event_type: 'device_mismatch',
      detail: { credential_id: assertion.id },
    });
    return res.status(403).json(generic);
  }

  if (device.student_id !== internalStudentId) {
    console.log('login-verify: device belongs to different student');
    return res.status(403).json(generic);
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge,
      expectedOrigin: origin(req),
      expectedRPID: rpID(req),
      credential: {

        id: device.webauthn_credential_id,
        publicKey: Buffer.from(device.public_key, 'base64url'),
        counter: device.counter,
        transports: device.transports || undefined,
      },
    });
  } catch (err) {
    console.log('login-verify: threw', err.message);
    return res.status(403).json({ error: 'Verification failed. Please try again.' });
  }

  if (!verification.verified) {
    console.log('login-verify: not verified');
    return res.status(403).json(generic);
  }

  await supabaseAdmin
    .from('devices')
    .update({
      counter: verification.authenticationInfo.newCounter,
      last_seen_at: new Date().toISOString(),
      ip_address: req.ip || req.headers['x-forwarded-for'] || null,
    })
    .eq('id', device.id);

  await deleteChallenge(`login:${internalStudentId}`);
  const sessionToken = signSession({ studentId: internalStudentId, role: 'student' });
  res.json({ verified: true, sessionToken, deviceId: device.id });
});

module.exports = router;
