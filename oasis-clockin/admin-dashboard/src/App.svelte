<script>
  import { isLoggedIn, logout } from './lib/api.js';
  import Icon from './lib/Icon.svelte';
  import Login from './Login.svelte';
  import Overview from './Overview.svelte';
  import Students from './Students.svelte';
  import Devices from './Devices.svelte';
  import Locations from './Locations.svelte';
  import Sessions from './Sessions.svelte';
  import Attendance from './Attendance.svelte';
  import AuditLog from './AuditLog.svelte';
  import Organization from './Organization.svelte';
  import Settings from './Settings.svelte';

  let loggedIn = isLoggedIn();
  let tab = 'overview';
  let mobileMenuOpen = false;

  const tabs = [
    { id: 'overview',     label: 'Overview',     icon: 'overview' },
    { id: 'sessions',     label: 'Sessions',      icon: 'sessions' },
    { id: 'students',     label: 'Students',      icon: 'students' },
    { id: 'devices',      label: 'Devices',       icon: 'devices' },
    { id: 'locations',    label: 'Locations',     icon: 'locations' },
    { id: 'attendance',   label: 'Attendance',    icon: 'attendance' },
    { id: 'audit',        label: 'Audit Log',     icon: 'audit' },
    { id: 'organization', label: 'Organization',  icon: 'organization' },
    { id: 'settings',     label: 'Settings',      icon: 'settings' },
  ];

  const tabLabels = Object.fromEntries(tabs.map(t => [t.id, t.label]));

  function selectTab(id) {
    tab = id;
    mobileMenuOpen = false;
  }

  function handleLogout() { logout(); loggedIn = false; }
</script>

