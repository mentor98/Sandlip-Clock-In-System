<script>
  import { onDestroy } from 'svelte';
  import { api } from './lib/api.js';
  import { subscribeTable } from './lib/realtime.js';
  import Icon from './lib/Icon.svelte';

  let stats = { students: 0, devices: 0, pendingDevices: 0, presentToday: 0, rejectedToday: 0, reviewToday: 0 };
  let recentAttendance = [];
  let activeSession = null;
  let error = '';

  async function load() {
    try {
      const [studentsRes, devicesRes, attendanceRes, sessionRes] = await Promise.all([
        api('/admin/students'),
        api('/admin/devices'),
        api('/admin/attendance'),
        api('/sessions').catch(() => ({ sessions: [] })),
      ]);

      stats.students = studentsRes.students?.length || 0;
      stats.devices = (devicesRes.devices || []).filter(d => !d.revoked_at && d.status !== 'REVOKED' && d.status !== 'BLOCKED').length;
      stats.pendingDevices = (devicesRes.devices || []).filter(d => d.status === 'PENDING').length;

      const today = new Date().toISOString().slice(0, 10);
      const todayRecords = (attendanceRes.attendance || []).filter(r => r.recorded_at?.startsWith(today));
      stats.presentToday = new Set(todayRecords.filter(r => r.type === 'clock_in').map(r => r.student_id)).size;

      const auditRes = await api('/admin/audit-log');
      const todayAudit = (auditRes.audit_log || []).filter(e => e.created_at?.startsWith(today));
      stats.rejectedToday = todayAudit.filter(e => e.event_type === 'attendance_rejected' && e.detail?.status === 'REJECTED').length;
      stats.reviewToday = todayAudit.filter(e => e.event_type === 'attendance_rejected' && e.detail?.status === 'REVIEW').length;

      recentAttendance = todayRecords.slice(0, 10);

      const activeSessions = (sessionRes.sessions || []).filter(s => s.status === 'ACTIVE');
      activeSession = activeSessions[0] || null;
    } catch (e) { error = e.message; }
  }

  load();
  const unsub1 = subscribeTable('attendance', '*', load);
  const unsub2 = subscribeTable('devices', '*', load);
  const unsub3 = subscribeTable('students', '*', load);
  onDestroy(() => { unsub1(); unsub2(); unsub3(); });

  function statusColor(s) {
    if (s === 'VERIFIED') return '#0f766e';
    if (s === 'REVIEW') return '#d97706';
    return '#dc2626';
  }
</script>

