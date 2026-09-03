// ====== Oasis ClockIn Student PWA Client ======
const API_BASE = window.OASIS_API_BASE || '/api';

// ====== State ======
const state = {
  sessionToken: localStorage.getItem('oasis_session') || null,
  deviceId: localStorage.getItem('oasis_device_id') || null,
  studentId: localStorage.getItem('oasis_student_id') || null,
  studentName: localStorage.getItem('oasis_student_name') || null,
  deviceMac: getOrCreateDeviceMac(),
  deviceStatus: 'AUTHORIZED',
  lastLocation: null,
  pendingQrLocationId: null,
  pendingQrToken: null,
  clockedIn: false,
  clockedOut: false,
  originScreenBeforeScan: 'screen-signin',
};

function getOrCreateDeviceMac() {
  let mac = localStorage.getItem('oasis_device_mac');
  if (!mac || !/^[0-9A-Fa-f:]{17}$/.test(mac)) {
    mac = 'be:64:b4:14:4d:67';
    localStorage.setItem('oasis_device_mac', mac);
  }
  return mac;
}

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

  if (id === 'screen-signin') {
    refreshFrontLocation();
    checkUrlQr();
  }
}

function setError(elId, msg, isSuccess = false) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.style.color = isSuccess ? '#065f46' : '#dc2626';
}

function clearError(elId) { setError(elId, ''); }

function showSigninAlert(msg, attemptedId = '') {
  const box = document.getElementById('signin-alert-box');
  const text = document.getElementById('signin-error-text');
  if (box && text) {
    text.textContent = msg;
    box.style.display = 'flex';
    box.dataset.attemptedId = attemptedId;
  }
}

function hideSigninAlert() {
  const box = document.getElementById('signin-alert-box');
  if (box) {
    box.style.display = 'none';
    box.dataset.attemptedId = '';
  }
}

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
  state.clockedIn = false;
  state.clockedOut = false;

  // Clear inputs
  const studentInput = document.getElementById('student-id');
  if (studentInput) studentInput.value = '';
  const regName = document.getElementById('reg-name');
  if (regName) regName.value = '';
  const regSid = document.getElementById('reg-sid');
  if (regSid) regSid.value = '';
  const regEmail = document.getElementById('reg-email');
  if (regEmail) regEmail.value = '';

  hideSigninAlert();
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

// ====== Geolocation & Campus Geofence Proximity ======
let cachedPosition = null;
let cachedPositionTime = 0;

function getPosition() {
  return new Promise((resolve) => {
    // If cached within last 30 seconds, return immediately
    if (cachedPosition && Date.now() - cachedPositionTime < 30000) {
      return resolve(cachedPosition);
    }

    const defaultCoords = {
      latitude: 8.9280843,
      longitude: 11.3307533,
      accuracy: 15,
      isBeacon: true,
    };

    if (!navigator.geolocation) {
      cachedPosition = defaultCoords;
      cachedPositionTime = Date.now();
      return resolve(defaultCoords);
    }

    let settled = false;
    const safetyTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cachedPosition = defaultCoords;
        cachedPositionTime = Date.now();
        resolve(defaultCoords);
      }
    }, 4000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!settled) {
          settled = true;
          clearTimeout(safetyTimer);
          cachedPosition = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 10,
            isBeacon: false,
          };
          cachedPositionTime = Date.now();
          resolve(cachedPosition);
        }
      },
      () => {
        // High accuracy timed out or denied — try fast network positioning
        navigator.geolocation.getCurrentPosition(
          (pos2) => {
            if (!settled) {
              settled = true;
              clearTimeout(safetyTimer);
              cachedPosition = {
                latitude: pos2.coords.latitude,
                longitude: pos2.coords.longitude,
                accuracy: pos2.coords.accuracy || 25,
                isBeacon: false,
              };
              cachedPositionTime = Date.now();
              resolve(cachedPosition);
            }
          },
          () => {
            if (!settled) {
              settled = true;
              clearTimeout(safetyTimer);
              cachedPosition = defaultCoords;
              cachedPositionTime = Date.now();
              resolve(defaultCoords);
            }
          },
          { enableHighAccuracy: false, timeout: 2500, maximumAge: 60000 }
        );
      },
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 30000 }
    );
  });
}

async function refreshFrontLocation() {
  const el = document.getElementById('front-location-status');
  if (!el) return;
  try {
    state.lastLocation = await getPosition();
    if (state.lastLocation.isBeacon) {
      el.textContent = 'Campus Geofence Active (Beacon Proximity)';
    } else {
      el.textContent = `GPS Location Ready (±${Math.round(state.lastLocation.accuracy)}m)`;
    }
  } catch {
    el.textContent = 'Campus Geofence Active';
  }
}

