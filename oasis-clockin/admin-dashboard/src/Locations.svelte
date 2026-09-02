<script>
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import { api } from './lib/api.js';
  import Icon from './lib/Icon.svelte';

  let locations = [];
  let name = 'Sandlip Oasis - Main Complex', latitude = '8.928084', longitude = '11.330753', radius = 200;
  let activeStart = '', activeEnd = '';
  let error = '';
  let successMsg = '';
  let loading = false;

  // Map state
  let mapElement;
  let map = null;
  let draftMarker = null;
  let draftCircle = null;
  let locationLayerGroup = null;

  // QR state
  let qrLocation = null;
  let qrSrc = '';
  let qrExpiry = 0;
  let qrAdminIp = '';
  let qrTimer = null;
  let qrGenerating = false;
  let autoRotate = true;

  function initMap() {
    if (!mapElement || map) return;
    map = L.map(mapElement, {
      center: [parseFloat(latitude) || 8.9280843, parseFloat(longitude) || 11.3307533],
      zoom: 15,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    locationLayerGroup = L.layerGroup().addTo(map);

    // Draft pin for new location
    draftMarker = L.marker([parseFloat(latitude) || 8.9280843, parseFloat(longitude) || 11.3307533], { draggable: true }).addTo(map);
    draftCircle = L.circle([parseFloat(latitude) || 8.9280843, parseFloat(longitude) || 11.3307533], {
      radius: parseInt(radius, 10) || 200,
      color: '#0f766e',
      fillColor: '#0f766e',
      fillOpacity: 0.2,
      dashArray: '4, 4',
      weight: 2,
    }).addTo(map);

    draftMarker.on('dragend', () => {
      const pos = draftMarker.getLatLng();
      latitude = pos.lat.toFixed(6);
      longitude = pos.lng.toFixed(6);
      draftCircle.setLatLng(pos);
    });

    map.on('click', (e) => {
      const pos = e.latlng;
      latitude = pos.lat.toFixed(6);
      longitude = pos.lng.toFixed(6);
      draftMarker.setLatLng(pos);
      draftCircle.setLatLng(pos);
    });

    renderExistingLocations();
  }

  function renderExistingLocations() {
    if (!map || !locationLayerGroup) return;
    locationLayerGroup.clearLayers();

    locations.forEach(loc => {
      if (loc.latitude != null && loc.longitude != null) {
        const m = L.circleMarker([loc.latitude, loc.longitude], {
          radius: 8,
          fillColor: '#0f766e',
          color: '#ffffff',
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9,
        });

        m.bindPopup(`<b>${loc.name}</b><br>Radius: ±${loc.geofence_radius_m}m`);
        locationLayerGroup.addLayer(m);

        const c = L.circle([loc.latitude, loc.longitude], {
          radius: loc.geofence_radius_m || 50,
          color: '#0f766e',
          fillColor: '#0f766e',
          fillOpacity: 0.12,
          weight: 1.5,
        });
        locationLayerGroup.addLayer(c);
      }
    });
  }

  function updateDraft(lat, lng, rad) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radNum = parseInt(rad, 10) || 50;
    if (!isNaN(latNum) && !isNaN(lngNum) && map && draftMarker && draftCircle) {
      draftMarker.setLatLng([latNum, lngNum]);
      draftCircle.setLatLng([latNum, lngNum]);
      draftCircle.setRadius(radNum);
    }
  }

  $: if (map && (latitude || longitude || radius)) {
    updateDraft(latitude, longitude, radius);
  }

  async function load() {
    try {
      const res = await api('/admin/locations');
      locations = res.locations || [];
      renderExistingLocations();
    } catch (e) { error = e.message; }
  }

  onMount(() => {
    initMap();
    load();
  });

  onDestroy(() => {
    clearInterval(qrTimer);
    if (map) {
      map.remove();
      map = null;
    }
  });

  async function createLocation() {
    error = ''; successMsg = '';
    if (!name || !latitude || !longitude) { error = 'Name, latitude, and longitude are required.'; return; }
    loading = true;
    try {
      await api('/admin/locations', {
        method: 'POST',
        body: {
          name,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          geofence_radius_m: parseInt(radius, 10),
          active_start: activeStart || null,
          active_end: activeEnd || null,
        },
      });
      successMsg = `Location "${name}" created.`;
      name = '';
      radius = 50;
      load();
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }

  async function deleteLocation(loc) {
    if (!confirm(`Delete location "${loc.name}"?`)) return;
    error = '';
    try {
      await api(`/admin/locations/${loc.id}`, { method: 'DELETE' });
      load();
    } catch (e) { error = e.message; }
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition((pos) => {
      latitude = pos.coords.latitude.toFixed(6);
      longitude = pos.coords.longitude.toFixed(6);
      if (map) map.panTo([parseFloat(latitude), parseFloat(longitude)]);
      updateDraft(latitude, longitude, radius);
    }, () => { error = 'Could not get device location.'; });
  }

  async function generateQr(loc) {
    qrGenerating = true;
    error = '';
    clearInterval(qrTimer);
    try {
      const res = await api(`/admin/locations/${loc.id}/generate-qr`, { method: 'POST' });
      qrLocation = loc;
      qrSrc = `data:image/png;base64,${res.qr_png_base64}`;
      qrExpiry = res.expires_in_seconds || 25;
      qrAdminIp = res.admin_ip || '127.0.0.1';

      qrTimer = setInterval(() => {
        qrExpiry -= 1;
        if (qrExpiry <= 0) {
          clearInterval(qrTimer);
          if (autoRotate && qrLocation) {
            generateQr(qrLocation);
          } else {
            qrSrc = '';
          }
        }
      }, 1000);
    } catch (e) { error = e.message; }
    finally { qrGenerating = false; }
  }

  function closeQr() {
    clearInterval(qrTimer);
    qrLocation = null;
    qrSrc = '';
    qrExpiry = 0;
  }

  function refreshQr() {
    if (qrLocation) generateQr(qrLocation);
  }
</script>

<div class="layout">
  <!-- Left panel: Form + Interactive Map -->
  <div class="panel">
    <div class="card-title-row">
      <Icon name="map-pin" size={18} color="#0f766e" />
      <h3>Add Geofenced Location</h3>
    </div>
    <div class="field">
      <label for="loc-name">Location Name *</label>
      <input id="loc-name" bind:value={name} placeholder="e.g. Science Auditorium A1" />
    </div>

    <!-- Map Coordinate Picker -->
    <div class="map-section">
      <div class="map-label-row">
        <label>Geofence Pinpoint (OpenStreetMap)</label>
        <span class="map-hint">Click or drag pin to position</span>
      </div>
      <div bind:this={mapElement} class="map-container" id="osm-locations-map"></div>
    </div>

    <div class="row2">
      <div class="field">
        <label for="loc-lat">Latitude</label>
        <input id="loc-lat" bind:value={latitude} placeholder="6.5244" />
      </div>
      <div class="field">
        <label for="loc-lng">Longitude</label>
        <input id="loc-lng" bind:value={longitude} placeholder="3.3792" />
      </div>
    </div>
    <div class="field">
      <label for="loc-radius">Geofence Radius: <strong>{radius}m</strong></label>
      <div class="range-row">
        <input id="loc-radius-slider" type="range" bind:value={radius} min="10" max="1000" step="5" />
        <input id="loc-radius-input" type="number" bind:value={radius} min="10" max="5000" class="num-box" />
      </div>
    </div>
    <div class="row2">
      <div class="field">
        <label for="loc-start">Active From (optional)</label>
        <input id="loc-start" type="time" bind:value={activeStart} />
      </div>
      <div class="field">
        <label for="loc-end">Active Until (optional)</label>
        <input id="loc-end" type="time" bind:value={activeEnd} />
      </div>
    </div>
    <div class="btn-row">
      <button class="btn ghost" on:click={useMyLocation}>
        <Icon name="map-pin" size={14} />
        <span>Use My GPS</span>
      </button>
      <button class="btn btn-primary" on:click={createLocation} disabled={loading}>
        <Icon name="check" size={14} />
        <span>{loading ? 'Creating…' : 'Create Location'}</span>
      </button>
    </div>
    {#if successMsg}<p class="notice success">{successMsg}</p>{/if}
    {#if error}<p class="notice error">{error}</p>{/if}
  </div>

  <!-- Right panel: Locations list -->
  <div class="panel">
    <div class="card-title-row">
      <Icon name="building" size={18} color="#0f766e" />
      <h3>Registered Geofences ({locations.length})</h3>
    </div>
    {#if locations.length === 0}
      <div class="empty-state">
        <Icon name="map-pin" size={32} color="#94a3b8" />
        <p>No locations created yet.</p>
      </div>
    {:else}
      <div class="loc-list">
        {#each locations as loc}
          <div class="loc-card" class:active-qr={qrLocation?.id === loc.id}>
            <div class="loc-info">
              <div class="loc-name-row">
                <Icon name="map-pin" size={14} color="#0f766e" />
                <strong>{loc.name}</strong>
              </div>
              <span class="meta">
                Radius: ±{loc.geofence_radius_m}m &nbsp;·&nbsp;
                {Number(loc.latitude).toFixed(4)}, {Number(loc.longitude).toFixed(4)}
                {#if loc.active_start && loc.active_end}
                  &nbsp;·&nbsp; {loc.active_start}–{loc.active_end}
                {/if}
              </span>
            </div>
            <div class="loc-actions">
              <button class="btn btn-qr" on:click={() => generateQr(loc)} disabled={qrGenerating}>
                <Icon name="qr" size={14} />
                <span>{qrGenerating && qrLocation?.id === loc.id ? 'Generating…' : 'Dynamic QR'}</span>
              </button>
              <button class="btn btn-del" on:click={() => deleteLocation(loc)} title="Delete location">
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- QR modal -->
{#if qrLocation}
  <div class="qr-overlay" on:click|self={closeQr}>
    <div class="qr-modal">
      <div class="qr-header">
        <div>
          <h3>{qrLocation.name}</h3>
          <p class="meta">Dynamic anti-spoof attendance QR code</p>
        </div>
        <button class="close-btn" on:click={closeQr} aria-label="Close QR modal">
          <Icon name="x" size={16} />
        </button>
      </div>

      <div class="qr-body">
        {#if qrSrc && qrExpiry > 0}
          <img src={qrSrc} alt="QR code for {qrLocation.name}" class="qr-img" />
          <div class="expiry" class:expiry-warn={qrExpiry <= 10}>
            <Icon name="clock" size={14} />
            {#if qrExpiry > 0}
              <span>Rotating dynamically in <strong>{qrExpiry}s</strong></span>
            {:else}
              <span>Expired — generating new token</span>
            {/if}
          </div>

          <div class="qr-sec-info">
            <div class="sec-item">
              <Icon name="check" size={13} color="#16a34a" />
              <span>Admin Host IP: <code>{qrAdminIp || '127.0.0.1'}</code></span>
            </div>
            <div class="sec-item">
              <Icon name="smartphone" size={13} color="#0284c7" />
              <span>Student Network Subnet & Device Bound</span>
            </div>
          </div>
        {:else}
          <div class="qr-expired">
            <Icon name="clock" size={36} color="#94a3b8" />
            <p>QR code refreshing…</p>
          </div>
        {/if}
      </div>

      <div class="qr-footer">
        <div class="modal-ctrl-row">
          <button class="btn btn-primary full" on:click={refreshQr} disabled={qrGenerating}>
            <Icon name="refresh" size={14} />
            <span>{qrGenerating ? 'Generating…' : 'Rotate QR Now'}</span>
          </button>
        </div>
        <label class="auto-rotate-check">
          <input type="checkbox" bind:checked={autoRotate} />
          <span>Auto-rotate continuously every 25s for projector</span>
        </label>
        <p class="hint">Tokens are cryptographically signed with admin network identity and single-use nonce.</p>
      </div>
    </div>
  </div>
{/if}

<style>
  .layout { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 20px; align-items: start; }

  .panel {
    background: white; border-radius: 14px; padding: 22px 24px;
    border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
  }
  .card-title-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .card-title-row h3 { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }

  .field { margin-bottom: 14px; }
  .field label { display: block; font-size: 12px; font-weight: 600; color: #475569; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.03em; }
  input {
    width: 100%; padding: 10px 14px; border-radius: 8px;
    border: 1px solid #cbd5e1; font-size: 14px; box-sizing: border-box;
    color: #0f172a; outline: none; transition: all 0.15s;
  }
  input:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.12); }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .map-section { margin-bottom: 16px; }
  .map-label-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .map-label-row label { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
  .map-hint { font-size: 11px; color: #0f766e; font-weight: 600; }
  .map-container {
    width: 100%;
    height: 240px;
    border-radius: 10px;
    border: 1px solid #cbd5e1;
    overflow: hidden;
    z-index: 1;
  }

  .range-row { display: flex; align-items: center; gap: 12px; }
  .range-row input[type="range"] { flex: 1; accent-color: #0f766e; }
  .num-box { width: 80px; text-align: right; }

  .btn-row { display: flex; gap: 10px; margin-top: 18px; flex-wrap: wrap; }
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 9px 16px; border-radius: 8px; border: 1px solid #cbd5e1;
    background: white; cursor: pointer; font-size: 13px; font-weight: 600;
    transition: all 0.15s; white-space: nowrap; color: #334155;
  }
  .btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .btn-primary {
    background: linear-gradient(135deg, #32F000 0%, #0db872 30%, #0284c7 68%, #073B78 100%);
    color: white;
    border: none;
    font-weight: 700;
    box-shadow: 0 3px 12px rgba(7, 59, 120, 0.2);
    text-shadow: 0 1px 2px rgba(7, 59, 120, 0.35);
  }
  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #2bd000 0%, #0aa062 30%, #0274b0 68%, #052c5c 100%);
    box-shadow: 0 4px 16px rgba(50, 240, 0, 0.35);
    transform: translateY(-1px);
  }
  .btn.ghost { background: #f8fafc; color: #0f766e; border-color: #ccfbf1; }
  .btn.ghost:hover { background: #f0fdfa; }
  .btn-qr { background: #0f172a; color: white; border-color: #0f172a; }
  .btn-qr:hover:not(:disabled) { background: #0f766e; border-color: #0f766e; }
  .btn-del { background: #fef2f2; border-color: #fecaca; color: #dc2626; padding: 7px 10px; }
  .btn-del:hover { background: #fee2e2; }
  .full { width: 100%; justify-content: center; }

  .notice { padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-top: 10px; font-weight: 500; }
  .notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .loc-list { display: flex; flex-direction: column; gap: 10px; }
  .loc-card {
    border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 14px;
    display: flex; justify-content: space-between; align-items: center; gap: 12px;
    transition: border-color 0.15s; background: white;
  }
  .loc-card.active-qr { border-color: #0f766e; background: #f0fdfa; }
  .loc-info { display: flex; flex-direction: column; gap: 3px; }
  .loc-name-row { display: flex; align-items: center; gap: 6px; }
  .loc-name-row strong { font-size: 14px; color: #0f172a; }
  .meta { font-size: 11.5px; color: #64748b; }
  .loc-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }

  .empty-state {
    padding: 48px 20px; text-align: center; color: #94a3b8;
    display: flex; flex-direction: column; align-items: center; gap: 10px;
    font-size: 14px;
  }

  /* QR modal */
  .qr-overlay {
    position: fixed; inset: 0; background: rgba(15,23,42,0.6);
    backdrop-filter: blur(2px); display: flex; align-items: center; justify-content: center;
    z-index: 200;
  }
  .qr-modal {
    background: white; border-radius: 16px; width: 380px; max-width: 95vw;
    box-shadow: 0 20px 40px rgba(0,0,0,0.18);
    overflow: hidden;
  }
  .qr-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 18px 22px 14px;
    border-bottom: 1px solid #e2e8f0;
  }
  .qr-header h3 { margin: 0 0 2px; font-size: 16px; font-weight: 700; color: #0f172a; }
  .close-btn {
    border: none; background: #f1f5f9; border-radius: 6px; width: 28px; height: 28px;
    cursor: pointer; display: flex; align-items: center; justify-content: center;
    color: #64748b; transition: all 0.15s;
  }
  .close-btn:hover { background: #e2e8f0; color: #0f172a; }

  .qr-body {
    display: flex; flex-direction: column; align-items: center;
    padding: 22px; gap: 14px;
  }
  .qr-img {
    width: 250px; height: 250px;
    border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(0,0,0,0.06);
  }
  .expiry {
    display: inline-flex; align-items: center; gap: 6px;
    font-size: 13px; color: #475569;
    background: #f1f5f9; padding: 6px 16px; border-radius: 999px; font-weight: 500;
  }
  .expiry.expiry-warn { background: #fffbeb; color: #b45309; border: 1px solid #fde68a; }

  .qr-expired {
    width: 250px; height: 250px; border-radius: 12px;
    border: 2px dashed #cbd5e1; display: flex;
    flex-direction: column; align-items: center; justify-content: center;
    color: #94a3b8; gap: 8px;
  }
  .qr-expired p { margin: 0; font-size: 13px; font-weight: 600; }

  .qr-sec-info {
    width: 100%; box-sizing: border-box; background: #f8fafc; border: 1px solid #e2e8f0;
    border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px;
    font-size: 11.5px; color: #334155;
  }
  .sec-item { display: flex; align-items: center; gap: 7px; }
  .sec-item code { font-size: 11px; background: #e2e8f0; padding: 1px 5px; border-radius: 4px; }

  .auto-rotate-check {
    display: flex; align-items: center; justify-content: center; gap: 8px;
    font-size: 12px; color: #475569; font-weight: 600; cursor: pointer;
    margin: 4px 0;
  }
  .modal-ctrl-row { width: 100%; }

  .qr-footer { padding: 0 22px 22px; display: flex; flex-direction: column; gap: 8px; }
  .hint { font-size: 11px; color: #64748b; text-align: center; margin: 0; }

  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
  }

  @media (max-width: 640px) {
    .panel { padding: 18px 16px; }
    .row2 { grid-template-columns: 1fr; }
    .qr-modal { width: 95vw; margin: 10px; }
    .qr-image { width: 190px; height: 190px; }
    .loc-card {
      flex-direction: column;
      align-items: flex-start;
      gap: 10px;
    }
    .loc-actions {
      width: 100%;
      justify-content: flex-end;
    }
  }
</style>
