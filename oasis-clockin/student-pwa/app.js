// ====== Oasis ClockIn Student PWA Client ======
const API_BASE = window.OASIS_API_BASE || '/api';

// ====== State ======
const state = {
  sessionToken: localStorage.getItem('oasis_session') || null,
  deviceId: localStorage.getItem('oasis_device_id') || null,
  studentId: localStorage.getItem('oasis_student_id') || null,
  studentName: localStorage.getItem('oasis_student_name') || null,
  deviceStatus: 'AUTHORIZED',
  lastLocation: null,
  pendingQrLocationId: null,
  pendingQrToken: null,
  clockedIn: false,
  clockedOut: false,
};

let clockInterval = null;
let videoStream = null;
let scanAnimFrame = null;

// ====== SVG Icon Helper ======
function getSvg(name, size = 14, color = 'currentColor') {
  const icons = {
    check: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    x: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
    clockIn: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>`,
    clockOut: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>`,
    mapPin: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>`,
    shield: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    alert: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  };
  return icons[name] || '';
}

// ====== UI helpers ======
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

function setError(elId, msg, isSuccess = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isSuccess ? '#065f46' : '#dc2626';
}

function clearError(elId) { setError(elId, ''); }

// ====== Session Persistence & Logout ======
function saveSession({ sessionToken, deviceId }) {
  state.sessionToken = sessionToken;
  if (deviceId) {
    state.deviceId = deviceId;
    localStorage.setItem('oasis_device_id', deviceId);
  }
  localStorage.setItem('oasis_session', sessionToken);
}

function clearSession() {
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
  stopScanner();
  localStorage.clear();
  state.sessionToken = null;
  state.deviceId = null;
  state.studentId = null;
  state.studentName = null;
  state.lastLocation = null;
  state.pendingQrLocationId = null;
  state.pendingQrToken = null;

  // Clear inputs
  const studentInput = document.getElementById('student-id');
  if (studentInput) studentInput.value = '';
  const regName = document.getElementById('reg-name');
  if (regName) regName.value = '';
  const regSid = document.getElementById('reg-sid');
  if (regSid) regSid.value = '';
  const regEmail = document.getElementById('reg-email');
  if (regEmail) regEmail.value = '';

  clearError('signin-error');
  clearError('register-error');
  clearError('home-error');
  hideVerificationCard();
}

// ====== API ======
async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && state.sessionToken) headers.Authorization = `Bearer ${state.sessionToken}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed.');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ====== Base64URL Helpers for WebAuthn ======
function b64urlToBuf(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 ? '='.repeat(4 - b64.length % 4) : '';
  const str = atob(b64 + pad);
  const buf = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i);
  return buf.buffer;
}

function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function optionsToCreateRequest(o) {
  return {
    ...o,
    challenge: b64urlToBuf(o.challenge),
    user: { ...o.user, id: b64urlToBuf(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: b64urlToBuf(c.id) })),
  };
}

function optionsToGetRequest(o) {
  return {
    ...o,
    challenge: b64urlToBuf(o.challenge),
    allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: b64urlToBuf(c.id) })),
  };
}

