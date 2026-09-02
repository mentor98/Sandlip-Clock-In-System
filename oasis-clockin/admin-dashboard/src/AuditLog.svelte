<script>
  import { onDestroy } from 'svelte';
  import { api } from './lib/api.js';
  import { subscribeTable } from './lib/realtime.js';
  import Icon from './lib/Icon.svelte';

  let events = [];
  let error = '';
  let filterType = 'ALL';

  async function load() {
    try {
      const res = await api('/admin/audit-log');
      events = res.audit_log || [];
    } catch (e) { error = e.message; }
  }
  load();

  const unsubAudit = subscribeTable('audit_log', 'INSERT', () => load());
  onDestroy(() => unsubAudit());

  const eventLabels = {
    attendance_security_event: { label: 'Security Anomaly', color: 'tag-red', icon: 'alert-triangle' },
    attendance_rejected: { label: 'Verification Rejected', color: 'tag-red', icon: 'x' },
    attendance_recorded: { label: 'Verified Attendance', color: 'tag-green', icon: 'check' },
    admin_action: { label: 'Admin Action', color: 'tag-blue', icon: 'shield' },
    device_mismatch: { label: 'Device Mismatch', color: 'tag-red', icon: 'smartphone' },
    geofence_fail: { label: 'Outside Geofence', color: 'tag-orange', icon: 'map-pin' },
    expired_token: { label: 'Expired QR', color: 'tag-orange', icon: 'clock' },
  };

  function parseDetail(detail) {
    if (!detail) return '';
    if (typeof detail === 'string') return detail;
    if (detail.criticalFailures && detail.criticalFailures.length > 0) {
      return detail.criticalFailures.join(' · ');
    }
    if (detail.action) {
      return `Action: ${detail.action.replace('_', ' ')}`;
    }
    if (detail.attendanceType && detail.location) {
      return `${detail.attendanceType === 'clock_in' ? 'Clock In' : 'Clock Out'} at ${detail.location} (Trust Score: ${detail.riskScore || 100}/100)`;
    }
    if (detail.securityAnomalies && detail.securityAnomalies.length > 0) {
      return detail.securityAnomalies.map(a => a.type.replace(/_/g, ' ')).join(', ');
    }
    return JSON.stringify(detail);
  }

  $: filteredEvents = filterType === 'ALL'
    ? events
    : filterType === 'SECURITY'
    ? events.filter(e => e.event_type.includes('security') || e.event_type.includes('reject') || e.event_type.includes('fail'))
    : filterType === 'ADMIN'
    ? events.filter(e => e.event_type === 'admin_action')
    : events.filter(e => e.event_type === 'attendance_recorded');
</script>

<div class="container">
  <div class="card">
    <div class="header-row">
      <div class="title-group">
        <div class="icon-wrap">
          <Icon name="audit" size={18} color="#0f766e" />
        </div>
        <div>
          <h3>Security Audit & Telemetry Log</h3>
          <p class="sub">Authoritative real-time security events, anti-spoof anomalies, and administrative trace records.</p>
        </div>
      </div>

      <div class="filters">
        <button class:active={filterType === 'ALL'} on:click={() => (filterType = 'ALL')}>All Events</button>
        <button class:active={filterType === 'SECURITY'} on:click={() => (filterType = 'SECURITY')}>Security Anomalies</button>
        <button class:active={filterType === 'ATTENDANCE'} on:click={() => (filterType = 'ATTENDANCE')}>Recorded Attendance</button>
        <button class:active={filterType === 'ADMIN'} on:click={() => (filterType = 'ADMIN')}>Admin Actions</button>
      </div>
    </div>

    {#if error}<p class="notice error">{error}</p>{/if}

    {#if filteredEvents.length === 0}
      <div class="empty-state">
        <Icon name="shield" size={32} color="#94a3b8" />
        <p>No audit events found.</p>
      </div>
    {:else}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Security Event</th>
              <th>Student / User</th>
              <th>Event Telemetry Details</th>
              <th>Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredEvents as e}
              {@const meta = eventLabels[e.event_type]}
              <tr>
                <td>
                  <span class="tag {meta?.color || 'tag-gray'}">
                    <Icon name={meta?.icon || 'shield'} size={12} />
                    <span>{meta?.label || e.event_type}</span>
                  </span>
                </td>
                <td class="bold">
                  {#if e.students}
                    {e.students.full_name} <span class="sid">({e.students.student_id})</span>
                  {:else}
                    <span class="muted">System / Admin</span>
                  {/if}
                </td>
                <td class="detail-cell">
                  {parseDetail(e.detail)}
                </td>
                <td class="muted time-cell">{new Date(e.created_at).toLocaleString()}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </div>
</div>

<style>
  .container { display: flex; flex-direction: column; gap: 16px; }
  .card {
    background: white; border-radius: 14px; padding: 22px 24px;
    border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }
  .header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  .title-group { display: flex; align-items: center; gap: 12px; }
  .icon-wrap {
    width: 36px; height: 36px; border-radius: 10px; background: #f0fdfa;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  h3 { margin: 0 0 2px; font-size: 16px; font-weight: 700; color: #0f172a; }
  .sub { margin: 0; font-size: 13px; color: #64748b; }

  .filters { display: flex; gap: 6px; flex-wrap: wrap; }
  .filters button {
    padding: 7px 13px; border-radius: 8px; border: 1px solid #cbd5e1;
    background: white; cursor: pointer; font-size: 12.5px; font-weight: 600;
    transition: all 0.15s; color: #334155;
  }
  .filters button:hover { background: #f8fafc; color: #0f172a; }
  .filters button.active { background: #0f766e; color: white; border-color: #0f766e; }

  .table-wrap { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 10px; }
  table { width: 100%; border-collapse: collapse; min-width: 750px; }
  th {
    text-align: left; padding: 12px 16px; font-size: 11.5px; font-weight: 700;
    color: #64748b; background: #f8fafc; border-bottom: 1px solid #e2e8f0;
    text-transform: uppercase; letter-spacing: 0.04em;
  }
  td { padding: 12px 16px; font-size: 13px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; color: #334155; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafcff; }

  .tag {
    padding: 3px 9px; border-radius: 999px; font-size: 11px; font-weight: 700;
    display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
  }
  .tag-red { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .tag-orange { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .tag-green { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .tag-blue { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
  .tag-gray { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }

  .bold { font-weight: 600; color: #0f172a; }
  .sid { font-size: 12px; color: #64748b; font-weight: normal; }
  .detail-cell { font-size: 12.5px; color: #334155; max-width: 400px; line-height: 1.4; }
  .time-cell { font-size: 12px; white-space: nowrap; color: #64748b; }
  .muted { color: #64748b; }

  .empty-state {
    padding: 48px 20px; text-align: center; color: #94a3b8;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-size: 14px;
  }

  .notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; padding: 10px 14px; border-radius: 8px; margin-bottom: 12px; font-size: 13px; }

  @media (max-width: 640px) {
    .card { padding: 16px; }
    .header-row {
      flex-direction: column;
      align-items: flex-start;
      gap: 12px;
    }
    .filters {
      width: 100%;
      overflow-x: auto;
      padding-bottom: 4px;
      -webkit-overflow-scrolling: touch;
      flex-wrap: nowrap;
    }
    th, td {
      padding: 10px 12px;
      font-size: 12px;
    }
  }
</style>
