<script>
  import { onDestroy } from 'svelte';
  import { api } from './lib/api.js';
  import { subscribeTable } from './lib/realtime.js';
  import Icon from './lib/Icon.svelte';

  let devices = [];
  let filter = 'ALL';
  let error = '';
  let successMsg = '';
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
              <td class="mono">{d.ip_address || '—'}</td>
              <td><span class="pill {statusColors[d.status] || 'pill-pending'}">{d.status || 'PENDING'}</span></td>
              <td class="muted">{formatDate(d.registered_at)}</td>
              <td class="muted">{formatDate(d.last_seen_at)}</td>
              <td class="actions">
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
    background: #0f766e; color: white; border-color: #0f766e;
    box-shadow: 0 2px 6px rgba(15,118,110,0.25);
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
    box-shadow: 0 1px 3px rgba(0,0,0,0.03); overflow: hidden;
  }
  table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
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

  .empty-state {
    padding: 48px 20px; text-align: center; color: #94a3b8;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-size: 14px;
  }
</style>
