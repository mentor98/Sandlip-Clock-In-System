<script>
  import { api } from './lib/api.js';
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
      title = ''; locationId = ''; endsAt = '';
      load();
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }

  async function closeSession(s) {
    error = ''; successMsg = '';
    try {
      await api(`/sessions/${s.id}/close`, { method: 'PATCH' });
      successMsg = `Session "${s.title}" closed.`;
      load();
    } catch (e) { error = e.message; }
  }

  async function deleteSession(s) {
    if (!confirm(`Delete session "${s.title}"?`)) return;
    try {
      await api(`/sessions/${s.id}`, { method: 'DELETE' });
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
    <button class="btn btn-primary" on:click={startSession} disabled={loading}>
      <Icon name="play" size={14} color="#ffffff" />
      <span>{loading ? 'Starting…' : 'Start Attendance Session'}</span>
    </button>
    <p class="hint">Starting a new session automatically closes any currently active session.</p>
    {#if successMsg}<p class="notice success">{successMsg}</p>{/if}
    {#if error}<p class="notice error">{error}</p>{/if}
  </div>

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
              <thead><tr><th>Student</th><th>ID</th><th>Type</th><th>Time</th></tr></thead>
              <tbody>
                {#each sessionAttendance as r}
                  <tr>
                    <td class="bold">{r.students?.full_name || '—'}</td>
                    <td><code>{r.students?.student_id || '—'}</code></td>
                    <td><span class="pill {r.type === 'clock_in' ? 'pill-in' : 'pill-out'}">{r.type === 'clock_in' ? 'In' : 'Out'}</span></td>
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
  input:focus, select:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.12); }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    padding: 10px 18px; border-radius: 8px; border: none;
    cursor: pointer; font-size: 13.5px; font-weight: 600; transition: all 0.15s;
  }
  .btn-primary { background: #0f766e; color: white; align-self: flex-start; }
  .btn-primary:hover:not(:disabled) { background: #0b5c54; }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

  .btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 6px; }
  .btn.ghost { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
  .btn.ghost:hover { background: #e2e8f0; color: #0f172a; }
  .btn-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .btn-warn:hover { background: #fef3c7; }
  .btn-del { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .btn-del:hover { background: #fee2e2; }

  .hint { font-size: 12px; color: #64748b; margin: 0; }

  .notice { padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; }
  .notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .table-wrap {
    background: white; border: 1px solid #e2e8f0; border-radius: 14px;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03); overflow: hidden;
  }
  .table-header-bar {
    padding: 16px 20px; border-bottom: 1px solid #f1f5f9;
    display: flex; align-items: center; justify-content: space-between;
  }
  .table-header-bar h3 { margin: 0; font-size: 15px; font-weight: 700; color: #0f172a; }
  .count-badge { font-size: 12px; font-weight: 600; color: #64748b; background: #f1f5f9; padding: 2px 8px; border-radius: 999px; }

  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
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
    position: fixed; inset: 0; background: rgba(15,23,42,0.6);
    backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center;
    z-index: 100;
  }
  .modal {
    background: white; border-radius: 16px; width: 560px; max-width: 95vw;
    box-shadow: 0 20px 40px rgba(0,0,0,0.15); overflow: hidden;
  }
  .modal-header {
    padding: 18px 22px; border-bottom: 1px solid #e2e8f0;
    display: flex; justify-content: space-between; align-items: flex-start;
  }
  .modal-header h3 { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
  .meta { margin: 4px 0 0; font-size: 12px; color: #64748b; }
  .close-btn {
    border: none; background: #f1f5f9; border-radius: 6px; width: 28px; height: 28px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    color: #64748b; transition: all 0.15s;
  }
  .close-btn:hover { background: #e2e8f0; color: #0f172a; }
  .modal-table-wrap { max-height: 360px; overflow-y: auto; }
  .modal-actions {
    padding: 14px 22px; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: flex-end; background: #f8fafc;
  }
</style>