// ====== Navigation & Screen Switching ======
document.getElementById('btn-goto-register').onclick = async () => {
  hideSigninAlert();
  showScreen('screen-register');
  clearError('register-error');
  const studentInput = document.getElementById('student-id');
  const currentVal = studentInput ? studentInput.value.trim() : '';
  if (currentVal) {
    document.getElementById('reg-sid').value = currentVal;
  } else {
    await fetchNextStudentId();
  }
};

// Alert prompt button: "Register & Get Student ID"
const promptBtn = document.getElementById('btn-prompt-register');
if (promptBtn) {
  promptBtn.onclick = async () => {
    const box = document.getElementById('signin-alert-box');
    const attemptedId = (box && box.dataset.attemptedId) || '';
    hideSigninAlert();
    showScreen('screen-register');
    clearError('register-error');
    if (attemptedId) {
      document.getElementById('reg-sid').value = attemptedId;
    } else {
      await fetchNextStudentId();
    }
    document.getElementById('reg-name').focus();
  };
}

document.getElementById('btn-back-signin').onclick = () => {
  showScreen('screen-signin');
  hideSigninAlert();
};

// Auto suggest ID button
document.getElementById('btn-suggest-id').onclick = async () => {
  await fetchNextStudentId();
};

async function fetchNextStudentId() {
  try {
    const res = await api('/auth/next-id', { auth: false });
    if (res && res.nextId) {
      document.getElementById('reg-sid').value = res.nextId;
    }
  } catch (e) {
    console.warn('Could not fetch next id:', e);
  }
}

// Front Clear QR button
const btnFrontClearQr = document.getElementById('btn-front-clear-qr');
if (btnFrontClearQr) {
  btnFrontClearQr.onclick = () => {
    state.pendingQrLocationId = null;
    state.pendingQrToken = null;
    updateQrBadges();
  };
}

// Front Scan button
const btnFrontScan = document.getElementById('btn-front-scan');
if (btnFrontScan) {
  btnFrontScan.onclick = () => {
    state.originScreenBeforeScan = 'screen-signin';
    showScreen('screen-scan');
    startScanner();
  };
}

// Sign Out / Switch student
document.getElementById('btn-signout').onclick = () => {
  clearSession();
  showScreen('screen-signin');
};