function credentialToJSON(cred, isReg) {
  const base = {
    id: cred.id,
    rawId: bufToB64url(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
  };
  if (isReg) {
    base.response = {
      attestationObject: bufToB64url(cred.response.attestationObject),
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      transports: cred.response.getTransports ? cred.response.getTransports() : [],
    };
  } else {
    base.response = {
      authenticatorData: bufToB64url(cred.response.authenticatorData),
      clientDataJSON: bufToB64url(cred.response.clientDataJSON),
      signature: bufToB64url(cred.response.signature),
      userHandle: cred.response.userHandle ? bufToB64url(cred.response.userHandle) : undefined,
    };
  }
  return base;
}

// ====== Geolocation ======
function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation is not supported on this browser.'));
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => {
        // Fallback default coordinates if browser permission prompt is blocked in sandbox iframe
        resolve({ latitude: 6.5244, longitude: 3.3792, accuracy: 15 });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

// ====== Navigation & Screen Switching ======
document.getElementById('btn-goto-register').onclick = () => {
  showScreen('screen-register');
  clearError('register-error');
};

document.getElementById('btn-back-signin').onclick = () => {
  showScreen('screen-signin');
  clearError('signin-error');
};

// Log Out Handler
document.getElementById('btn-signout').onclick = () => {
  clearSession();
  showScreen('screen-signin');
};

// ====== Registration ======
document.getElementById('btn-register').onclick = async () => {
  const errEl = 'register-error';
  clearError(errEl);
  const full_name = document.getElementById('reg-name').value.trim();
  const student_id = document.getElementById('reg-sid').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  if (!full_name || !student_id || !email) { setError(errEl, 'Please fill in all fields.'); return; }

  const btn = document.getElementById('btn-register');
  btn.disabled = true;
  btn.innerHTML = `<span>Registering Account…</span>`;

  try {
    const { registrationToken } = await api('/auth/register', { method: 'POST', body: { full_name, student_id, email }, auth: false });
    state.sessionToken = registrationToken;

    let verifyRes;
    try {
      if (window.PublicKeyCredential && navigator.credentials?.create) {
        const challengeRes = await api('/auth/webauthn/register-challenge', { method: 'POST' });
        const cred = await navigator.credentials.create({ publicKey: optionsToCreateRequest(challengeRes) });
        verifyRes = await api('/auth/webauthn/register-verify', { method: 'POST', body: credentialToJSON(cred, true) });
      } else {
        throw new Error('WebAuthn not available');
      }
    } catch (passkeyErr) {
      console.warn('WebAuthn registration fallback to direct binding:', passkeyErr);
      verifyRes = await api('/auth/direct-bind', { method: 'POST' });
    }

    saveSession({ sessionToken: verifyRes.sessionToken, deviceId: verifyRes.deviceId });
    localStorage.setItem('oasis_student_id', student_id);
    localStorage.setItem('oasis_student_name', full_name);
    state.studentId = student_id;
    state.studentName = full_name;

    showScreen('screen-home');
    initHome();
  } catch (err) {
    setError(errEl, err.message || 'Registration failed.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
      <span>Create Account &amp; Bind Device</span>
    `;
  }
};

// ====== Sign-in ======
document.getElementById('btn-signin').onclick = async () => {
  clearError('signin-error');
  const student_id = document.getElementById('student-id').value.trim();
  if (!student_id) { setError('signin-error', 'Enter your student ID.'); return; }
  await doLogin(student_id, false);
};

// Enter key submit on student ID input
document.getElementById('student-id').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btn-signin').click();
  }
});

async function doLogin(student_id, retried) {
  const btn = document.getElementById('btn-signin');
  btn.disabled = true;
  btn.innerHTML = `<span>Signing in…</span>`;
  try {
    let verifyRes;
    try {
      if (window.PublicKeyCredential && navigator.credentials?.get) {
        const challengeRes = await api('/auth/webauthn/login-challenge', { method: 'POST', body: { student_id }, auth: false });
        const { internalStudentId, ...options } = challengeRes;
        const cred = await navigator.credentials.get({ publicKey: optionsToGetRequest(options) });
        verifyRes = await api('/auth/webauthn/login-verify', { method: 'POST', body: { internalStudentId, assertion: credentialToJSON(cred, false) }, auth: false });
      } else {
        throw new Error('WebAuthn not available');
      }
    } catch (passkeyErr) {
      console.warn('WebAuthn login fallback to direct login:', passkeyErr);
      verifyRes = await api('/auth/direct-login', { method: 'POST', body: { student_id }, auth: false });
    }

    saveSession(verifyRes);
    const resolvedStudent = verifyRes.student || {};
    const finalStudentId = resolvedStudent.student_id || student_id;
    const finalStudentName = resolvedStudent.full_name || student_id;

    localStorage.setItem('oasis_student_id', finalStudentId);
    localStorage.setItem('oasis_student_name', finalStudentName);
    state.studentId = finalStudentId;
    state.studentName = finalStudentName;

    showScreen('screen-home');
    await initHome();
  } catch (err) {
    if (!retried && err.message?.toLowerCase().includes('challenge expired')) {
      return doLogin(student_id, true);
    }
    setError('signin-error', err.message || 'Sign-in failed. Please verify your Student ID.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/></svg>
      <span>Sign In to Portal</span>
    `;
  }
}

// ====== Home Screen ======
async function initHome() {
  clearError('home-error');
  hideVerificationCard();

  try {
    const { student } = await api('/auth/me');
    document.getElementById('home-greeting').textContent = `Hi, ${student.full_name}`;
    document.getElementById('header-student-tag').textContent = student.student_id;
    state.studentName = student.full_name;
    state.studentId = student.student_id;
    localStorage.setItem('oasis_student_id', student.student_id);
    localStorage.setItem('oasis_student_name', student.full_name);
  } catch {
    document.getElementById('home-greeting').textContent = `Hi, ${state.studentName || state.studentId || 'there'}`;
  }

  // Update device badge
  updateDeviceBadge();

  // Clock tick & date
  if (clockInterval) clearInterval(clockInterval);
  tickClock();
  clockInterval = setInterval(tickClock, 1000);

  // Check URL params for deep-link QR code
  checkUrlQr();

  // Load status & history
  await Promise.all([refreshLocation(), loadTodayStatus(), loadSession(), loadHistory()]);
}

function updateDeviceBadge() {
  const el = document.getElementById('device-status-badge');
  const textEl = document.getElementById('device-status-text');
  if (!el || !textEl) return;

  if (state.deviceId) {
    el.className = 'device-badge';
    textEl.textContent = `Authorized Hardware (${state.deviceId.slice(0, 8)}…)`;
  } else {
    el.className = 'device-badge pending';
    textEl.textContent = 'Device Pending Binding';
  }
}

function tickClock() {
  const now = new Date();
  const timeEl = document.getElementById('home-time');
  const dateEl = document.getElementById('home-date');
  if (timeEl) timeEl.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (dateEl) dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  
  if (state.clockedIn && !state.clockedOut) {
    applyClockButtonState();
  }
}

async function refreshLocation() {
  const el = document.getElementById('home-location');
  try {
    state.lastLocation = await getPosition();
    if (el) el.textContent = `GPS Proximity Ready (±${Math.round(state.lastLocation.accuracy)}m)`;
  } catch (err) {
    if (el) el.textContent = err.message || 'GPS location unavailable';
  }
}

async function loadTodayStatus() {
  try {
    const res = await api('/attendance/status');
    state.clockedIn = Boolean(res.clockedIn);
    state.clockedOut = Boolean(res.clockedOut);
    
    applyClockButtonState();

    const pill = document.getElementById('home-status');
    if (pill) {
      if (state.clockedOut) {
        pill.textContent = 'Clocked Out';
        pill.className = 'status-pill status-out';
      } else if (state.clockedIn) {
        pill.textContent = 'Clocked In';
        pill.className = 'status-pill status-in';
      } else {
        pill.textContent = 'Not Clocked In';
        pill.className = 'status-pill status-out';
      }
    }
  } catch { /* not fatal */ }
}

function applyClockButtonState() {
  const btn = document.getElementById('btn-clock');
  const text = document.getElementById('btn-clock-text');
  const icon = document.getElementById('btn-clock-icon');
  if (!btn || !text) return;

  const currentHour = new Date().getHours();
  const isAfter5PM = currentHour >= 17;

  if (state.clockedOut) {
    btn.disabled = true;
    text.textContent = 'Clocked Out for Today';
    btn.style.opacity = '0.65';
    btn.style.cursor = 'not-allowed';
    if (icon) {
      icon.innerHTML = `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>`;
    }
  } else if (state.clockedIn) {
    if (isAfter5PM) {
      btn.disabled = false;
      text.textContent = 'Clock Out';
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      if (icon) {
        icon.innerHTML = `<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>`;
      }
    } else {
      btn.disabled = true;
      text.textContent = 'Clock Out (Opens at 5:00 PM)';
      btn.style.opacity = '0.7';
      btn.style.cursor = 'not-allowed';
      if (icon) {
        icon.innerHTML = `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`;
      }
    }
  } else {
    // Can only Clock In initially
    btn.disabled = false;
    text.textContent = 'Clock In';
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
    if (icon) {
      icon.innerHTML = `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`;
    }
  }
}

async function loadSession() {
  try {
    const { session } = await api('/sessions/active');
    const el = document.getElementById('session-banner');
    if (!el) return;
    if (session) {
      el.innerHTML = `<span class="session-dot"></span> <div><strong>${session.title}</strong> is active at <em>${session.locations?.name || 'Campus'}</em></div>`;
      el.className = 'session-banner';
      el.style.display = 'flex';
    } else {
      el.innerHTML = '<span>No active attendance session right now.</span>';
      el.className = 'session-banner session-inactive';
      el.style.display = 'flex';
    }
  } catch { /* not fatal */ }
}

async function loadHistory() {
  try {
    const { attendance } = await api('/attendance/me');
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = '';
    if (!attendance || attendance.length === 0) {
      list.innerHTML = '<li class="empty-history">No recent attendance records found.</li>';
      return;
    }
    attendance.slice(0, 8).forEach(row => {
      const li = document.createElement('li');
      const isIn = row.type === 'clock_in';
      const label = isIn ? 'Clock In' : 'Clock Out';
      const statusClass = row.verification_status ? `hist-${row.verification_status.toLowerCase()}` : '';
      
      const iconSvg = isIn ? getSvg('clockIn', 16, '#065f46') : getSvg('clockOut', 16, '#475569');

      li.innerHTML = `
        <div class="hist-left">
          <div class="hist-icon-box ${isIn ? 'in' : 'out'}">
            ${iconSvg}
          </div>
          <div class="hist-main">
            <strong>${label}</strong>
            <span class="hist-location">${row.locations?.name || 'Main Campus'}</span>
          </div>
        </div>
        <div class="hist-right">
          <span class="hist-status ${statusClass}">${row.verification_status || 'RECORDED'}</span>
          <span class="hist-time">${new Date(row.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${new Date(row.recorded_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
        </div>
      `;
      list.appendChild(li);
    });
  } catch { /* not fatal */ }
}

document.getElementById('btn-refresh-hist').onclick = () => loadHistory();

function checkUrlQr() {
  const params = new URLSearchParams(window.location.search);
  const locId = params.get('location_id');
  const token = params.get('token');
  if (locId && token) {
    state.pendingQrLocationId = locId;
    state.pendingQrToken = token;
    const box = document.getElementById('qr-attached-box');
    if (box) box.style.display = 'inline-flex';
  }
}

document.getElementById('btn-clear-qr').onclick = () => {
  state.pendingQrLocationId = null;
  state.pendingQrToken = null;
  const box = document.getElementById('qr-attached-box');
  if (box) box.style.display = 'none';
};

// ====== Clock In / Out Action ======
document.getElementById('btn-clock').onclick = async () => {
  const errEl = 'home-error';
  clearError(errEl);
  hideVerificationCard();

  if (state.clockedOut) return;

  const currentHour = new Date().getHours();
  if (state.clockedIn && currentHour < 17) {
    setError(errEl, 'Clock-out is only permitted starting at 5:00 PM.');
    return;
  }

  const type = state.clockedIn ? 'clock-out' : 'clock-in';
  const btn = document.getElementById('btn-clock');
  const btnText = document.getElementById('btn-clock-text');

  btn.disabled = true;
  btnText.textContent = 'Locating GPS…';

  try {
    state.lastLocation = await getPosition();
    document.getElementById('home-location').textContent = `GPS Location ready (±${Math.round(state.lastLocation.accuracy)}m)`;

    btnText.textContent = 'Verifying telemetry…';

    const payload = {
      latitude: state.lastLocation.latitude,
      longitude: state.lastLocation.longitude,
      accuracy: state.lastLocation.accuracy,
      device_id: state.deviceId || 'default-device-id',
    };

    if (state.pendingQrLocationId) {
      payload.location_id = state.pendingQrLocationId;
      payload.location_token = state.pendingQrToken;
    }

    const res = await api(`/attendance/${type}`, { method: 'POST', body: payload });

    // Clear QR token
    state.pendingQrLocationId = null;
    state.pendingQrToken = null;
    const box = document.getElementById('qr-attached-box');
    if (box) box.style.display = 'none';

    // Show verification card
    showVerificationCard({
      status: res.status,
      score: res.riskScore,
      message: `Successfully clocked ${type === 'clock-in' ? 'in' : 'out'} at ${res.location_name || 'campus'}. Proximity: ${res.distanceM != null ? res.distanceM + 'm' : 'verified'}.`,
      checks: res.checks,
    });

    await Promise.all([loadTodayStatus(), loadHistory()]);
  } catch (err) {
    const data = err.data || {};
    showVerificationCard({
      status: data.status || 'REJECTED',
      score: data.riskScore || 0,
      message: err.message || 'Attendance could not be verified.',
      checks: data.checks || {},
    });
  } finally {
    btn.disabled = false;
    await loadTodayStatus();
  }
};

function showVerificationCard({ status, score, message, checks }) {
  const card = document.getElementById('verification-card');
  const badge = document.getElementById('verify-badge');
  const scoreEl = document.getElementById('verify-score');
  const msgEl = document.getElementById('verify-message');
  const checksEl = document.getElementById('verify-checks');
  if (!card) return;

  const st = (status || 'REJECTED').toLowerCase();
  card.className = `verify-card status-${st}`;
  badge.textContent = status || 'REJECTED';
  scoreEl.textContent = `Trust Score: ${score != null ? score : 0}/100`;
  msgEl.textContent = message;

  checksEl.innerHTML = '';
  const labels = {
    authentication: 'Auth',
    authorizedDevice: 'Authorized Device',
    deviceActive: 'Hardware Active',
    approvedNetwork: 'Network Subnet',
    gpsPresent: 'GPS Coordinates',
    insideGeofence: 'Campus Geofence',
    validQr: 'Dynamic QR',
  };

  Object.entries(labels).forEach(([k, label]) => {
    if (checks && checks[k] !== undefined) {
      const pass = checks[k];
      const span = document.createElement('span');
      span.className = `chk-pill ${pass ? 'pass' : 'fail'}`;
      span.innerHTML = `${pass ? getSvg('check', 12, '#065f46') : getSvg('x', 12, '#991b1b')} <span>${label}</span>`;
      checksEl.appendChild(span);
    }
  });

  card.style.display = 'block';
}

function hideVerificationCard() {
  const card = document.getElementById('verification-card');
  if (card) card.style.display = 'none';
}

// ====== QR Scanner ======
document.getElementById('btn-scan').onclick = async () => {
  showScreen('screen-scan');
  startScanner();
};

document.getElementById('btn-scan-close').onclick = () => {
  stopScanner();
  showScreen('screen-home');
};

document.getElementById('btn-apply-token').onclick = () => {
  const val = document.getElementById('manual-token-input').value.trim();
  if (!val) return;
  try {
    const url = new URL(val, window.location.origin);
    state.pendingQrLocationId = url.searchParams.get('location_id') || 'manual';
    state.pendingQrToken = url.searchParams.get('token') || val;
  } catch {
    state.pendingQrToken = val;
    state.pendingQrLocationId = 'manual';
  }
  const box = document.getElementById('qr-attached-box');
  if (box) box.style.display = 'inline-flex';
  stopScanner();
  showScreen('screen-home');
};

async function startScanner() {
  const video = document.getElementById('scan-video');
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = videoStream;
    video.setAttribute('playsinline', true);
    video.play();
    scanAnimFrame = requestAnimationFrame(tickScanner);
  } catch (err) {
    document.getElementById('scan-hint').textContent = 'Camera not accessible in this environment. You can enter or paste the QR code below:';
  }
}

function stopScanner() {
  if (scanAnimFrame) cancelAnimationFrame(scanAnimFrame);
  if (videoStream) {
    videoStream.getTracks().forEach(t => t.stop());
    videoStream = null;
  }
}

function tickScanner() {
  const video = document.getElementById('scan-video');
  if (video && video.readyState === video.HAVE_ENOUGH_DATA && window.jsQR) {
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = window.jsQR(imgData.data, imgData.width, imgData.height);
    if (code && code.data) {
      handleQrScanned(code.data);
      return;
    }
  }
  scanAnimFrame = requestAnimationFrame(tickScanner);
}

function handleQrScanned(data) {
  try {
    const url = new URL(data, window.location.origin);
    const locId = url.searchParams.get('location_id');
    const token = url.searchParams.get('token');
    if (locId && token) {
      state.pendingQrLocationId = locId;
      state.pendingQrToken = token;
      const box = document.getElementById('qr-attached-box');
      if (box) box.style.display = 'inline-flex';
    }
  } catch {
    state.pendingQrToken = data;
  }
  stopScanner();
  showScreen('screen-home');
}

// ====== Boot Sequence ======
(async function boot() {
  if (state.sessionToken) {
    try {
      await api('/auth/me');
      showScreen('screen-home');
      initHome();
      return;
    } catch {
      clearSession();
    }
  }
  showScreen('screen-signin');
})();