<div class="overview">
  {#if error}<div class="notice error">{error}</div>{/if}

  <!-- Active session banner -->
  {#if activeSession}
    <div class="session-active-banner">
      <div class="banner-icon-box">
        <Icon name="play" size={16} color="#0f766e" strokeWidth={2.5} />
      </div>
      <div class="banner-content">
        <div class="banner-title">
          <strong>Active Session:</strong> {activeSession.title}
        </div>
        <div class="banner-sub">
          <span>{activeSession.locations?.name || 'Assigned Location'}</span>
          <span class="dot-sep">•</span>
          <span>Started {new Date(activeSession.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      </div>
    </div>
  {:else}
    <div class="session-inactive-banner">
      <div class="inactive-icon-box">
        <Icon name="clock" size={16} color="#64748b" />
      </div>
      <span>No active attendance session currently running. Navigate to <strong>Sessions</strong> to start one.</span>
    </div>
  {/if}

  <!-- Stats grid -->
  <div class="stats-grid">
    <div class="stat-card">
      <div class="stat-header">
        <span class="stat-lbl">Total Students</span>
        <div class="stat-icon-wrap neutral">
          <Icon name="students" size={16} color="#475569" />
        </div>
      </div>
      <span class="stat-val">{stats.students}</span>
    </div>

    <div class="stat-card">
      <div class="stat-header">
        <span class="stat-lbl">Authorized Devices</span>
        <div class="stat-icon-wrap teal">
          <Icon name="devices" size={16} color="#0f766e" />
        </div>
      </div>
      <div class="stat-val-row">
        <span class="stat-val">{stats.devices}</span>
        {#if stats.pendingDevices > 0}
          <span class="badge-warn">{stats.pendingDevices} pending</span>
        {/if}
      </div>
    </div>

    <div class="stat-card stat-green">
      <div class="stat-header">
        <span class="stat-lbl">Present Today</span>
        <div class="stat-icon-wrap green">
          <Icon name="check" size={16} color="#16a34a" />
        </div>
      </div>
      <span class="stat-val green-val">{stats.presentToday}</span>
    </div>

    <div class="stat-card stat-orange">
      <div class="stat-header">
        <span class="stat-lbl">Under Review</span>
        <div class="stat-icon-wrap orange">
          <Icon name="alert-triangle" size={16} color="#d97706" />
        </div>
      </div>
      <span class="stat-val orange-val">{stats.reviewToday}</span>
    </div>

    <div class="stat-card stat-red">
      <div class="stat-header">
        <span class="stat-lbl">Rejected Today</span>
        <div class="stat-icon-wrap red">
          <Icon name="x" size={16} color="#dc2626" />
        </div>
      </div>
      <span class="stat-val red-val">{stats.rejectedToday}</span>
    </div>

    <div class="stat-card">
      <div class="stat-header">
        <span class="stat-lbl">Attendance Rate</span>
        <div class="stat-icon-wrap indigo">
          <Icon name="chart-bar" size={16} color="#4f46e5" />
        </div>
      </div>
      <span class="stat-val">{stats.students > 0 ? Math.round((stats.presentToday / stats.students) * 100) : 0}%</span>
    </div>
  </div>

  <!-- Live attendance feed -->
  <div class="card">
    <div class="card-header">
      <div class="card-title-group">
        <Icon name="clipboard" size={18} color="#0f766e" />
        <h3>Today's Attendance Stream</h3>
      </div>
      <span class="live-indicator">
        <span class="live-dot"></span>
        Live Feed
      </span>
    </div>

    {#if recentAttendance.length === 0}
      <div class="empty-state">
        <Icon name="clock" size={32} color="#94a3b8" />
        <p>No attendance records recorded yet today.</p>
      </div>
    {:else}
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Student</th>
              <th>Type</th>
              <th>Location</th>
              <th>Trust Score</th>
              <th>Status</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {#each recentAttendance as r}
              <tr>
                <td class="bold">{r.students?.full_name || '—'}</td>
                <td>
                  <span class="pill {r.type === 'clock_in' ? 'pill-in' : 'pill-out'}">
                    {r.type === 'clock_in' ? 'Clock In' : 'Clock Out'}
                  </span>
                </td>
                <td>{r.locations?.name || '—'}</td>
                <td>
                  {#if r.risk_score != null}
                    <span class="score-badge" style="color:{statusColor(r.verification_status)}; background: {statusColor(r.verification_status)}15; border: 1px solid {statusColor(r.verification_status)}30;">
                      {r.risk_score}/100
                    </span>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
                <td>
                  {#if r.verification_status}
                    <span class="pill pill-{r.verification_status?.toLowerCase()}">{r.verification_status}</span>
                  {:else}
                    <span class="muted">—</span>
                  {/if}
                </td>
                <td class="muted">{new Date(r.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .overview { display: flex; flex-direction: column; gap: 24px; }

  .session-active-banner {
    display: flex; align-items: center; gap: 14px;
    background: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 12px;
    padding: 14px 18px; color: #0f766e;
    box-shadow: 0 1px 3px rgba(15,118,110,0.06);
  }
  .banner-icon-box {
    width: 32px; height: 32px; border-radius: 8px;
    background: #ccfbf1; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }
  .banner-content { display: flex; flex-direction: column; gap: 2px; }
  .banner-title { font-size: 14px; color: #115e59; }
  .banner-sub { font-size: 12px; color: #0f766e; opacity: 0.85; display: flex; align-items: center; gap: 6px; }
  .dot-sep { font-size: 8px; opacity: 0.6; }

  .session-inactive-banner {
    display: flex; align-items: center; gap: 12px;
    background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 12px 18px; font-size: 13.5px; color: #475569;
  }
  .inactive-icon-box {
    width: 28px; height: 28px; border-radius: 6px;
    background: #e2e8f0; display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
  }
  .stat-card {
    background: white; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 18px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    display: flex; flex-direction: column; gap: 12px;
  }
  .stat-header { display: flex; align-items: center; justify-content: space-between; }
  .stat-lbl { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }
  .stat-icon-wrap {
    width: 30px; height: 30px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
  }
  .stat-icon-wrap.neutral { background: #f1f5f9; }
  .stat-icon-wrap.teal { background: #f0fdfa; }
  .stat-icon-wrap.green { background: #f0fdf4; }
  .stat-icon-wrap.orange { background: #fffbeb; }
  .stat-icon-wrap.red { background: #fef2f2; }
  .stat-icon-wrap.indigo { background: #eef2ff; }

  .stat-val-row { display: flex; align-items: baseline; gap: 10px; }
  .stat-val { font-size: 26px; font-weight: 700; color: #0f172a; line-height: 1; letter-spacing: -0.02em; }
  .green-val { color: #16a34a; }
  .orange-val { color: #d97706; }
  .red-val { color: #dc2626; }

  .badge-warn {
    font-size: 11px; font-weight: 600; background: #fef3c7;
    color: #92400e; padding: 2px 8px; border-radius: 999px;
  }

  .card {
    background: white; border-radius: 14px; border: 1px solid #e2e8f0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.03); overflow: hidden;
  }
  .card-header {
    padding: 16px 22px; border-bottom: 1px solid #f1f5f9;
    display: flex; align-items: center; justify-content: space-between;
  }
  .card-title-group { display: flex; align-items: center; gap: 10px; }
  .card-header h3 { margin: 0; font-size: 15px; font-weight: 700; color: #0f172a; }

  .live-indicator {
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; font-weight: 600; color: #0f766e;
  }
  .live-dot {
    width: 7px; height: 7px; border-radius: 50%; background: #0d9488;
    animation: livePulse 2s infinite;
  }
  @keyframes livePulse {
    0% { transform: scale(0.95); opacity: 0.8; }
    50% { transform: scale(1.2); opacity: 1; }
    100% { transform: scale(0.95); opacity: 0.8; }
  }

  .empty-state {
    padding: 48px 20px; text-align: center; color: #94a3b8;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-size: 14px;
  }

  .table-container { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
  th {
    background: #f8fafc; text-align: left; padding: 12px 20px;
    color: #64748b; font-weight: 600; font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.04em; border-bottom: 1px solid #e2e8f0;
  }
  td { padding: 14px 20px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafcff; }

  .bold { font-weight: 600; color: #0f172a; }
  .muted { color: #94a3b8; }

  .pill {
    display: inline-block; padding: 3px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .pill-in { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .pill-out { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
  .pill-verified { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
  .pill-review { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .pill-rejected { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .score-badge {
    display: inline-block; padding: 2px 7px; border-radius: 6px;
    font-size: 12px; font-weight: 700;
  }

  .notice.error {
    background: #fef2f2; color: #991b1b; border: 1px solid #fecaca;
    padding: 12px 16px; border-radius: 10px; font-size: 13.5px;
  }
</style>
