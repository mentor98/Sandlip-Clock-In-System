<script>
  import { api, setAdminSession } from './lib/api.js';
  import Icon from './lib/Icon.svelte';

  export let onLoggedIn;

  let adminId = '';
  let password = '';
  let error = '';
  let loading = false;

  async function login() {
    error = '';
    if (!adminId.trim() || !password) {
      error = 'Please enter both Admin Identifier and Password.';
      return;
    }
    loading = true;
    try {
      const res = await api('/admin-auth/login', {
        method: 'POST',
        body: { admin_id: adminId.trim(), password },
        auth: false,
      });
      setAdminSession(res.sessionToken);
      onLoggedIn();
    } catch (e) {
      error = e.message || 'Invalid admin ID or password.';
    } finally {
      loading = false;
    }
  }

  function handleKey(e, fn) { if (e.key === 'Enter') fn(); }
</script>

<main class="login-center-page">
  <!-- Centered Sign In Form -->
  <section class="form-container">
    <div class="form-card">
      <div class="brand-header">
        <div class="admin-logo-box">
          <img src="https://res.cloudinary.com/jinrrp4r/image/upload/v1788528009/clockin_logo_urwgwc.png" alt="Oasis ClockIn Logo" class="admin-logo-img" />
        </div>
        <div>
          <h1>Oasis ClockIn</h1>
          <p class="sub">Enterprise Administration Portal</p>
        </div>
      </div>

      <div class="welcome-text">
        <h2>Admin Sign In</h2>
        <p>Enter your administrator credentials to access real-time attendance telemetry and controls.</p>
      </div>

      <div class="field">
        <label for="aid">Admin Identifier</label>
        <div class="input-wrap">
          <Icon name="shield" size={16} color="#64748b" />
          <input
            id="aid"
            bind:value={adminId}
            placeholder="e.g. ADMIN-001"
            autocomplete="username"
            on:keydown={(e) => handleKey(e, login)}
          />
        </div>
      </div>

      <div class="field">
        <label for="pwd">Password</label>
        <div class="input-wrap">
          <Icon name="lock" size={16} color="#64748b" />
          <input
            id="pwd"
            type="password"
            bind:value={password}
            placeholder="Enter your admin password"
            autocomplete="current-password"
            on:keydown={(e) => handleKey(e, login)}
          />
        </div>
      </div>

      <button class="btn-primary" on:click={login} disabled={loading}>
        <Icon name="lock" size={16} color="#ffffff" strokeWidth={2.2} />
        <span>{loading ? 'Authenticating…' : 'Sign in to Dashboard'}</span>
      </button>

      {#if error}
        <div class="error-notice" role="alert">
          <Icon name="alert-triangle" size={15} color="#dc2626" />
          <span>{error}</span>
        </div>
      {/if}

      <div class="switch-app-wrap">
        <a href="/" class="student-switch-btn">
          <Icon name="smartphone" size={16} color="#0f766e" strokeWidth={2} />
          <span>Switch to Student Attendance PWA</span>
        </a>
      </div>
    </div>
  </section>
</main>

<style>
  .login-center-page {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 32px 20px;
    box-sizing: border-box;
  }

  .form-container {
    width: 100%;
    max-width: 440px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }

  .form-card {
    width: 100%;
    background: #ffffff;
    border: 1px solid #e2e8f0;
    border-radius: 16px;
    padding: 36px 32px;
    box-shadow: 0 4px 20px rgba(7, 59, 120, 0.08);
    display: flex;
    flex-direction: column;
    position: relative;
  }
  .form-card::before {
    content: '';
    position: absolute;
    top: 0; left: 24px; right: 24px; height: 3px;
    background: linear-gradient(90deg, #32F000 0%, #0db872 30%, #0284c7 68%, #073B78 100%);
    border-radius: 3px 3px 0 0;
  }

  .brand-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 24px;
  }

  .admin-logo-box {
    height: 46px;
    max-width: 110px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .admin-logo-img {
    height: 100%;
    width: auto;
    max-width: 100%;
    object-fit: contain;
    display: block;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #071527;
    letter-spacing: -0.02em;
  }

  .sub {
    margin: 2px 0 0;
    font-size: 12.5px;
    color: #64748b;
    font-weight: 500;
  }

  .welcome-text {
    margin-bottom: 24px;
  }

  .welcome-text h2 {
    font-size: 24px;
    font-weight: 800;
    color: #071527;
    margin: 0 0 6px;
    letter-spacing: -0.02em;
  }

  .welcome-text p {
    margin: 0;
    font-size: 13.5px;
    color: #64748b;
    line-height: 1.5;
  }

  .field {
    margin-bottom: 18px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  label {
    font-size: 12px;
    font-weight: 700;
    color: #334155;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .input-wrap {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    border: 1px solid #cbd5e1;
    border-radius: 10px;
    background: #ffffff;
    transition: all 0.15s;
  }

  .input-wrap:focus-within {
    border-color: #0284c7;
    box-shadow: 0 0 0 3px rgba(50, 240, 0, 0.22);
  }

  input {
    flex: 1;
    border: none;
    outline: none;
    padding: 12px 0;
    font-size: 14.5px;
    color: #071527;
    background: transparent;
  }

  .btn-primary {
    width: 100%;
    margin-top: 8px;
    padding: 13px 18px;
    background: linear-gradient(135deg, #32F000 0%, #0db872 30%, #0284c7 68%, #073B78 100%);
    color: #ffffff;
    border: none;
    border-radius: 10px;
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
    transition: all 0.15s ease, transform 0.05s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    box-shadow: 0 4px 16px rgba(7, 59, 120, 0.25);
    text-shadow: 0 1px 2px rgba(7, 59, 120, 0.4);
  }

  .btn-primary:hover:not(:disabled) {
    background: linear-gradient(135deg, #2bd000 0%, #0aa062 30%, #0274b0 68%, #052c5c 100%);
    box-shadow: 0 6px 22px rgba(50, 240, 0, 0.35);
    transform: translateY(-1px);
  }

  .btn-primary:active:not(:disabled) {
    transform: translateY(1px);
  }

  .btn-primary:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .error-notice {
    margin-top: 14px;
    padding: 10px 14px;
    background: #fef2f2;
    border: 1px solid #fecaca;
    border-radius: 8px;
    color: #b91c1c;
    font-size: 13px;
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .switch-app-wrap {
    margin-top: 24px;
    padding-top: 18px;
    border-top: 1px solid #e2e8f0;
    text-align: center;
  }

  .student-switch-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    font-size: 13.5px;
    color: #073B78;
    font-weight: 700;
    text-decoration: none;
    padding: 11px 16px;
    border-radius: 10px;
    background: #ffffff;
    border: 1px solid #cbd5e1;
    width: 100%;
    box-sizing: border-box;
    transition: all 0.15s;
  }

  .student-switch-btn:hover {
    background: #f0fdf4;
    border-color: #32F000;
    color: #15803d;
  }

  @media (max-width: 480px) {
    .login-center-page {
      padding: 16px 12px;
    }
    .form-card {
      padding: 24px 18px;
      border-radius: 14px;
    }
    .welcome-text h2 {
      font-size: 20px;
    }
    h1 {
      font-size: 18px;
    }
    .logo-box {
      width: 40px;
      height: 40px;
    }
    .input-wrap input {
      font-size: 14px;
      padding-top: 11px;
      padding-bottom: 11px;
    }
  }
</style>
