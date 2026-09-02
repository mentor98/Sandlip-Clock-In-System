<script>
  import { onMount, onDestroy } from 'svelte';
  import L from 'leaflet';
  import { api } from './lib/api.js';
  import Icon from './lib/Icon.svelte';

  let config = null;
  let networks = [];
  let error = '';
  let successMsg = '';
  let loading = false;
  let networkLoading = false;
  let newCidr = '';
  let newLabel = '';

  // Form fields
  let name = 'Sandlip Oasis', address = 'Sandlip Oasis Campus', latitude = '8.928084', longitude = '11.330753';
  let attendanceRadius = 200;
  let requireGps = true;
  let requireDeviceAuth = true;
  let requireIpMatch = true;
  let requireWifiMatch = true;
  let requireQr = false;
  let ipCheckMode = 'warn';
  let workStartTime = '08:00';
  let gracePeriodMinutes = 15;
  let earlyThresholdMinutes = 15;
  let wifiMac = 'be:64:b4:14:4d:67';
  let wifiIp = '192.168.1.156';
  let wifiSsid = 'Sandlip-Oasis-WiFi';

  let mapElement;
  let map = null;
  let marker = null;
  let circle = null;

  function initMap(lat, lng, radius) {
    if (!mapElement || map) return;
    const initialLat = parseFloat(lat) || 8.9280843;
    const initialLng = parseFloat(lng) || 11.3307533;
    const initialRadius = parseInt(radius, 10) || 200;

    map = L.map(mapElement, {
      center: [initialLat, initialLng],
      zoom: 15,
    });

    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);

    marker = L.marker([initialLat, initialLng], { draggable: true }).addTo(map);
    marker.bindPopup(`<b>${name || 'Organization'}</b><br>Attendance Center`).openPopup();

    circle = L.circle([initialLat, initialLng], {
      radius: initialRadius,
      color: '#0f766e',
      fillColor: '#0f766e',
      fillOpacity: 0.18,
      weight: 2,
    }).addTo(map);

    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      latitude = pos.lat.toFixed(6);
      longitude = pos.lng.toFixed(6);
      circle.setLatLng(pos);
    });

    map.on('click', (e) => {
      const pos = e.latlng;
      latitude = pos.lat.toFixed(6);
      longitude = pos.lng.toFixed(6);
      marker.setLatLng(pos);
      circle.setLatLng(pos);
    });
  }

  function updateMapPosition(lat, lng, rad) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    const radNum = parseInt(rad, 10) || 150;
    if (!isNaN(latNum) && !isNaN(lngNum) && map && marker && circle) {
      marker.setLatLng([latNum, lngNum]);
      circle.setLatLng([latNum, lngNum]);
      circle.setRadius(radNum);
      map.panTo([latNum, lngNum]);
    }
  }

  $: if (map && (latitude || longitude || attendanceRadius)) {
    updateMapPosition(latitude, longitude, attendanceRadius);
  }

  async function load() {
    try {
      const [orgRes, netRes] = await Promise.all([
        api('/organization'),
        api('/organization/networks'),
      ]);
      config = orgRes.config;
      networks = netRes.networks || [];
      if (config) {
        name = config.name || '';
        address = config.address || '';
        latitude = config.latitude != null ? String(config.latitude) : '6.5244';
        longitude = config.longitude != null ? String(config.longitude) : '3.3792';
        attendanceRadius = config.attendance_radius_m || 150;
        requireGps = config.require_gps ?? true;
        requireDeviceAuth = config.require_device_auth ?? true;
        requireIpMatch = config.require_ip_match ?? true;
        requireWifiMatch = config.require_wifi_match ?? true;
        requireQr = config.require_qr ?? false;
        ipCheckMode = config.ip_check_mode || 'warn';
        workStartTime = config.work_start_time || '08:00';
        gracePeriodMinutes = config.grace_period_minutes != null ? config.grace_period_minutes : 15;
        earlyThresholdMinutes = config.early_threshold_minutes != null ? config.early_threshold_minutes : 15;
        wifiMac = config.wifi_mac || 'be:64:b4:14:4d:67';
        wifiIp = config.wifi_ip || '192.168.1.156';
        wifiSsid = config.wifi_ssid || 'Oasis-Campus-WiFi';

        if (map) {
          updateMapPosition(latitude, longitude, attendanceRadius);
        } else if (mapElement) {
          initMap(latitude, longitude, attendanceRadius);
        }
      }
    } catch (e) { error = e.message; }
  }

  onMount(() => {
    initMap(latitude, longitude, attendanceRadius);
    load();
  });

  onDestroy(() => {
    if (map) {
      map.remove();
      map = null;
    }
  });

  async function save() {
    error = ''; successMsg = ''; loading = true;
    if (!name) { error = 'Organization name is required.'; loading = false; return; }
    try {
      await api('/organization', {
        method: 'PUT',
        body: {
          name,
          address,
          latitude: latitude ? parseFloat(latitude) : null,
          longitude: longitude ? parseFloat(longitude) : null,
          attendance_radius_m: parseInt(attendanceRadius, 10),
          require_gps: requireGps,
          require_device_auth: requireDeviceAuth,
          require_ip_match: requireIpMatch,
          require_wifi_match: requireWifiMatch,
          require_qr: requireQr,
          ip_check_mode: ipCheckMode,
          work_start_time: workStartTime,
          grace_period_minutes: parseInt(gracePeriodMinutes, 10),
          early_threshold_minutes: parseInt(earlyThresholdMinutes, 10),
          wifi_mac: wifiMac,
          wifi_ip: wifiIp,
          wifi_ssid: wifiSsid,
        },
      });
      successMsg = 'Organization configuration, designated WiFi network, work schedule, and geofence saved successfully.';
      load();
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }

  function useMyLocation() {
    navigator.geolocation.getCurrentPosition(pos => {
      latitude = pos.coords.latitude.toFixed(6);
      longitude = pos.coords.longitude.toFixed(6);
      updateMapPosition(latitude, longitude, attendanceRadius);
    }, () => { error = 'Could not retrieve device location.'; });
  }

  async function addNetwork() {
    error = ''; successMsg = ''; networkLoading = true;
    if (!newCidr) { error = 'Enter an IP or CIDR range.'; networkLoading = false; return; }
    try {
      await api('/organization/networks', { method: 'POST', body: { cidr: newCidr, label: newLabel || newCidr } });
      successMsg = `Network ${newCidr} added.`;
      newCidr = ''; newLabel = '';
      load();
    } catch (e) { error = e.message; }
    finally { networkLoading = false; }
  }

  async function removeNetwork(id) {
    error = '';
    try {
      await api(`/organization/networks/${id}`, { method: 'DELETE' });
      load();
    } catch (e) { error = e.message; }
  }
</script>

<div class="layout">
  <!-- Left column: config & OSM Map -->
  <div class="col">
    <div class="card">
      <div class="card-title-row">
        <div class="title-with-icon">
          <Icon name="organization" size={18} color="#0f766e" />
          <h3>Institution Profile & Geofence</h3>
        </div>
        <span class="badge-tag">OSM Geofence Layer</span>
      </div>

      <div class="field">
        <label for="org-name">Organization / Institution Name *</label>
        <input id="org-name" bind:value={name} placeholder="e.g. Oasis Institute of Technology" />
      </div>
      <div class="field">
        <label for="org-address">Physical Campus Address</label>
        <input id="org-address" bind:value={address} placeholder="14 University Way, Innovation Campus" />
      </div>

      <!-- OpenStreetMap Container -->
      <div class="map-section">
        <div class="map-header">
          <label>Campus Coordinate Zone</label>
          <span class="map-hint">Click or drag pin to position central beacon</span>
        </div>
        <div bind:this={mapElement} class="map-container" id="osm-org-map"></div>
      </div>

      <div class="row2">
        <div class="field">
          <label for="org-lat">Latitude</label>
          <input id="org-lat" bind:value={latitude} placeholder="6.5244" />
        </div>
        <div class="field">
          <label for="org-lng">Longitude</label>
          <input id="org-lng" bind:value={longitude} placeholder="3.3792" />
        </div>
      </div>

      <div class="btn-row-sm">
        <button class="btn ghost btn-sm" on:click={useMyLocation}>
          <Icon name="map-pin" size={13} />
          <span>Use My GPS Location</span>
        </button>
      </div>

      <div class="field">
        <label for="org-radius">Attendance Perimeter Radius: <strong>{attendanceRadius}m</strong></label>
        <div class="range-row">
          <input id="org-radius-slider" type="range" bind:value={attendanceRadius} min="20" max="2000" step="10" />
          <input id="org-radius-input" type="number" bind:value={attendanceRadius} min="10" max="10000" class="radius-num" />
        </div>
        <p class="hint">Students must be within this perimeter to clock in verified attendance.</p>
      </div>

      <h4 class="sec-heading">Multi-Signal Verification Policy</h4>
      <div class="toggles">
        <label class="toggle">
          <input type="checkbox" bind:checked={requireGps} />
          <div class="toggle-content">
            <strong>Require GPS Proximity</strong>
            <p class="toggle-desc">Enforces server-side Haversine geofence check</p>
          </div>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={requireDeviceAuth} />
          <div class="toggle-content">
            <strong>Require Admin-Authorized Device</strong>
            <p class="toggle-desc">Only registered & authorized hardware devices can clock in</p>
          </div>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={requireQr} />
          <div class="toggle-content">
            <strong>Require Dynamic QR Scan</strong>
            <p class="toggle-desc">Requires fresh cryptographic single-use QR token</p>
          </div>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={requireIpMatch} />
          <div class="toggle-content">
            <strong>Require Campus IP Network Match</strong>
            <p class="toggle-desc">Validates connection from approved institutional subnets</p>
          </div>
        </label>
        <label class="toggle">
          <input type="checkbox" bind:checked={requireWifiMatch} />
          <div class="toggle-content">
            <strong>Require Designated WiFi Gateway (MAC &amp; IP)</strong>
            <p class="toggle-desc">Strictly validates connection to designated campus AP hardware</p>
          </div>
        </label>
      </div>

      <div class="field">
        <label for="org-ip-mode">IP Check Enforcement Policy</label>
        <select id="org-ip-mode" bind:value={ipCheckMode}>
          <option value="off">Off — Skip IP network enforcement</option>
          <option value="warn">Warn — Flag mismatch in audit telemetry without rejection</option>
          <option value="strict">Strict — Reject clock-in if network IP is outside whitelist</option>
        </select>
      </div>

      <h4 class="sec-heading">Work Schedule & Punctuality Policy</h4>
      <div class="schedule-grid">
        <div class="field">
          <label for="org-start-time">Official Start Time (Clock-in)</label>
          <input id="org-start-time" type="time" bind:value={workStartTime} />
          <p class="hint">Standard expected arrival time</p>
        </div>
        <div class="field">
          <label for="org-grace">Towards/Grace Window (Minutes)</label>
          <input id="org-grace" type="number" min="0" max="120" bind:value={gracePeriodMinutes} />
          <p class="hint">Up to +{gracePeriodMinutes}m = TOWARDS / On-Time</p>
        </div>
        <div class="field">
          <label for="org-early">Early Arrival Threshold (Minutes)</label>
          <input id="org-early" type="number" min="0" max="180" bind:value={earlyThresholdMinutes} />
          <p class="hint">&gt; {earlyThresholdMinutes}m before start = EARLY</p>
        </div>
      </div>
      <div class="punct-preview-note">
        <span class="punct-pill-sm punct-early">EARLY: &gt; {earlyThresholdMinutes}m prior</span>
        <span class="punct-pill-sm punct-towards">TOWARDS: -{earlyThresholdMinutes}m to +{gracePeriodMinutes}m</span>
        <span class="punct-pill-sm punct-late">LATE: &gt; +{gracePeriodMinutes}m after start</span>
      </div>

      <button class="btn btn-primary" on:click={save} disabled={loading}>
        <Icon name="check" size={14} />
        <span>{loading ? 'Saving…' : 'Save Organization Settings'}</span>
      </button>
      {#if successMsg}<p class="notice success">{successMsg}</p>{/if}
      {#if error}<p class="notice error">{error}</p>{/if}
    </div>
  </div>

  <!-- Right column: Approved networks & Designated WiFi Gateway -->
  <div class="col">
    <!-- Designated Campus WiFi Gateway -->
    <div class="card wifi-gateway-card">
      <div class="title-with-icon">
        <Icon name="shield" size={18} color="#0f766e" />
        <h3>Designated Campus WiFi Gateway</h3>
      </div>
      <p class="hint-block">Students scanning QR codes must be connected through this authorized hardware WiFi router &amp; IPv4 address gateway.</p>

      <div class="wifi-fields">
        <div class="field">
          <label for="wifi-mac">Designated WiFi MAC Address *</label>
          <input id="wifi-mac" bind:value={wifiMac} placeholder="be:64:b4:14:4d:67" />
          <span class="field-hint">Binds scan validation to Access Point BSSID/MAC</span>
        </div>
        <div class="field">
          <label for="wifi-ip">Designated IPv4 Address *</label>
          <input id="wifi-ip" bind:value={wifiIp} placeholder="192.168.1.156" />
          <span class="field-hint">Target IPv4 network host address</span>
        </div>
        <div class="field">
          <label for="wifi-ssid">Campus WiFi SSID</label>
          <input id="wifi-ssid" bind:value={wifiSsid} placeholder="Oasis-Campus-WiFi" />
        </div>
      </div>

      <div class="wifi-status-badge">
        <span class="dot-online"></span>
        <span>Gateway Configured: <code>{wifiMac}</code> · <code>{wifiIp}</code></span>
      </div>
    </div>

    <!-- Approved campus subnets -->
    <div class="card">
      <div class="title-with-icon">
        <Icon name="wifi" size={18} color="#0f766e" />
        <h3>Approved Campus Networks</h3>
      </div>
      <p class="hint-block">Register institutional public IP addresses or CIDR subnets (e.g. <code>192.168.1.156</code>, <code>197.210.65.0/24</code>). When students clock in, the backend matches their public network IP against these ranges.</p>

      <div class="add-network">
        <div class="field">
          <label for="new-cidr">IP Address or CIDR Range *</label>
          <input id="new-cidr" bind:value={newCidr} placeholder="e.g. 192.168.1.156 or 197.210.65.0/24" />
        </div>
        <div class="field">
          <label for="new-label">Network Label</label>
          <input id="new-label" bind:value={newLabel} placeholder="e.g. Campus Wi-Fi / Computer Lab" />
        </div>
        <button class="btn btn-primary" on:click={addNetwork} disabled={networkLoading}>
          <Icon name="plus" size={14} />
          <span>{networkLoading ? 'Adding…' : 'Add Approved Network'}</span>
        </button>
      </div>

      <div class="net-list">
        <h4 class="sec-heading">Configured Subnets ({networks.length})</h4>
        {#if networks.length === 0}
          <div class="empty-state-sm">
            <Icon name="wifi" size={24} color="#94a3b8" />
            <p>No campus networks configured yet.</p>
          </div>
        {:else}
          {#each networks as net}
            <div class="net-item">
              <div>
                <div class="net-cidr-row">
                  <Icon name="wifi" size={13} color="#0f766e" />
                  <code>{net.cidr}</code>
                </div>
                {#if net.label}<span class="net-lbl">{net.label}</span>{/if}
              </div>
              <button class="btn-del-sm" on:click={() => removeNetwork(net.id)} title="Remove network">
                <Icon name="trash" size={13} />
              </button>
            </div>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .layout { display: grid; grid-template-columns: 1.25fr 0.75fr; gap: 20px; align-items: start; }
  @media (max-width: 960px) { .layout { grid-template-columns: 1fr; } }

  .col { display: flex; flex-direction: column; gap: 20px; }
  .card {
    background: white; border-radius: 14px; padding: 22px 24px;
    border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    display: flex; flex-direction: column; gap: 14px;
  }
  .card-title-row { display: flex; justify-content: space-between; align-items: center; }
  .title-with-icon { display: flex; align-items: center; gap: 10px; }
  .title-with-icon h3 { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
  .badge-tag { font-size: 11px; font-weight: 600; color: #0f766e; background: #f0fdfa; border: 1px solid #ccfbf1; padding: 3px 8px; border-radius: 6px; }

  .field { display: flex; flex-direction: column; gap: 6px; }
  label { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
  input, select {
    padding: 10px 14px; border: 1px solid #cbd5e1; border-radius: 8px;
    font-size: 13.5px; color: #0f172a; outline: none; background: white;
    transition: all 0.15s;
  }
  input:focus, select:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.12); }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

  .map-section { margin: 4px 0 8px; }
  .map-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .map-header label { font-size: 12px; font-weight: 600; color: #475569; }
  .map-hint { font-size: 11px; color: #0f766e; font-weight: 600; }
  .map-container {
    width: 100%; height: 240px; border-radius: 10px;
    border: 1px solid #cbd5e1; overflow: hidden; z-index: 1;
  }

  .btn-row-sm { display: flex; margin-bottom: 4px; }
  .range-row { display: flex; align-items: center; gap: 12px; }
  .range-row input[type="range"] { flex: 1; accent-color: #0f766e; }
  .radius-num { width: 90px; text-align: right; }

  .sec-heading { margin: 8px 0 0; font-size: 14px; font-weight: 700; color: #0f172a; }

  .toggles { display: flex; flex-direction: column; gap: 10px; }
  .toggle {
    display: flex; align-items: flex-start; gap: 12px; padding: 10px 14px;
    border: 1px solid #e2e8f0; border-radius: 10px; cursor: pointer;
    background: #f8fafc; transition: all 0.15s;
  }
  .toggle:hover { background: #f1f5f9; border-color: #cbd5e1; }
  .toggle input[type="checkbox"] { width: 18px; height: 18px; margin-top: 2px; accent-color: #0f766e; }
  .toggle-content { display: flex; flex-direction: column; gap: 2px; }
  .toggle-content strong { font-size: 13.5px; color: #0f172a; }
  .toggle-desc { font-size: 12px; color: #64748b; margin: 0; }

  .hint { font-size: 12px; color: #64748b; margin: 0; }
  .hint-block { font-size: 12.5px; color: #64748b; line-height: 1.5; margin: 0; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 10px 18px; border-radius: 8px; border: none;
    cursor: pointer; font-size: 13.5px; font-weight: 600; transition: all 0.15s;
  }
  .btn-primary { background: #0f766e; color: white; align-self: flex-start; }
  .btn-primary:hover:not(:disabled) { background: #0b5c54; }
  .btn.ghost { background: #f8fafc; color: #0f766e; border: 1px solid #ccfbf1; }
  .btn.ghost:hover { background: #f0fdfa; }
  .btn-sm { padding: 6px 12px; font-size: 12px; border-radius: 6px; }

  .add-network { display: flex; flex-direction: column; gap: 12px; padding: 14px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; }
  .net-list { display: flex; flex-direction: column; gap: 8px; margin-top: 6px; }
  .net-item {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px 14px; background: white; border: 1px solid #e2e8f0; border-radius: 8px;
  }
  .net-cidr-row { display: flex; align-items: center; gap: 6px; }
  .net-cidr-row code { font-size: 13px; font-weight: 600; color: #0f172a; }
  .net-lbl { font-size: 11.5px; color: #64748b; margin-top: 2px; display: block; }

  .btn-del-sm {
    border: 1px solid #fecaca; background: #fef2f2; color: #dc2626;
    padding: 6px 8px; border-radius: 6px; cursor: pointer; transition: all 0.15s;
  }
  .btn-del-sm:hover { background: #fee2e2; }

  .empty-state-sm {
    padding: 24px; text-align: center; color: #94a3b8;
    display: flex; flex-direction: column; align-items: center; gap: 8px; font-size: 13px;
  }

  .schedule-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
  }

  .punct-preview-note {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
    background: #f8fafc;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
  }

  .punct-pill-sm {
    padding: 3px 8px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 700;
  }
  .punct-pill-sm.punct-early { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
  .punct-pill-sm.punct-towards { background: #e0f2fe; color: #0284c7; border: 1px solid #7dd3fc; }
  .punct-pill-sm.punct-late { background: #fee2e2; color: #dc2626; border: 1px solid #fca5a5; }

  .notice { padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; }
  .notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  .wifi-gateway-card { border-left: 4px solid #0f766e; background: linear-gradient(180deg, #f0fdfa 0%, #ffffff 100px); }
  .wifi-fields { display: flex; flex-direction: column; gap: 12px; }
  .field-hint { font-size: 11px; color: #64748b; font-family: monospace; }
  .wifi-status-badge {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 8px 12px; background: #ecfdf5; border: 1px solid #a7f3d0;
    border-radius: 8px; font-size: 12px; font-weight: 600; color: #065f46;
  }
  .dot-online { width: 8px; height: 8px; border-radius: 50%; background: #10b981; display: inline-block; box-shadow: 0 0 6px #10b981; }
</style>
