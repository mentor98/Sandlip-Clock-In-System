<script>
  import { onDestroy } from 'svelte';
  import { api } from './lib/api.js';
  import { subscribeTable } from './lib/realtime.js';
  import Icon from './lib/Icon.svelte';

  let devices = [];
  let filter = 'ALL';
  let error = '';
  let successMsg = '';
  let resetLink = '';
  let copiedResetLink = false;
  let loading = false;

  async function load() {
    loading = true; error = '';
    try {
      const params = filter !== 'ALL' ? `?status=${filter}` : '';
      const res = await api(`/admin/devices${params}`);
      devices = res.devices || [];
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }
  load();

  const unsub = subscribeTable('devices', '*', load);
  onDestroy(() => unsub());

  async function authorize(d) {
    error = ''; successMsg = '';
    try {
      await api(`/admin/devices/${d.id}/authorize`, { method: 'PATCH' });
      successMsg = `Device authorized for ${d.students?.full_name}.`;
      load();
    } catch (e) { error = e.message; }
  }

  async function revoke(d) {
    if (!confirm(`Revoke device for ${d.students?.full_name}?`)) return;
    error = ''; successMsg = '';
    try {
      await api(`/admin/devices/${d.id}/revoke`, { method: 'PATCH' });
      successMsg = `Device revoked.`;
      load();
    } catch (e) { error = e.message; }
  }

  async function resetDevice(d) {
    if (!confirm(`Reset hardware binding for ${d.students?.full_name || 'student'}? This will revoke this device and generate a fresh registration link.`)) return;
    error = ''; successMsg = ''; resetLink = ''; copiedResetLink = false;
    try {
      const studentId = d.student_id;
      const res = await api(`/admin/students/${studentId}/reset-device`, { method: 'POST' });
      resetLink = res.registrationLink;
      successMsg = `Device successfully reset for ${d.students?.full_name || 'student'}. Share the new registration link below.`;
      load();
    } catch (e) { error = e.message; }
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).then(() => {
      copiedResetLink = true;
      setTimeout(() => copiedResetLink = false, 3000);
    });
  }

  async function block(d) {
    if (!confirm(`Block device for ${d.students?.full_name}? They will not be able to clock in.`)) return;
    error = ''; successMsg = '';
    try {
      await api(`/admin/devices/${d.id}/block`, { method: 'PATCH' });
      successMsg = `Device blocked.`;
      load();
    } catch (e) { error = e.message; }
  }

  async function reactivate(d) {
    error = ''; successMsg = '';
    try {
      await api(`/admin/devices/${d.id}/reactivate`, { method: 'PATCH' });
      successMsg = `Device reactivated.`;
      load();
    } catch (e) { error = e.message; }
  }

  function getPlatformInfo(ua) {
    if (!ua) return { icon: 'globe', label: 'Unknown' };
    if (ua.includes('iPhone') || ua.includes('iPad')) return { icon: 'apple', label: 'iOS Device' };
    if (ua.includes('Android')) return { icon: 'android', label: 'Android Device' };
    if (ua.includes('Windows')) return { icon: 'windows', label: 'Windows PC' };
    if (ua.includes('Mac')) return { icon: 'apple', label: 'macOS Workstation' };
    if (ua.includes('Linux')) return { icon: 'globe', label: 'Linux OS' };
    return { icon: 'globe', label: 'Web Browser' };
  }

  function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  const statusColors = {
    PENDING: 'pill-pending',
    AUTHORIZED: 'pill-auth',
    REVOKED: 'pill-revoked',
    BLOCKED: 'pill-blocked',
  };
</script>