{#if !loggedIn}
  <Login onLoggedIn={() => (loggedIn = true)} />
{:else}
  <div class="shell">
    {#if mobileMenuOpen}
      <div class="sidebar-backdrop" on:click={() => (mobileMenuOpen = false)}></div>
    {/if}

    <aside class="sidebar" class:open={mobileMenuOpen}>
      <div class="brand">
        <div class="sidebar-logo-box">
          <img src="https://res.cloudinary.com/jinrrp4r/image/upload/v1788528009/clockin_logo_urwgwc.png" alt="Oasis ClockIn Logo" class="sidebar-logo-img" />
        </div>
        <div class="brand-text">
          <span class="brand-name">Oasis ClockIn</span>
          <span class="brand-sub">Enterprise Portal</span>
        </div>
        <button class="close-drawer-btn" on:click={() => (mobileMenuOpen = false)} aria-label="Close menu">
          <Icon name="x" size={18} color="#94a3b8" />
        </button>
      </div>

      <nav>
        {#each tabs as t}
          <button class:active={tab === t.id} on:click={() => selectTab(t.id)}>
            <span class="icon-wrap">
              <Icon name={t.icon} size={16} strokeWidth={2} />
            </span>
            <span class="nav-label">{t.label}</span>
          </button>
        {/each}
      </nav>

      <div class="sidebar-footer">
        <a href="/" class="student-link" title="Open Student Mobile PWA">
          <Icon name="smartphone" size={15} />
          <span>Student App</span>
        </a>
        <button class="logout" on:click={handleLogout}>
          <Icon name="logout" size={15} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>

    <main class="content">
      <header class="topbar">
        <div class="topbar-left">
          <button class="menu-btn" on:click={() => (mobileMenuOpen = !mobileMenuOpen)} aria-label="Toggle navigation menu">
            <Icon name="menu" size={20} color="#0f172a" />
          </button>
          <h2 class="page-title">{tabLabels[tab] || ''}</h2>
        </div>
        <div class="topbar-right">
          <span class="live-status">
            <span class="pulse-dot"></span>
            <span class="live-text">System Active</span>
          </span>
        </div>
      </header>
      <div class="page">
        {#if tab === 'overview'}<Overview />{/if}
        {#if tab === 'sessions'}<Sessions />{/if}
        {#if tab === 'students'}<Students />{/if}
        {#if tab === 'devices'}<Devices />{/if}
        {#if tab === 'locations'}<Locations />{/if}
        {#if tab === 'attendance'}<Attendance />{/if}
        {#if tab === 'audit'}<AuditLog />{/if}
        {#if tab === 'organization'}<Organization />{/if}
        {#if tab === 'settings'}<Settings />{/if}
      </div>
    </main>
  </div>
{/if}

<style>
  :global(*, *::before, *::after) { box-sizing: border-box; }
  :global(body) {
    margin: 0;
    background: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    color: #0f172a;
    -webkit-font-smoothing: antialiased;
  }

  .shell { display: flex; min-height: 100vh; }

  .sidebar {
    width: 240px; background: #071527; color: #f1f5f9;
    display: flex; flex-direction: column; padding: 24px 16px;
    flex-shrink: 0; position: fixed; top: 0; left: 0; bottom: 0;
    overflow-y: auto; border-right: 1px solid rgba(50, 240, 0, 0.12);
    z-index: 20;
  }
  .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; padding: 0 6px; }
  .brand-text { flex: 1; }
  .sidebar-logo-box {
    height: 38px;
    max-width: 72px;
    background: #ffffff;
    padding: 3px 6px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.25);
    flex-shrink: 0;
  }
  .sidebar-logo-img {
    height: 100%;
    width: auto;
    max-width: 100%;
    object-fit: contain;
    display: block;
  }
  .brand-name { display: block; font-weight: 800; font-size: 15.5px; letter-spacing: -0.01em; color: #ffffff; }
  .brand-sub { display: block; font-size: 10.5px; color: #93c5fd; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }

  .close-drawer-btn {
    display: none;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 6px;
    border-radius: 6px;
    color: #94a3b8;
  }
  .close-drawer-btn:hover { background: rgba(255,255,255,0.08); color: #ffffff; }

  .sidebar-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(7, 21, 39, 0.7);
    backdrop-filter: blur(2px);
    z-index: 40;
    animation: fadeIn 0.15s ease-out;
  }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

  .menu-btn {
    display: none;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 7px 9px;
    cursor: pointer;
    align-items: center;
    justify-content: center;
    margin-right: 12px;
    transition: all 0.15s;
  }
  .menu-btn:hover { background: #e2e8f0; }

  .topbar-left { display: flex; align-items: center; }

  nav { display: flex; flex-direction: column; gap: 4px; flex: 1; }
  nav button {
    display: flex; align-items: center; gap: 11px; padding: 10px 12px;
    border-radius: 9px; border: none; background: transparent;
    color: #94a3b8; cursor: pointer; font-size: 13.5px; font-weight: 600;
    text-align: left; transition: all 0.15s ease; width: 100%;
  }
  nav button:hover { background: rgba(255,255,255,0.06); color: #ffffff; }
  nav button.active {
    background: linear-gradient(135deg, #32F000 0%, #0db872 30%, #0284c7 68%, #073B78 100%);
    color: #ffffff; font-weight: 700;
    box-shadow: 0 4px 14px rgba(7, 59, 120, 0.35);
    text-shadow: 0 1px 2px rgba(7, 59, 120, 0.4);
  }
  .icon-wrap { width: 18px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .nav-label { flex: 1; }

  .sidebar-footer {
    display: flex; flex-direction: column; gap: 6px;
    margin-top: 20px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08);
  }
  .student-link {
    display: flex; align-items: center; gap: 9px; padding: 9px 12px;
    border-radius: 8px; text-decoration: none; color: #32F000;
    background: rgba(50, 240, 0, 0.1); border: 1px solid rgba(50, 240, 0, 0.2);
    font-size: 13px; font-weight: 700;
    transition: all 0.15s;
  }
  .student-link:hover { background: rgba(50, 240, 0, 0.18); color: #ffffff; }

  .logout {
    display: flex; align-items: center; gap: 9px;
    padding: 9px 12px; border-radius: 8px;
    border: 1px solid rgba(255,255,255,0.08); background: transparent; color: #94a3b8;
    cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.15s; width: 100%;
  }
  .logout:hover { background: rgba(239,68,68,0.12); border-color: rgba(239,68,68,0.25); color: #fca5a5; }

  .content { margin-left: 240px; flex: 1; display: flex; flex-direction: column; min-height: 100vh; background: #f8fafc; }
  .topbar {
    background: #ffffff; padding: 16px 32px; border-bottom: 1px solid #e2e8f0;
    position: sticky; top: 0; z-index: 10;
    display: flex; align-items: center; justify-content: space-between;
    box-shadow: 0 1px 3px 0 rgba(7, 59, 120, 0.04);
  }
  .page-title { margin: 0; font-size: 18px; font-weight: 800; color: #071527; letter-spacing: -0.01em; }
  .live-status {
    display: inline-flex; align-items: center; gap: 8px;
    font-size: 12px; font-weight: 700; color: #15803d;
    background: #f0fdf4; border: 1px solid #bbf7d0;
    padding: 5px 12px; border-radius: 999px;
  }
  .pulse-dot {
    width: 7px; height: 7px; border-radius: 50%; background: #32F000;
    box-shadow: 0 0 8px rgba(50, 240, 0, 0.8);
  }
  .page { padding: 28px 32px; flex: 1; }

  @media (max-width: 992px) {
    .menu-btn { display: inline-flex; }
    .close-drawer-btn { display: flex; align-items: center; justify-content: center; }
    .sidebar {
      width: 270px;
      transform: translateX(-100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 50;
      box-shadow: 4px 0 24px rgba(7, 21, 39, 0.4);
    }
    .sidebar.open {
      transform: translateX(0);
    }
    .content {
      margin-left: 0;
      width: 100%;
    }
    .topbar {
      padding: 14px 20px;
    }
    .page {
      padding: 20px 18px;
    }
  }

  @media (max-width: 640px) {
    .topbar {
      padding: 10px 14px;
    }
    .page-title {
      font-size: 16px;
    }
    .live-status {
      font-size: 11px;
      padding: 4px 8px;
      gap: 6px;
    }
    .live-text {
      display: none;
    }
    .pulse-dot::after {
      content: ' Live';
      font-size: 11px;
      font-weight: 700;
      color: #15803d;
      margin-left: 12px;
    }
    .page {
      padding: 14px 12px;
    }
  }
</style>