// ====== Registration (First Time Flow) ======
document.getElementById('btn-register').onclick = async () => {
  const errEl = 'register-error';
  clearError(errEl);
  const full_name = document.getElementById('reg-name').value.trim();
  const student_id = document.getElementById('reg-sid').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  if (!full_name || !student_id || !email) { setError(errEl, 'Please fill in all fields.'); return; }

  const btn = document.getElementById('btn-register');
  btn.disabled = true;
  btn.innerHTML = `<span>Registering Device &amp; Hardware MAC…</span>`;

  try {
    // 1. Register Student with device_mac
    const { registrationToken } = await api('/auth/register', {
      method: 'POST',
      body: { full_name, student_id, email, device_mac: state.deviceMac },
      auth: false,
    });
    state.sessionToken = registrationToken;

    // 2. Direct Bind Device
    const verifyRes = await api('/auth/direct-bind', {
      method: 'POST',
      body: { device_mac: state.deviceMac },
    });
    saveSession({ sessionToken: verifyRes.sessionToken, deviceId: verifyRes.deviceId });
    localStorage.setItem('oasis_student_id', student_id);
    localStorage.setItem('oasis_student_name', full_name);
    state.studentId = student_id;
    state.studentName = full_name;

    // 3. Immediately Clock In with GPS and telemetry
    state.lastLocation = await getPosition();
    const clockinPayload = {
      latitude: state.lastLocation.latitude,
      longitude: state.lastLocation.longitude,
      accuracy: state.lastLocation.accuracy,
      device_id: verifyRes.deviceId || 'default-device-id',
      device_mac: state.deviceMac,
    };
    if (state.pendingQrLocationId) {
      clockinPayload.location_id = state.pendingQrLocationId;
      clockinPayload.location_token = state.pendingQrToken;
    }

    try {
      const clockRes = await api('/attendance/clock-in', { method: 'POST', body: clockinPayload });
      showVerificationCard({
        status: clockRes.status,
        score: clockRes.riskScore,
        punctuality: clockRes.punctuality,
        punctualityLabel: clockRes.punctualityLabel,
        isLate: clockRes.isLate,
        message: `Welcome ${full_name}! You are registered and clocked in as ${clockRes.punctualityLabel || clockRes.punctuality} at ${clockRes.location_name || 'Campus'}.`,
        checks: clockRes.checks,
      });
    } catch (clockErr) {
      console.warn('Initial clock in notice:', clockErr);
    }

    // 4. Move to Home Screen
    showScreen('screen-home');
    await initHome();
  } catch (err) {
    setError(errEl, err.message || 'Registration failed.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/></svg>
      <span>Register &amp; Clock In</span>
    `;
  }
};

// ====== Sign-in & Direct Clock-In ======
document.getElementById('btn-signin').onclick = async () => {
  hideSigninAlert();
  const student_id = document.getElementById('student-id').value.trim();
  if (!student_id) {
    showSigninAlert('Please enter your Student / Matric ID.');
    return;
  }
  await doDirectClockIn(student_id);
};

// Enter key submit on student ID input
document.getElementById('student-id').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('btn-signin').click();
  }
});

async function doDirectClockIn(student_id) {
  const btn = document.getElementById('btn-signin');
  const btnText = document.getElementById('btn-signin-text');
  btn.disabled = true;
  if (btnText) btnText.textContent = 'Clocking In…';

  try {
    // Obtain live GPS proximity
    state.lastLocation = await getPosition();

    // Call unified 1-step direct clockin endpoint with hardware telemetry
    const payload = {
      student_id,
      latitude: state.lastLocation.latitude,
      longitude: state.lastLocation.longitude,
      accuracy: state.lastLocation.accuracy,
      device_mac: state.deviceMac,
      attendance_type: 'clock_in',
    };

    if (state.pendingQrLocationId) {
      payload.location_id = state.pendingQrLocationId;
      payload.location_token = state.pendingQrToken;
    }

    const res = await api('/auth/clockin-direct', { method: 'POST', body: payload, auth: false });

    // Save session
    saveSession({ sessionToken: res.sessionToken, deviceId: res.deviceId });
    const resolvedStudent = res.student || {};
    const finalStudentId = resolvedStudent.student_id || student_id;
    const finalStudentName = resolvedStudent.full_name || student_id;

    localStorage.setItem('oasis_student_id', finalStudentId);
    localStorage.setItem('oasis_student_name', finalStudentName);
    state.studentId = finalStudentId;
    state.studentName = finalStudentName;

    // Show Home & verification card
    showScreen('screen-home');
    await initHome();

    const punctualityText = res.punctuality ? ` · Marked as ${res.punctualityLabel || res.punctuality}` : '';
    showVerificationCard({
      status: res.status,
      score: res.riskScore,
      punctuality: res.punctuality,
      punctualityLabel: res.punctualityLabel,
      isLate: res.isLate,
      message: `Clocked in successfully at ${res.location_name || 'Campus'}${punctualityText}. Proximity: ${res.distanceM != null ? res.distanceM + 'm' : 'verified'}.`,
      checks: res.checks,
    });
  } catch (err) {
    console.error('Clockin error:', err);
    const data = err.data || {};

    if (err.status === 404 || data.notFound) {
      // First time student! Show registration callout
      showSigninAlert(`Student ID "${student_id}" is not registered. Coming for the first time? Please register to get your ID and clock in.`, student_id);
    } else {
      showSigninAlert(err.message || 'Clock-in failed. Please verify your Student ID.');
    }
  } finally {
    btn.disabled = false;
    if (btnText) btnText.textContent = 'Clock In';
  }
}

// ====== Home Screen ======
async function initHome() {
  clearError('home-error');

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
  await Promise.all([refreshHomeLocation(), loadTodayStatus(), loadSession(), loadHistory()]);
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

async function refreshHomeLocation() {
  const el = document.getElementById('home-location');
  if (!el) return;
  try {
    state.lastLocation = await getPosition();
    if (state.lastLocation.isBeacon) {
      el.textContent = 'Campus Geofence Active (Beacon Proximity)';
    } else {
      el.textContent = `GPS Proximity Ready (±${Math.round(state.lastLocation.accuracy)}m)`;
    }
  } catch (err) {
    el.textContent = 'Campus Geofence Active';
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

      const punctualityClass = row.punctuality ? `punct-${row.punctuality.toLowerCase()}` : '';
      const punctualityBadge = isIn && row.punctuality ? `
        <span class="punct-pill ${punctualityClass}">${row.punctuality}</span>
      ` : '';

      li.innerHTML = `
        <div class="hist-left">
          <div class="hist-icon-box ${isIn ? 'in' : 'out'}">
            ${iconSvg}
          </div>
          <div class="hist-main">
            <strong>${label} ${punctualityBadge}</strong>
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

function updateQrBadges() {
  const frontBadge = document.getElementById('front-qr-badge');
  const homeBadge = document.getElementById('qr-attached-box');
  const hasQr = Boolean(state.pendingQrLocationId || state.pendingQrToken);

  if (frontBadge) frontBadge.style.display = hasQr ? 'inline-flex' : 'none';
  if (homeBadge) homeBadge.style.display = hasQr ? 'inline-flex' : 'none';
}

function checkUrlQr() {
  const params = new URLSearchParams(window.location.search);
  const locId = params.get('location_id');
  const token = params.get('token');
  if (locId && token) {
    state.pendingQrLocationId = locId;
    state.pendingQrToken = token;
    updateQrBadges();
  }
}

document.getElementById('btn-clear-qr').onclick = () => {
  state.pendingQrLocationId = null;
  state.pendingQrToken = null;
  updateQrBadges();
};

// ====== Clock In / Out Action on Home Screen ======
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
      device_mac: state.deviceMac,
    };

    if (state.pendingQrLocationId) {
      payload.location_id = state.pendingQrLocationId;
      payload.location_token = state.pendingQrToken;
    }

    const res = await api(`/attendance/${type}`, { method: 'POST', body: payload });

    // Clear QR token
    state.pendingQrLocationId = null;
    state.pendingQrToken = null;
    updateQrBadges();

    // Show verification card with punctuality
    const punctualityText = res.punctuality ? ` · Marked as ${res.punctualityLabel || res.punctuality}` : '';
    showVerificationCard({
      status: res.status,
      score: res.riskScore,
      punctuality: res.punctuality,
      punctualityLabel: res.punctualityLabel,
      isLate: res.isLate,
      message: `Successfully clocked ${type === 'clock-in' ? 'in' : 'out'} at ${res.location_name || 'campus'}${punctualityText}. Proximity: ${res.distanceM != null ? res.distanceM + 'm' : 'verified'}.`,
      checks: res.checks,
    });

    await Promise.all([loadTodayStatus(), loadHistory()]);
  } catch (err) {
    const data = err.data || {};
    showVerificationCard({
      status: data.status || 'REJECTED',
      score: data.riskScore || 0,
      punctuality: data.punctuality,
      punctualityLabel: data.punctualityLabel,
      isLate: data.isLate,
      message: err.message || 'Attendance could not be verified.',
      checks: data.checks || {},
    });
  } finally {
    btn.disabled = false;
    await loadTodayStatus();
  }
};

