<script>
  import { onDestroy } from 'svelte';
  import { api } from './lib/api.js';
  import { subscribeTable } from './lib/realtime.js';
  import Icon from './lib/Icon.svelte';

  let students = [];
  let search = '';
  let error = '';
  let successMsg = '';
  let loading = false;
  let showAddForm = false;
  let editingStudent = null;
  let deviceModalStudent = null;
  let resetLink = '';

  let newName = '', newId = '', newEmail = '';

  async function load() {
    loading = true; error = '';
    try {
      const res = await api(`/admin/students${search ? `?search=${encodeURIComponent(search)}` : ''}`);
      students = res.students || [];
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }
  load();

  const unsubDevices = subscribeTable('devices', '*', () => load());
  const unsubStudents = subscribeTable('students', '*', () => load());
  onDestroy(() => { unsubDevices(); unsubStudents(); });

  async function addStudent() {
    error = ''; successMsg = '';
    if (!newName || !newId || !newEmail) { error = 'Fill in all fields to add a student.'; return; }
    try {
      await api('/auth/register', {
        method: 'POST',
        body: { full_name: newName, student_id: newId, email: newEmail },
      });
      successMsg = `Student ${newName} added. They can now register their device at the Student PWA.`;
      newName = newId = newEmail = '';
      showAddForm = false;
      load();
    } catch (e) { error = e.message; }
  }

  async function saveEdit() {
    error = ''; successMsg = '';
    try {
      await api(`/admin/students/${editingStudent.id}`, {
        method: 'PATCH',
        body: { full_name: editingStudent.full_name, email: editingStudent.email },
      });
      successMsg = 'Student updated.';
      editingStudent = null;
      load();
    } catch (e) { error = e.message; }
  }

  async function toggleSuspend(s) {
    error = ''; successMsg = '';
    try {
      if (s.status === 'suspended') {
        await api(`/admin/students/${s.id}/activate`, { method: 'PATCH' });
        successMsg = `${s.full_name} reactivated.`;
      } else {
        await api(`/admin/students/${s.id}/suspend`, { method: 'PATCH' });
        successMsg = `${s.full_name} suspended.`;
      }
      load();
    } catch (e) { error = e.message; }
  }

  async function remove(s) {
    if (!confirm(`Permanently delete ${s.full_name}? This cannot be undone.`)) return;
    error = ''; successMsg = '';
    try {
      await api(`/admin/students/${s.id}`, { method: 'DELETE' });
      successMsg = `${s.full_name} deleted.`;
      load();
    } catch (e) { error = e.message; }
  }

  async function resetDevice(s) {
    error = ''; successMsg = ''; resetLink = '';
    try {
      const res = await api(`/admin/students/${s.id}/reset-device`, { method: 'POST' });
      resetLink = res.registrationLink;
      successMsg = `Device reset for ${s.full_name}. Share the registration link with the student.`;
      load();
    } catch (e) { error = e.message; }
  }

  function activeDevices(s) {
    return (s.devices || []).filter(d => !d.revoked_at);
  }

  function formatDate(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  function getPlatformInfo(ua) {
    if (!ua) return { icon: 'globe', label: 'Unknown' };
    if (ua.includes('iPhone') || ua.includes('iPad')) return { icon: 'apple', label: 'iOS' };
    if (ua.includes('Android')) return { icon: 'android', label: 'Android' };
    if (ua.includes('Windows')) return { icon: 'windows', label: 'Windows' };
    if (ua.includes('Mac')) return { icon: 'apple', label: 'macOS' };
    if (ua.includes('Linux')) return { icon: 'globe', label: 'Linux' };
    return { icon: 'globe', label: 'Browser' };
  }
</script>

<div class="section">
  <!-- Toolbar -->
  <div class="toolbar">
    <div class="search-row">
      <div class="search-input-wrap">
        <Icon name="search" size={15} color="#64748b" />
        <input bind:value={search} placeholder="Search by name, student ID, or email…"
          on:keydown={(e) => e.key === 'Enter' && load()} />
      </div>
      <button class="btn btn-primary" on:click={load}>Search</button>
    </div>
    <button class="btn {showAddForm ? 'ghost' : 'btn-teal'}" on:click={() => { showAddForm = !showAddForm; error = ''; successMsg = ''; }}>
      <Icon name={showAddForm ? 'x' : 'plus'} size={15} />
      <span>{showAddForm ? 'Cancel' : 'Add Student'}</span>
    </button>
  </div>

  <!-- Add student form -->
  {#if showAddForm}
    <div class="form-card">
      <div class="card-title-row">
        <Icon name="students" size={18} color="#0f766e" />
        <h3>Enroll New Student</h3>
      </div>
      <div class="form-row">
        <div class="field">
          <label>Full Name</label>
          <input bind:value={newName} placeholder="e.g. Ada Lovelace" />
        </div>
        <div class="field">
          <label>Student / Matric ID</label>
          <input bind:value={newId} placeholder="e.g. SAN-2026-014" />
        </div>
        <div class="field">
          <label>Institutional Email</label>
          <input type="email" bind:value={newEmail} placeholder="ada@school.edu" />
        </div>
      </div>
      <button class="btn btn-primary" on:click={addStudent}>
        <Icon name="check" size={14} />
        <span>Enroll Student</span>
      </button>
      <p class="hint">The student will bind their trusted hardware device (Passkey or direct binding) upon signing into the Student PWA.</p>
    </div>
  {/if}

  {#if successMsg}<p class="notice success">{successMsg}</p>{/if}
  {#if error}<p class="notice error">{error}</p>{/if}
  {#if resetLink}
    <div class="reset-link-card">
      <div class="reset-link-header">
        <Icon name="key" size={16} color="#0f766e" />
        <strong>Direct Registration Passkey Link:</strong>
      </div>
      <code>{resetLink}</code>
    </div>
  {/if}

  <!-- Edit student modal -->
  {#if editingStudent}
    <div class="modal-overlay" on:click|self={() => (editingStudent = null)}>
      <div class="modal">
        <div class="modal-header">
          <h3>Edit Student Record</h3>
          <button class="close-btn" on:click={() => (editingStudent = null)}><Icon name="x" size={16} /></button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Full Name</label>
            <input bind:value={editingStudent.full_name} />
          </div>
          <div class="field">
            <label>Student ID (Immutable)</label>
            <input value={editingStudent.student_id} disabled class="disabled-input" />
          </div>
          <div class="field">
            <label>Email Address</label>
            <input type="email" bind:value={editingStudent.email} />
          </div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" on:click={() => (editingStudent = null)}>Cancel</button>
          <button class="btn btn-primary" on:click={saveEdit}>Save Changes</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Devices modal -->
  {#if deviceModalStudent}
    <div class="modal-overlay" on:click|self={() => (deviceModalStudent = null)}>
      <div class="modal modal-lg">
        <div class="modal-header">
          <div>
            <h3>Hardware Devices</h3>
            <p class="meta">{deviceModalStudent.full_name} (<code>{deviceModalStudent.student_id}</code>)</p>
          </div>
          <button class="close-btn" on:click={() => (deviceModalStudent = null)}><Icon name="x" size={16} /></button>
        </div>
        <div class="modal-body">
          {#if (deviceModalStudent.devices || []).length === 0}
            <p class="muted pad-16">No devices registered for this student yet.</p>
          {:else}
            <table>
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Status</th>
                  <th>Device MAC</th>
                  <th>Network IP</th>
                  <th>Registered</th>
                  <th>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {#each deviceModalStudent.devices as d}
                  {@const plat = getPlatformInfo(d.user_agent)}
                  <tr>
                    <td>
                      <span class="platform-chip">
                        <Icon name={plat.icon} size={14} />
                        <span>{plat.label}</span>
                      </span>
                    </td>
                    <td>
                      <span class="pill pill-{d.status?.toLowerCase() || 'pending'}">{d.status}</span>
                    </td>
                    <td class="mono">
                      <code>{d.mac_address || deviceModalStudent.registered_mac || 'MAC-PENDING'}</code>
                    </td>
                    <td class="mono">{d.ip_address || deviceModalStudent.registered_ip || '—'}</td>
                    <td class="muted">{formatDate(d.registered_at)}</td>
                    <td class="muted">{formatDate(d.last_seen_at)}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
        <div class="modal-actions">
          <button class="btn ghost" on:click={() => (deviceModalStudent = null)}>Close</button>
        </div>
      </div>
    </div>
  {/if}

  <!-- Table -->
  <div class="table-wrap">
    {#if loading}
      <p class="muted center pad-24">Loading student directory…</p>
    {:else if students.length === 0}
      <div class="empty-state">
        <Icon name="students" size={32} color="#94a3b8" />
        <p>No students found.</p>
      </div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Matric ID</th>
            <th>Registered Device MAC</th>
            <th>Registered IP</th>
            <th>Device Auth</th>
            <th>Account Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each students as s}
            <tr class:dimmed={s.status === 'suspended'}>
              <td class="bold">{s.full_name}</td>
              <td><code>{s.student_id}</code></td>
              <td class="mono">
                <code>{s.registered_mac || (s.devices?.[0]?.mac_address) || '—'}</code>
              </td>
              <td class="mono">
                <span class="ip-chip">{s.registered_ip || (s.devices?.[0]?.ip_address) || '—'}</span>
              </td>
              <td>
                <button class="device-badge-btn" on:click={() => (deviceModalStudent = s)}>
                  <Icon name="smartphone" size={13} />
                  <span>{activeDevices(s).length} device{activeDevices(s).length !== 1 ? 's' : ''}</span>
                </button>
              </td>
              <td>
                <span class="pill {s.status === 'suspended' ? 'pill-suspended' : 'pill-active'}">
                  {s.status === 'suspended' ? 'Suspended' : 'Active'}
                </span>
              </td>
              <td class="actions">
                <button class="btn btn-sm ghost" on:click={() => (editingStudent = { ...s })} title="Edit Student">
                  <Icon name="edit" size={13} />
                  <span>Edit</span>
                </button>
                <button class="btn btn-sm btn-warn" on:click={() => resetDevice(s)} title="Reset Trusted Device">
                  <Icon name="refresh" size={13} />
                  <span>Reset Device</span>
                </button>
                <button class="btn btn-sm {s.status === 'suspended' ? 'btn-green' : 'btn-warn'}" on:click={() => toggleSuspend(s)}>
                  <Icon name={s.status === 'suspended' ? 'user-check' : 'user-x'} size={13} />
                  <span>{s.status === 'suspended' ? 'Reactivate' : 'Suspend'}</span>
                </button>
                <button class="btn btn-sm btn-del" on:click={() => remove(s)} title="Delete Student">
                  <Icon name="trash" size={13} />
                </button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
  <p class="count-txt">{students.length} student{students.length !== 1 ? 's' : ''} registered</p>
</div>

<style>
  .section { display: flex; flex-direction: column; gap: 20px; }

  .toolbar {
    display: flex; justify-content: space-between; align-items: center;
    gap: 16px; flex-wrap: wrap;
  }
  .search-row { display: flex; gap: 8px; flex: 1; max-width: 480px; }
  .search-input-wrap {
    position: relative; display: flex; align-items: center; flex: 1;
    background: white; border: 1px solid #cbd5e1; border-radius: 8px;
    padding: 0 12px; gap: 8px;
  }
  .search-input-wrap input {
    border: none; outline: none; padding: 10px 0; width: 100%;
    font-size: 13.5px; color: #0f172a; background: transparent;
  }
  .search-input-wrap:focus-within { border-color: #0284c7; box-shadow: 0 0 0 3px rgba(50, 240, 0, 0.22); }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 16px; border-radius: 8px; border: none;
    cursor: pointer; font-size: 13px; font-weight: 700; transition: all 0.15s;
  }
  .btn-primary {
    background: linear-gradient(135deg, #32F000 0%, #0db872 30%, #0284c7 68%, #073B78 100%);
    color: #ffffff;
    box-shadow: 0 3px 12px rgba(7, 59, 120, 0.2);
    text-shadow: 0 1px 2px rgba(7, 59, 120, 0.35);
  }
  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #2bd000 0%, #0aa062 30%, #0274b0 68%, #052c5c 100%);
    box-shadow: 0 4px 16px rgba(50, 240, 0, 0.35);
    transform: translateY(-1px);
  }
  .btn-teal {
    background: linear-gradient(135deg, #32F000 0%, #0db872 30%, #0284c7 68%, #073B78 100%);
    color: #ffffff;
    box-shadow: 0 3px 12px rgba(7, 59, 120, 0.2);
    text-shadow: 0 1px 2px rgba(7, 59, 120, 0.35);
  }
  .btn-teal:hover {
    background: linear-gradient(135deg, #2bd000 0%, #0aa062 30%, #0274b0 68%, #052c5c 100%);
    box-shadow: 0 4px 16px rgba(50, 240, 0, 0.35);
  }

  .btn-sm { padding: 5px 10px; font-size: 12px; border-radius: 6px; }
  .btn.ghost { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
  .btn.ghost:hover { background: #e2e8f0; color: #0f172a; }
  .btn-green { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .btn-green:hover { background: #d1fae5; }
  .btn-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }
  .btn-warn:hover { background: #fef3c7; }
  .btn-del { background: #fef2f2; color: #dc2626; border: 1px solid #fecaca; }
  .btn-del:hover { background: #fee2e2; }

  .form-card {
    background: white; border: 1px solid #e2e8f0; border-radius: 14px;
    padding: 22px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    display: flex; flex-direction: column; gap: 16px;
  }
  .card-title-row { display: flex; align-items: center; gap: 10px; }
  .card-title-row h3 { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }

  .form-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  label { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
  input {
    padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 8px;
    font-size: 14px; color: #0f172a; outline: none; background: #ffffff;
    transition: all 0.15s;
  }
  input:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.12); }
  .disabled-input { background: #f8fafc; color: #64748b; cursor: not-allowed; }

  .hint { font-size: 12px; color: #64748b; margin: 0; }
  .notice { padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; }
  .notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .reset-link-card {
    background: #f0fdfa; border: 1px solid #ccfbf1; border-radius: 10px;
    padding: 14px 18px; display: flex; flex-direction: column; gap: 8px;
  }
  .reset-link-header { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #0f766e; }
  .reset-link-card code {
    background: white; padding: 8px 12px; border-radius: 6px; border: 1px solid #ccfbf1;
    font-size: 12.5px; color: #0f766e; word-break: break-all;
  }

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
  .pad-16 { padding: 16px; }
  .pad-24 { padding: 24px; }
  .count-txt { font-size: 12.5px; color: #64748b; margin: 0; }

  .actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }

  .device-badge-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: #f0fdfa; border: 1px solid #ccfbf1; color: #0f766e;
    padding: 4px 10px; border-radius: 6px; font-size: 12px; font-weight: 600;
    cursor: pointer; transition: all 0.15s;
  }
  .device-badge-btn:hover { background: #ccfbf1; }

  .platform-chip {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 12.5px; font-weight: 500; color: #334155;
  }

  .ip-chip {
    display: inline-block;
    padding: 2px 6px;
    border-radius: 4px;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    color: #0f172a;
    font-size: 11.5px;
  }

  .pill {
    display: inline-block; padding: 3px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .pill-active { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .pill-suspended { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .pill-pending { background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
  .pill-authorized { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .pill-revoked { background: #f1f5f9; color: #64748b; border: 1px solid #cbd5e1; }
  .pill-blocked { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

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
    background: white; border-radius: 16px; width: 480px; max-width: 95vw;
    box-shadow: 0 20px 40px rgba(0,0,0,0.15); overflow: hidden;
  }
  .modal-lg { width: 680px; }
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
  .modal-body { padding: 20px 22px; display: flex; flex-direction: column; gap: 14px; max-height: 70vh; overflow-y: auto; }
  .modal-actions {
    padding: 14px 22px; border-top: 1px solid #e2e8f0;
    display: flex; justify-content: flex-end; gap: 10px; background: #f8fafc;
  }

  @media (max-width: 768px) {
    .toolbar {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
    }
    .search-row {
      max-width: 100%;
      width: 100%;
    }
    .form-row {
      grid-template-columns: 1fr;
    }
    .form-card {
      padding: 18px 16px;
    }
    .modal-body {
      padding: 16px;
    }
    .modal-header, .modal-actions {
      padding: 14px 16px;
    }
  }

  @media (max-width: 640px) {
    th, td {
      padding: 10px 14px;
      font-size: 12.5px;
    }
  }
</style>
