<script>
  import { onMount, onDestroy } from 'svelte';
  import { api } from './lib/api.js';
  import { subscribeTable } from './lib/realtime.js';
  import Icon from './lib/Icon.svelte';

  let sessions = [];
  let locations = [];
  let error = '';
  let successMsg = '';
  let title = '';
  let locationId = '';
  let endsAt = '';
  let loading = false;
  let viewingSession = null;
  let sessionAttendance = [];

  // Live QR Projector modal state
  let qrSession = null;
  let qrSrc = '';
  let qrExpiry = 0;
  let qrAdminIp = '';
  let qrTimer = null;
  let autoRefreshTimer = null;
  let qrGenerating = false;
  let liveScans = [];
  let autoRotate = true;

  async function load() {
    try {
      const [sessRes, locRes] = await Promise.all([
        api('/sessions'),
        api('/admin/locations'),
      ]);
      sessions = sessRes.sessions || [];
      locations = locRes.locations || [];
    } catch (e) { error = e.message; }
  }
  load();

  const unsub = subscribeTable('attendance', '*', () => {
    if (viewingSession) viewAttendance(viewingSession);
    if (qrSession) loadLiveScans(qrSession);
  });

  onDestroy(() => {
    unsub();
    clearInterval(qrTimer);
    clearInterval(autoRefreshTimer);
  });

  async function startSession() {
    error = ''; successMsg = '';
    if (!title || !locationId) { error = 'Session title and location are required.'; return; }
    loading = true;
    try {
      const res = await api('/sessions', {
        method: 'POST',
        body: { title, location_id: locationId, ends_at: endsAt || null },
      });
      successMsg = `Session "${res.session.title}" started.`;
      const createdSession = res.session;
      title = ''; locationId = ''; endsAt = '';
      await load();
      // Auto open live QR projector for this active session
      openLiveQr(createdSession);
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }

  async function closeSession(s) {
    error = ''; successMsg = '';
    try {
      await api(`/sessions/${s.id}/close`, { method: 'PATCH' });
      successMsg = `Session "${s.title}" closed.`;
      if (qrSession?.id === s.id) closeLiveQr();
      load();
    } catch (e) { error = e.message; }
  }

  async function deleteSession(s) {
    if (!confirm(`Delete session "${s.title}"?`)) return;
    try {
      await api(`/sessions/${s.id}`, { method: 'DELETE' });
      if (qrSession?.id === s.id) closeLiveQr();
      load();
    } catch (e) { error = e.message; }
  }

  async function viewAttendance(s) {
    viewingSession = s;
    try {
      const res = await api(`/sessions/${s.id}/attendance`);
      sessionAttendance = res.attendance || [];
    } catch (e) { error = e.message; }
  }

  async function loadLiveScans(s) {
    try {
      const res = await api(`/sessions/${s.id}/attendance`);
      liveScans = res.attendance || [];
    } catch (e) { console.error(e); }
  }

  async function openLiveQr(s) {
    qrSession = s;
    await generateLiveQr(s);
    await loadLiveScans(s);
  }

  async function generateLiveQr(s) {
    qrGenerating = true;
    error = '';
    clearInterval(qrTimer);
    try {
      const res = await api(`/admin/sessions/${s.id}/generate-qr`, { method: 'POST' });
      qrSrc = `data:image/png;base64,${res.qr_png_base64}`;
      qrExpiry = res.expires_in_seconds || 25;
      qrAdminIp = res.admin_ip || '127.0.0.1';

      qrTimer = setInterval(() => {
        qrExpiry -= 1;
        if (qrExpiry <= 0) {
          clearInterval(qrTimer);
          if (autoRotate && qrSession) {
            generateLiveQr(qrSession);
          } else {
            qrSrc = '';
          }
        }
      }, 1000);
    } catch (e) {
      error = e.message;
    } finally {
      qrGenerating = false;
    }
  }

  function closeLiveQr() {
    clearInterval(qrTimer);
    qrSession = null;
    qrSrc = '';
    qrExpiry = 0;
  }
</script>

<div class="section">
  <!-- Start session form -->
  <div class="form-card">
    <div class="card-title-row">
      <Icon name="play" size={18} color="#0f766e" />
      <h3>Start Attendance Session</h3>
    </div>
    <div class="form-row">
      <div class="field">
        <label>Session Title</label>
        <input bind:value={title} placeholder="e.g. Morning Lecture — Physics 101" />
      </div>
      <div class="field">
        <label>Geofenced Location</label>
        <select bind:value={locationId}>
          <option value="">Select location…</option>
          {#each locations as loc}
            <option value={loc.id}>{loc.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label>Auto-close At (Optional)</label>
        <input type="datetime-local" bind:value={endsAt} />
      </div>
    </div>
    <div class="btn-group">
      <button class="btn btn-primary" on:click={startSession} disabled={loading}>
        <Icon name="play" size={14} color="#ffffff" />
        <span>{loading ? 'Starting…' : 'Start Attendance Session & Project QR'}</span>
      </button>
    </div>
    <p class="hint">Starting a new session automatically closes any previously active session and opens the live rotating QR projector.</p>
    {#if successMsg}<p class="notice success">{successMsg}</p>{/if}
    {#if error}<p class="notice error">{error}</p>{/if}
  </div>

  <!-- Live Classroom QR Projector Modal -->
  {#if qrSession}
    <div class="modal-overlay" on:click|self={closeLiveQr}>
      <div class="modal projector-modal">
        <div class="modal-header projector-header">
          <div>
            <div class="badge-live-row">
              <span class="pulse-live"></span>
              <span class="live-title">LIVE CLASSROOM ATTENDANCE BROADCAST</span>
            </div>
            <h3>{qrSession.title}</h3>
            <p class="meta">{qrSession.locations?.name || 'Classroom Location'} · Admin Host IP: <strong>{qrAdminIp}</strong></p>
          </div>
          <button class="close-btn" on:click={closeLiveQr} aria-label="Close projector modal">
            <Icon name="x" size={16} />
          </button>
        </div>

        <div class="projector-body">
          <div class="qr-col">
            <div class="qr-box">
              {#if qrSrc && qrExpiry > 0}
                <img src={qrSrc} alt="Classroom Dynamic QR Code" class="qr-image-lg" />
                <div class="countdown-bar-wrap">
                  <div class="countdown-bar" style="width: {(qrExpiry / 25) * 100}%"></div>
                </div>
                <div class="expiry-indicator">
                  <Icon name="refresh" size={14} />
                  <span>Rotating dynamically in <strong>{qrExpiry}s</strong></span>
                </div>
              {:else}
                <div class="qr-placeholder">
                  <Icon name="clock" size={40} color="#94a3b8" />
                  <p>Rotating token…</p>
                </div>
              {/if}
            </div>

            <div class="security-meta-card">
              <div class="sec-row">
                <Icon name="check" size={14} color="#16a34a" />
                <span>Admin IP Verified: <code>{qrAdminIp}</code> (Subnet Match Required)</span>
              </div>
              <div class="sec-row">
                <Icon name="smartphone" size={14} color="#0284c7" />
                <span>Device MAC / Hardware ID Bound & Checked</span>
              </div>
              <div class="sec-row">
                <Icon name="map-pin" size={14} color="#0f766e" />
                <span>Geofence Proximity Enabled</span>
              </div>
            </div>

            <div class="projector-controls">
              <button class="btn btn-sm btn-primary" on:click={() => generateLiveQr(qrSession)} disabled={qrGenerating}>
                <Icon name="refresh" size={13} />
                <span>{qrGenerating ? 'Rotating…' : 'Rotate QR Now'}</span>
              </button>
              <label class="toggle-label">
                <input type="checkbox" bind:checked={autoRotate} />
                <span>Auto-rotate (25s)</span>
              </label>
            </div>
          </div>

          <div class="scans-col">
            <div class="scans-header">
              <h4>Live Student Attendance ({liveScans.length})</h4>
              <span class="tag-verified">Real-Time Sync</span>
            </div>

            {#if liveScans.length === 0}
              <div class="empty-scans">
                <Icon name="smartphone" size={32} color="#94a3b8" />
                <p>Waiting for students to scan QR code on screen…</p>
              </div>
            {:else}
              <div class="scans-list">
                {#each liveScans as scan}
                  <div class="scan-item">
                    <div class="scan-left">
                      <span class="scan-name">{scan.students?.full_name || 'Student'}</span>
                      <span class="scan-id">ID: <code>{scan.students?.student_id || '—'}</code></span>
                      <span class="scan-tech">
                        IP: {scan.ip_address || '—'} &nbsp;|&nbsp; Status: <strong class="text-green">{scan.verification_status || 'VERIFIED'}</strong>
                      </span>
                    </div>
                    <div class="scan-right">
                      <span class="badge-verified">
                        <Icon name="check" size={12} />
                        <span>MATCHED</span>
                      </span>
                      <span class="scan-time">{new Date(scan.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  {/if}

  <!-- Session attendance modal -->
  {#if viewingSession}
    <div class="modal-overlay" on:click|self={() => viewingSession = null}>
      <div class="modal">
        <div class="modal-header">
          <div>
            <h3>{viewingSession.title}</h3>
            <p class="meta">{viewingSession.locations?.name || ''} · {new Date(viewingSession.started_at).toLocaleString()}</p>
          </div>
          <button class="close-btn" on:click={() => viewingSession = null} aria-label="Close modal">
            <Icon name="x" size={16} />
          </button>
        </div>
        {#if sessionAttendance.length === 0}
          <p class="muted pad-16">No attendance records for this session.</p>
        {:else}
          <div class="modal-table-wrap">
            <table>
              <thead><tr><th>Student</th><th>ID</th><th>Network IP</th><th>Type</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>
                {#each sessionAttendance as r}
                  <tr>
                    <td class="bold">{r.students?.full_name || '—'}</td>
                    <td><code>{r.students?.student_id || '—'}</code></td>
                    <td class="mono">{r.ip_address || '—'}</td>
                    <td><span class="pill {r.type === 'clock_in' ? 'pill-in' : 'pill-out'}">{r.type === 'clock_in' ? 'In' : 'Out'}</span></td>
                    <td><span class="pill pill-active-session">{r.verification_status || 'VERIFIED'}</span></td>
                    <td class="muted">{new Date(r.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
        <div class="modal-actions">
          <button class="btn ghost" on:click={() => viewingSession = null}>Close</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Sessions table -->
  <div class="table-wrap">
    <div class="table-header-bar">
      <h3>Attendance Sessions Log</h3>
      <span class="count-badge">{sessions.length} recorded</span>
    </div>
    {#if sessions.length === 0}
      <div class="empty-state">
        <Icon name="sessions" size={32} color="#94a3b8" />
        <p>No sessions recorded yet. Start one using the form above.</p>
      </div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Location</th>
            <th>Status</th>
            <th>Started</th>
            <th>Closed</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each sessions as s}
            <tr>
              <td class="bold">{s.title}</td>
              <td>{s.locations?.name || '—'}</td>
              <td>
                <span class="pill {s.status === 'ACTIVE' ? 'pill-active-session' : (s.status === 'CLOSED' ? 'pill-closed' : 'pill-expired')}">
                  {s.status}
                </span>
              </td>
              <td class="muted">{new Date(s.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td class="muted">{s.closed_at ? new Date(s.closed_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
              <td class="actions">
                {#if s.status === 'ACTIVE'}
                  <button class="btn btn-sm btn-qr-proj" on:click={() => openLiveQr(s)} title="Open Live Classroom QR Screen">
                    <Icon name="qr" size={13} />
                    <span>Project QR</span>
                  </button>
                {/if}
                <button class="btn btn-sm ghost" on:click={() => viewAttendance(s)}>
                  <Icon name="clipboard" size={13} />
                  <span>View</span>
                </button>
                {#if s.status === 'ACTIVE'}
                  <button class="btn btn-sm btn-warn" on:click={() => closeSession(s)}>
                    <Icon name="clock" size={13} />
                    <span>Close</span>
                  </button>
                {/if}
                <button class="btn btn-sm btn-del" on:click={() => deleteSession(s)} title="Delete session">
                  <Icon name="trash" size={13} />
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .section { display: flex; flex-direction: column; gap: 20px; }

  .form-card {
    background: white; border: 1px solid #e2e8f0; border-radius: 14px;
    padding: 22px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    display: flex; flex-direction: column; gap: 16px;
  }
  .card-title-row { display: flex; align-items: center; gap: 10px; }
  .card-title-row h3 { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }

  .form-row { display: grid; grid-template-columns: 2fr 1.5fr 1.5fr; gap: 14px; }
  @media (max-width: 900px) { .form-row { grid-template-columns: 1fr; } }

  .field { display: flex; flex-direction: column; gap: 6px; }
  label { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
  input, select {
    padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 8px;
    font-size: 14px; color: #0f172a; outline: none; background: #ffffff;
    transition: all 0.15s;
  }
  input:focus, select:focus { border-color: #0284c7; box-shadow: 0 0 0 3px rgba(50, 240, 0, 0.22); }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 18px; border-radius: 8px; border: none;
    cursor: pointer; font-size: 13.5px; font-weight: 700; transition: all 0.15s;
  }
  .btn-primary {
    background: linear-gradient(135deg, #32F000 0%, #0db872 30%, #0284c7 68%, #073B78 100%);
    color: #ffffff; align-self: flex-start;
    box-shadow: 0 3px 12px rgba(7, 59, 120, 0.2);
    text-shadow: 0 1px 2px rgba(7, 59, 120, 0.35);
  }
  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #2bd000 0%, #0aa062 30%, #0274b0 68%, #052c5c 100%);
    box-shadow: 0 4px 16px rgba(50, 240, 0, 0.35);
    transform: translateY(-1px);
  }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

  .btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 6px; }
  .btn.ghost { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
  .btn.ghost:hover { background: #e2e8f0; color: #0f172a; }
  .btn-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .btn-warn:hover { background: #fef3c7; }
  .btn-del { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .btn-del:hover { background: #fee2e2; }
  .btn-qr-proj {
    background: #071527; color: #32F000; border: 1px solid rgba(50, 240, 0, 0.4);
  }
  .btn-qr-proj:hover { background: #073B78; color: #ffffff; }

  .hint { font-size: 12px; color: #64748b; margin: 0; }

  .notice { padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; }
  .notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .table-wrap {
    background: white; border: 1px solid #e2e8f0; border-radius: 14px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    width: 100%;
  }
  .table-header-bar {
    padding: 16px 20px; border-bottom: 1px solid #f1f5f9;
    display: flex; align-items: center; justify-content: space-between;
  }
  .table-header-bar h3 { margin: 0; font-size: 15px; font-weight: 700; color: #0f172a; }
  .count-badge { font-size: 12px; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 999px; }

  table {
    width: 100%;
    min-width: 680px;
    border-collapse: collapse;
    font-size: 13.5px;
  }
  th {
    background: #f8fafc; text-align: left; padding: 12px 20px;
    color: #64748b; font-weight: 600; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.04em; border-bottom: 1px solid #e2e8f0;
  }
  td { padding: 13px 20px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafcff; }

  .bold { font-weight: 600; color: #0f172a; }
  .muted { color: #94a3b8; }
  .mono { font-family: monospace; font-size: 12px; }
  .pad-16 { padding: 24px; text-align: center; }

  .actions { display: flex; gap: 6px; align-items: center; }

  .pill {
    display: inline-block; padding: 3px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .pill-active-session { background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0; }
  .pill-closed { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
  .pill-expired { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .pill-in { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .pill-out { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }

  .empty-state {
    padding: 48px 20px; text-align: center; color: #94a3b8;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-size: 14px;
  }

  /* Modal */
  .modal-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,0.7);
    backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center;
    z-index: 100;
  }
  .modal {
    background: white; border-radius: 16px; width: 620px; max-width: 95vw;
    box-shadow: 0 20px 40px rgba(0,0,0,0.18); overflow: hidden;
  }
  .projector-modal {
    width: 880px; max-width: 96vw;
  }
  .modal-header {
    padding: 18px 22px; border-bottom: 1px solid #e2e8f0;
    display: flex; justify-content: space-between; align-items: flex-start;
  }
  .projector-header {
    background: #071527; color: white; border-bottom: 1px solid rgba(50, 240, 0, 0.2);
  }
  .projector-header h3 { color: white; }
  .projector-header .meta { color: #94a3b8; }
  .badge-live-row { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .pulse-live {
    width: 8px; height: 8px; border-radius: 50%; background: #32F000;
    box-shadow: 0 0 10px #32F000;
  }
  .live-title { font-size: 11px; font-weight: 800; color: #32F000; letter-spacing: 0.05em; }

  .projector-body {
    display: grid; grid-template-columns: 1fr 1.15fr; gap: 20px;
    padding: 24px; background: #f8fafc;
  }
  @media (max-width: 768px) { .projector-body { grid-template-columns: 1fr; } }

  .qr-col { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .qr-box {
    background: white; border-radius: 14px; padding: 16px;
    border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0,0,0,0.06);
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    width: 100%; max-width: 320px;
  }
  .qr-image-lg { width: 240px; height: 240px; border-radius: 8px; }
  .countdown-bar-wrap { width: 100%; height: 5px; background: #e2e8f0; border-radius: 999px; overflow: hidden; }
  .countdown-bar {
    height: 100%; background: linear-gradient(90deg, #32F000, #0db872, #0284c7);
    transition: width 1s linear;
  }
  .expiry-indicator {
    display: flex; align-items: center; gap: 6px; font-size: 12px; color: #475569; font-weight: 600;
  }
  .security-meta-card {
    background: white; border-radius: 10px; padding: 12px 14px;
    border: 1px solid #e2e8f0; font-size: 11.5px; width: 100%; max-width: 320px;
    display: flex; flex-direction: column; gap: 6px; color: #334155;
  }
  .sec-row { display: flex; align-items: center; gap: 8px; }
  .sec-row code { font-size: 11px; background: #f1f5f9; padding: 1px 4px; border-radius: 4px; }

  .projector-controls {
    display: flex; align-items: center; justify-content: space-between; width: 100%; max-width: 320px;
  }
  .toggle-label {
    display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #475569; cursor: pointer;
  }

  .scans-col {
    background: white; border-radius: 14px; border: 1px solid #e2e8f0;
    padding: 16px; display: flex; flex-direction: column; gap: 12px;
    height: 440px; overflow: hidden;
  }
  .scans-header {
    display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 10px;
  }
  .scans-header h4 { margin: 0; font-size: 14px; font-weight: 700; color: #0f172a; }
  .tag-verified {
    font-size: 11px; font-weight: 700; color: #059669; background: #ecfdf5; padding: 2px 8px; border-radius: 999px;
  }
  .empty-scans {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    color: #94a3b8; font-size: 13px; text-align: center; gap: 8px;
  }
  .scans-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .scan-item {
    padding: 10px 12px; border-radius: 8px; border: 1px solid #f1f5f9;
    background: #f8fafc; display: flex; justify-content: space-between; align-items: center;
  }
  .scan-left { display: flex; flex-direction: column; gap: 2px; }
  .scan-name { font-size: 13px; font-weight: 700; color: #0f172a; }
  .scan-id { font-size: 11.5px; color: #64748b; }
  .scan-tech { font-size: 11px; color: #64748b; }
  .text-green { color: #16a34a; font-weight: 700; }
  .scan-right { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
  .badge-verified {
    display: inline-flex; align-items: center; gap: 4px;
    font-size: 10.5px; font-weight: 800; background: #dcfce7; color: #15803d;
    padding: 2px 6px; border-radius: 4px;
  }
  .scan-time { font-size: 11px; color: #94a3b8; }

  .close-btn {
    border: none; background: #f1f5f9; border-radius: 6px; width: 28px; height: 28px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    color: #64748b; transition: all 0.15s;
  }
  .close-btn:hover { background: #e2e8f0; color: #0f172a; }
  .modal-table-wrap {
    max-height: 360px;
    overflow-y: auto;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .modal-table-wrap table {
    min-width: 540px;
  }
  .modal-actions {
    padding: 14px 22px; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: flex-end; background: #f8fafc;
  }

  @media (max-width: 768px) {
    .projector-modal {
      width: 95vw;
      max-height: 90vh;
      overflow-y: auto;
    }
    .projector-body {
      padding: 16px;
      gap: 16px;
    }
    .scans-col {
      height: auto;
      max-height: 300px;
    }
    .qr-box {
      max-width: 100%;
    }
    .qr-image-lg {
      width: 200px;
      height: 200px;
    }
    .form-card {
      padding: 18px 16px;
    }
  }

  @media (max-width: 640px) {
    th, td {
      padding: 10px 14px;
      font-size: 12.5px;
    }
    .table-header-bar {
      padding: 12px 16px;
    }
  }
</style>