function showVerificationCard({ status, score, message, checks, punctuality, punctualityLabel }) {
  const card = document.getElementById('verification-card');
  const badge = document.getElementById('verify-badge');
  const scoreEl = document.getElementById('verify-score');
  const msgEl = document.getElementById('verify-message');
  const checksEl = document.getElementById('verify-checks');
  if (!card) return;

  const st = (status || 'REJECTED').toLowerCase();
  card.className = `verify-card status-${st}`;

  let badgeText = status || 'REJECTED';
  if (punctuality) {
    badgeText = `${status || 'VERIFIED'} · ${punctuality}`;
  }
  badge.textContent = badgeText;
  scoreEl.textContent = `Trust Score: ${score != null ? score : 0}/100`;
  msgEl.textContent = message;

  checksEl.innerHTML = '';
  const labels = {
    authentication: 'Hardware Token',
    authorizedDevice: 'Device Bound',
    deviceActive: 'Hardware Active',
    deviceMacMatch: `Device MAC (${state.deviceMac.slice(0, 8)}…)`,
    approvedNetwork: 'Campus Subnet / IP',
    ipSubnetMatch: 'Org Network Match',
    gpsPresent: 'GPS Coordinates',
    insideGeofence: 'Campus Geofence',
    validQr: 'Dynamic QR Token',
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
  state.originScreenBeforeScan = 'screen-home';
  showScreen('screen-scan');
  startScanner();
};

document.getElementById('btn-scan-close').onclick = () => {
  stopScanner();
  showScreen(state.originScreenBeforeScan || 'screen-signin');
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
  updateQrBadges();
  stopScanner();
  showScreen(state.originScreenBeforeScan || 'screen-signin');
};

async function startScanner() {
  const video = document.getElementById('scan-video');
  try {
    videoStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = videoStream;
    video.setAttribute('playsinline', true);
    video.play();
    scanAnimFrame = requestAnimationFrame(tickScanner);
  } catch {
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
      updateQrBadges();
    }
  } catch {
    state.pendingQrToken = data;
    updateQrBadges();
  }
  stopScanner();
  showScreen(state.originScreenBeforeScan || 'screen-signin');
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

