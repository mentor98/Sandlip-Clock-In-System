<script>
  import { onDestroy } from 'svelte';
  import { api } from './lib/api.js';
  import { subscribeTable } from './lib/realtime.js';
  import Icon from './lib/Icon.svelte';

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

  let records = [];
  let locations = [];
  let error = '';
  let loading = false;

  let filterFrom = '';
  let filterTo = '';
  let filterLocation = '';
  let filterStudent = '';

  async function loadLocations() {
    try {
      const res = await api('/admin/locations');
      locations = res.locations || [];
    } catch {}
  }

  async function load() {
    loading = true; error = '';
    try {
      const params = new URLSearchParams();
      if (filterFrom) params.set('from', filterFrom);
      if (filterTo) params.set('to', filterTo);
      if (filterLocation) params.set('location_id', filterLocation);
      if (filterStudent) params.set('student', filterStudent);
      const res = await api(`/admin/attendance?${params}`);
      records = res.attendance || [];
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }

  function exportCsv() {
    const params = new URLSearchParams();
    if (filterFrom) params.set('from', filterFrom);
    if (filterTo) params.set('to', filterTo);
    if (filterLocation) params.set('location_id', filterLocation);
    const token = localStorage.getItem('oasis_admin_session');
    window.open(`${API_BASE}/admin/attendance/export?${params}&auth=${encodeURIComponent(token)}`);
  }

  loadLocations();
  load();

  const unsubAttendance = subscribeTable('attendance', '*', () => load());
  onDestroy(() => unsubAttendance());

  function typeLabel(t) { return t === 'clock_in' ? 'Clock In' : 'Clock Out'; }
  function typeClass(t) { return t === 'clock_in' ? 'pill-in' : 'pill-out'; }

  $: totalIn = records.filter(r => r.type === 'clock_in').length;
  $: totalOut = records.filter(r => r.type === 'clock_out').length;
  $: uniqueStudents = new Set(records.map(r => r.student_id)).size;
</script>

<div class="section">
  <!-- Filters -->
  <div class="filter-card">
    <div class="filters">
      <div class="field">
        <label>From Date</label>
        <input type="date" bind:value={filterFrom} />
      </div>
      <div class="field">
        <label>To Date</label>
        <input type="date" bind:value={filterTo} />
      </div>
      <div class="field">
        <label>Location Geofence</label>
        <select bind:value={filterLocation}>
          <option value="">All Locations</option>
          {#each locations as loc}
            <option value={loc.id}>{loc.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label>Student Name / Matric ID</label>
        <div class="search-wrap">
          <Icon name="search" size={14} color="#64748b" />
          <input bind:value={filterStudent} placeholder="Search student…" on:keydown={(e) => e.key === 'Enter' && load()} />
        </div>
      </div>
    </div>
    <div class="filter-actions">
      <button class="btn btn-primary" on:click={load}>
        <Icon name="search" size={14} />
        <span>Filter Records</span>
      </button>
      <button class="btn ghost" on:click={() => { filterFrom=''; filterTo=''; filterLocation=''; filterStudent=''; load(); }}>
        <Icon name="x" size={14} />
        <span>Clear</span>
      </button>
      <button class="btn export" on:click={exportCsv}>
        <Icon name="download" size={14} />
        <span>Export CSV</span>
      </button>
    </div>
  </div>

  <!-- Stats -->
  <div class="stats">
    <div class="stat">
      <span class="stat-val">{records.length}</span>
      <span class="stat-lbl">Total Records</span>
    </div>
    <div class="stat">
      <span class="stat-val">{uniqueStudents}</span>
      <span class="stat-lbl">Unique Students</span>
    </div>
    <div class="stat">
      <span class="stat-val clock-in">{totalIn}</span>
      <span class="stat-lbl">Clock Ins</span>
    </div>
    <div class="stat">
      <span class="stat-val clock-out">{totalOut}</span>
      <span class="stat-lbl">Clock Outs</span>
    </div>
  </div>

  {#if error}<div class="notice error">{error}</div>{/if}

  <!-- Table -->
  <div class="table-wrap">
    {#if loading}
      <p class="muted center pad-24">Loading attendance logs…</p>
    {:else if records.length === 0}
      <div class="empty-state">
        <Icon name="clipboard" size={32} color="#94a3b8" />
        <p>No attendance records found matching filters.</p>
      </div>
    {:else}
      <table>
        <thead>
          <tr>
            <th>Student</th>
            <th>Matric ID</th>
            <th>Location</th>
            <th>Type</th>
            <th>Date</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {#each records as r}
            <tr>
              <td class="bold">{r.students?.full_name || '—'}</td>
              <td><code>{r.students?.student_id || '—'}</code></td>
              <td>{r.locations?.name || '—'}</td>
              <td><span class="pill {typeClass(r.type)}">{typeLabel(r.type)}</span></td>
              <td>{new Date(r.recorded_at).toLocaleDateString()}</td>
              <td class="muted">{new Date(r.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>

<style>
  .section { display: flex; flex-direction: column; gap: 20px; }

  .filter-card {
    background: white; border-radius: 14px; border: 1px solid #e2e8f0;
    padding: 20px 22px; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    display: flex; flex-direction: column; gap: 16px;
  }
  .filters { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  label { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
  input, select {
    padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 8px;
    font-size: 13.5px; color: #0f172a; outline: none; background: white;
    transition: all 0.15s;
  }
  input:focus, select:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.12); }

  .search-wrap {
    display: flex; align-items: center; gap: 8px; background: white;
    border: 1px solid #cbd5e1; border-radius: 8px; padding: 0 12px;
  }
  .search-wrap input { border: none; padding: 10px 0; width: 100%; box-shadow: none; }
  .search-wrap:focus-within { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.12); }

  .filter-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 16px; border-radius: 8px; border: 1px solid #cbd5e1;
    background: white; cursor: pointer; font-size: 13px; font-weight: 600;
    transition: all 0.15s; color: #334155;
  }
  .btn-primary { background: #0f766e; color: white; border-color: #0f766e; }
  .btn-primary:hover { background: #0b5c54; }
  .btn.ghost { background: #f8fafc; }
  .btn.ghost:hover { background: #f1f5f9; }
  .btn.export { background: #0f172a; color: white; border-color: #0f172a; margin-left: auto; }
  .btn.export:hover { background: #1e293b; }

  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; }
  .stat {
    background: white; border: 1px solid #e2e8f0; border-radius: 12px;
    padding: 16px 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);
    display: flex; flex-direction: column; gap: 6px;
  }
  .stat-val { font-size: 24px; font-weight: 700; color: #0f172a; letter-spacing: -0.02em; }
  .stat-val.clock-in { color: #0f766e; }
  .stat-val.clock-out { color: #64748b; }
  .stat-lbl { font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.04em; }

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

  .bold { font-weight: 600; color: #0f172a; }
  .muted { color: #94a3b8; }
  .center { text-align: center; }
  .pad-24 { padding: 24px; }

  .pill {
    display: inline-block; padding: 3px 9px; border-radius: 999px;
    font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.03em;
  }
  .pill-in { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .pill-out { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }

  .notice { padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; }
  .notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .empty-state {
    padding: 48px 20px; text-align: center; color: #94a3b8;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-size: 14px;
  }
</style>
