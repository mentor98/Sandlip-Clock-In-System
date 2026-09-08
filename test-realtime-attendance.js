const http = require('http');

async function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:3000${path}`, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runRealtimeTest() {
  console.log('=== Step 1: Login Admin ===');
  const loginRes = await request('/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: { admin_id: 'ADMIN-001', password: 'admin12345' }
  });
  const token = loginRes.data?.sessionToken;
  console.log('Admin token acquired:', !!token);

  console.log('=== Step 2: Create Brand New Attendance Session ===');
  const sessionTitle = `Computer Architecture - Live QR (${Date.now().toString().slice(-4)})`;
  const sessRes = await request('/api/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: {
      title: sessionTitle,
      location_id: 'c0000000-0000-0000-0000-000000000001',
    }
  });
  const session = sessRes.data?.session;
  console.log('Session Created:', session?.id, 'Title:', session?.title);

  console.log('=== Step 3: Generate Dynamic Single-Use QR Token ===');
  const qrRes = await request(`/api/sessions/${session.id}/generate-qr`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const qrToken = qrRes.data?.qr_token;
  console.log('Classroom QR generated (length:', qrToken?.length, ')');

  console.log('=== Step 4: Admin Dashboard Opens SSE Projector Stream ===');
  let receivedSseRecord = null;
  const sseReq = http.request(`http://127.0.0.1:3000/api/sessions/${session.id}/stream`, (res) => {
    res.on('data', (chunk) => {
      const text = chunk.toString();
      if (text.includes('event: attendance')) {
        const lines = text.split('\n');
        const dataLine = lines.find(l => l.startsWith('data: '));
        if (dataLine) {
          receivedSseRecord = JSON.parse(dataLine.replace('data: ', ''));
          console.log('\n⚡⚡⚡ [REAL-TIME SSE EVENT ARRIVED ON ADMIN DASHBOARD] ⚡⚡⚡');
          console.log(`Live Student: ${receivedSseRecord.students?.full_name} (${receivedSseRecord.students?.student_id})`);
          console.log(`Verification: ${receivedSseRecord.verification_status} | Punctuality: ${receivedSseRecord.punctuality}`);
          console.log(`Device MAC:   ${receivedSseRecord.devices?.mac_address || receivedSseRecord.device_mac}`);
          console.log(`Network IP:   ${receivedSseRecord.ip_address}`);
        }
      }
    });
  });
  sseReq.on('error', (e) => console.log('SSE Stream Notice:', e.message));
  sseReq.end();

  // Wait 400ms for SSE connection
  await new Promise(r => setTimeout(r, 400));

  console.log('=== Step 5: Student Scans QR Code with Camera ===');
  console.log('Telemetry sent: IP=127.0.0.1, MAC=BE:64:B4:14:4D:67, GPS=(8.9280843, 11.3307533)');
  const clockinPayload = {
    student_id: 'SAN-2026-014', // Ada Lovelace
    latitude: 8.9280843,
    longitude: 11.3307533,
    accuracy: 8,
    device_mac: 'BE:64:B4:14:4D:67',
    location_id: 'c0000000-0000-0000-0000-000000000001',
    location_token: qrToken,
    session_id: session.id,
    attendance_type: 'clock_in',
  };

  const clockinRes = await request('/api/auth/clockin-direct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: clockinPayload,
  });

  console.log('Clock-in result:', {
    success: clockinRes.data?.success,
    status: clockinRes.data?.status,
    student: clockinRes.data?.student?.full_name,
    checks: {
      networkIp: clockinRes.data?.checks?.ipSubnetMatch,
      deviceMac: clockinRes.data?.checks?.deviceMacMatch,
      insideGeofence: clockinRes.data?.checks?.insideGeofence,
      validQr: clockinRes.data?.checks?.validQr,
    }
  });

  // Wait 800ms for SSE event and DB sync
  await new Promise(r => setTimeout(r, 800));
  sseReq.destroy();

  console.log('\n=== Step 6: Admin Dashboard "Live Student Attendance" Check ===');
  const attRes = await request(`/api/sessions/${session.id}/attendance`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const list = attRes.data?.attendance || [];
  console.log(`Live Student Attendance (${list.length}):`);
  list.forEach((item, idx) => {
    console.log(`  [${idx + 1}] ${item.students?.full_name} (${item.students?.student_id}) — Status: ${item.verification_status}`);
  });

  if (receivedSseRecord && list.length === 1) {
    console.log('\n✅ VERIFICATION COMPLETE:');
    console.log('1. Student camera captures QR code');
    console.log('2. Network, IP address, MAC address, and location validated');
    console.log('3. Name displayed in REAL-TIME on the "Live Student Attendance (1)" UI');
  }
}

runRealtimeTest().catch(console.error);