<div class="section">
  <!-- Filter tabs -->
  <div class="filter-tabs">
    {#each ['ALL','PENDING','AUTHORIZED','REVOKED','BLOCKED'] as f}
      <button class:active={filter === f} on:click={() => { filter = f; load(); }}>
        <span>{f}</span>
        {#if f === 'PENDING' && devices.filter(d => d.status === 'PENDING').length > 0}
          <span class="badge-alert">{devices.filter(d => d.status === 'PENDING').length}</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if successMsg}<div class="notice success">{successMsg}</div>{/if}
  {#if error}<div class="notice error">{error}</div>{/if}

  {#if resetLink}
    <div class="reset-link-card">
      <div class="reset-link-header">
        <div class="reset-link-title">
          <Icon name="check" size={16} color="#0f766e" />
          <strong>Fresh Device Registration Link Generated</strong>
        </div>
        <div class="reset-link-actions">
          <button class="btn btn-sm {copiedResetLink ? 'btn-green' : 'btn-primary'}" on:click={() => copyToClipboard(resetLink)}>
            <Icon name="copy" size={13} />
            <span>{copiedResetLink ? 'Copied Link!' : 'Copy Link'}</span>
          </button>
          <a class="btn btn-sm ghost" href={resetLink} target="_blank" rel="noopener noreferrer">
            <Icon name="external-link" size={13} />
            <span>Open PWA</span>
          </a>
          <button class="btn btn-sm ghost" on:click={() => { resetLink = ''; copiedResetLink = false; }} title="Dismiss">
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      <code>{resetLink}</code>
      <p class="reset-desc">Direct the student to open this URL on their trusted device (PC or Phone) to bind their hardware MAC and authorized campus network.</p>
    </div>
  {/if}

  <div class="table-wrap">
    {#if loading}
      <p class="muted center pad-24">Loading device inventory…</p>
    {:else if devices.length === 0}
      <div class="empty-state">
        <Icon name="smartphone" size={32} color="#94a3b8" />
        <p>No devices matching filter criteria.</p>
      </div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Matric ID</th>
            <th>Hardware Platform</th>
            <th>MAC / Hardware ID</th>
            <th>Network IP</th>
            <th>Status</th>
            <th>Registered</th>
            <th>Last Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each devices as d}
            {@const plat = getPlatformInfo(d.user_agent)}
            <tr class:dimmed={d.status === 'REVOKED' || d.status === 'BLOCKED'}>
              <td class="bold">{d.students?.full_name || '—'}</td>
              <td><code>{d.students?.student_id || '—'}</code></td>
              <td>
                <span class="plat-chip">
                  <Icon name={plat.icon} size={14} />
                  <span>{plat.label}</span>
                </span>
              </td>
              <td class="mono mac-cell">
                <code>{d.mac_address || d.students?.registered_mac || d.webauthn_credential_id?.slice(0, 18) || 'MAC-UNBOUND'}</code>
              </td>
              <td class="mono ip-cell">
                <span class="ip-tag">{d.ip_address || d.students?.registered_ip || '—'}</span>
              </td>
              <td><span class="pill {statusColors[d.status] || 'pill-pending'}">{d.status || 'PENDING'}</span></td>
              <td class="muted">{formatDate(d.registered_at)}</td>
              <td class="muted">{formatDate(d.last_seen_at)}</td>
              <td class="actions">
                <button class="btn btn-sm btn-warn" on:click={() => resetDevice(d)} title="Reset Device & Generate New Link">
                  <Icon name="refresh" size={13} />
                  <span>Reset</span>
                </button>
                {#if d.status === 'PENDING'}
                  <button class="btn btn-sm btn-green" on:click={() => authorize(d)} title="Authorize Device">
                    <Icon name="check" size={13} />
                    <span>Authorize</span>
                  </button>
                  <button class="btn btn-sm btn-del" on:click={() => block(d)} title="Block Device">
                    <Icon name="x" size={13} />
                    <span>Block</span>
                  </button>
                {:else if d.status === 'AUTHORIZED'}
                  <button class="btn btn-sm ghost" on:click={() => revoke(d)} title="Revoke Device">
                    <Icon name="refresh" size={13} />
                    <span>Revoke</span>
                  </button>
                  <button class="btn btn-sm btn-del" on:click={() => block(d)} title="Block Device">
                    <Icon name="x" size={13} />
                    <span>Block</span>
                  </button>
                {:else if d.status === 'REVOKED' || d.status === 'BLOCKED'}
                  <button class="btn btn-sm btn-green" on:click={() => reactivate(d)} title="Reactivate Device">
                    <Icon name="check" size={13} />
                    <span>Reactivate</span>
                  </button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
  <p class="count-txt">{devices.length} hardware device{devices.length !== 1 ? 's' : ''} enrolled</p>
</div>

<style>
  .section { display: flex; flex-direction: column; gap: 20px; }

  .filter-tabs { display: flex; gap: 8px; flex-wrap: wrap; }
  .filter-tabs button {
    padding: 8px 16px; border-radius: 8px; border: 1px solid #e2e8f0;
    background: white; cursor: pointer; font-weight: 600; font-size: 13px;
    display: inline-flex; align-items: center; gap: 8px; transition: all 0.15s;
    color: #475569;
  }
  .filter-tabs button:hover { background: #f8fafc; color: #0f172a; }
  .filter-tabs button.active {
    background: linear-gradient(135deg, #32F000 0%, #0db872 30%, #0284c7 68%, #073B78 100%);
    color: white; border-color: transparent;
    box-shadow: 0 4px 14px rgba(7, 59, 120, 0.25);
    text-shadow: 0 1px 2px rgba(7, 59, 120, 0.4);
  }

  .mac-cell code {
    background: #f1f5f9; padding: 2px 6px; border-radius: 4px;
    font-size: 11.5px; color: #0f172a; border: 1px solid #e2e8f0;
  }

  .badge-alert {
    background: #ef4444; color: white; font-size: 11px;
    padding: 2px 7px; border-radius: 999px; font-weight: 700;
  }
  .active .badge-alert { background: white; color: #0f766e; }

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
  tr.dimmed { opacity: 0.6; }

  .bold { font-weight: 600; color: #0f172a; }
  .muted { color: #94a3b8; }
  .mono { font-family: monospace; font-size: 12px; }
  .center { text-align: center; }
  .pad-24 { padding: 24px; }
  .count-txt { font-size: 12.5px; color: #64748b; margin: 0; }

  .plat-chip {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12.5px; font-weight: 500; color: #334155;
  }

  .pill {
    display: inline-block; padding: 3px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .pill-auth { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .pill-pending { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .pill-revoked { background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }
  .pill-blocked { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .actions { display: flex; gap: 6px; align-items: center; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    border: none; cursor: pointer; font-weight: 600; transition: all 0.15s;
  }
  .btn-sm { padding: 5px 11px; font-size: 12px; border-radius: 6px; }
  .btn.ghost { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
  .btn.ghost:hover { background: #e2e8f0; color: #0f172a; }
  .btn-green { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .btn-green:hover { background: #d1fae5; }
  .btn-del { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .btn-del:hover { background: #fee2e2; }
  .btn-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .btn-warn:hover { background: #fef3c7; }
  .btn-primary { background: #073B78; color: white; border: 1px solid #073B78; }
  .btn-primary:hover { opacity: 0.9; }

  .reset-link-card {
    background: #f0fdfa; border: 1px solid #99f6e4; border-radius: 12px;
    padding: 16px 20px; display: flex; flex-direction: column; gap: 10px;
    box-shadow: 0 2px 8px rgba(15, 118, 110, 0.08);
  }
  .reset-link-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
  .reset-link-title { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: #0f766e; }
  .reset-link-actions { display: flex; align-items: center; gap: 6px; }
  .reset-link-card code {
    background: white; border: 1px solid #ccfbf1; padding: 10px 14px;
    border-radius: 8px; font-family: monospace; font-size: 12px;
    word-break: break-all; color: #134e4a;
  }
  .reset-desc { font-size: 12px; color: #0d9488; margin: 0; }

  .empty-state {
    padding: 48px 20px; text-align: center; color: #94a3b8;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-size: 14px;
  }

  @media (max-width: 640px) {
    th, td {
      padding: 10px 14px;
      font-size: 12.5px;
    }
    .filter-tabs {
      overflow-x: auto;
      padding-bottom: 4px;
      -webkit-overflow-scrolling: touch;
    }
  }
</style>
