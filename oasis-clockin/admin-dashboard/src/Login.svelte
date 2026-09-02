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

<main class="login-split-page">
  <!-- Left Side: Plain image without container -->
  <section class="left-image-panel">
    <img
      src="https://res.cloudinary.com/jinrrp4r/image/upload/v1788353121/ChatGPT_Image_Sep_2_2026_01_44_48_PM_nykarx.png"
      alt="Oasis ClockIn Attendance Platform"
      class="hero-full-img"
    />
  </section>

  <!-- Right Side: Inputs & Sign In Form -->
  <section class="right-form-panel">
    <div class="form-card">
      <div class="brand-header">
        <div class="logo-box">
          <Icon name="clock" size={24} color="#ffffff" strokeWidth={2.2} />
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

      <div class="credentials-hint">
        <span>Default credentials:</span>
        <code>ADMIN-001</code> / <code>admin12345</code>
      </div>

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
  .login-split-page {
    min-height: 100vh;
    display: flex;
    background: #f8fafc;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    margin: 0;
    padding: 0;
  }

  .left-image-panel {
    flex: 1.1;
    min-height: 100vh;
    background: #020b10;
    overflow: hidden;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .hero-full-img {
    width: 100%;
    height: 100%;
    min-height: 100vh;
    object-fit: cover;
    object-position: center;
    display: block;
  }

  .right-form-panel {
    flex: 1;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 48px;
    background: #ffffff;
    box-sizing: border-box;
  }

  .form-card {
    width: 100%;
    max-width: 420px;
    display: flex;
    flex-direction: column;
  }

  .brand-header {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 24px;
  }

  .logo-box {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    background: linear-gradient(135deg, #0f766e 0%, #115e59 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 14px rgba(15, 118, 110, 0.3);
    flex-shrink: 0;
  }

  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
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
    font-weight: 700;
    color: #0f172a;
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
    font-weight: 600;
    color: #475569;
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
    border-color: #0f766e;
    box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
  }

  input {
    flex: 1;
    border: none;
    outline: none;
    padding: 12px 0;
    font-size: 14.5px;
    color: #0f172a;
    background: transparent;
  }

  .btn-primary {
    width: 100%;
    margin-top: 8px;
    padding: 13px 18px;
    background: #0f766e;
    color: white;
    border: none;
    border-radius: 10px;
    font-weight: 600;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.15s, transform 0.05s;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .btn-primary:hover:not(:disabled) {
    background: #0d635c;
  }

  .btn-primary:active:not(:disabled) {
    transform: translateY(1px);
  }

  .btn-primary:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .credentials-hint {
    margin-top: 16px;
    font-size: 12px;
    color: #64748b;
    text-align: center;
    background: #f8fafc;
    padding: 10px 14px;
    border-radius: 8px;
    border: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .credentials-hint code {
    background: #f1f5f9;
    padding: 2px 8px;
    border-radius: 4px;
    color: #0f172a;
    font-weight: 700;
    border: 1px solid #e2e8f0;
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
    color: #0f766e;
    font-weight: 600;
    text-decoration: none;
    padding: 11px 16px;
    border-radius: 10px;
    background: #f0fdfa;
    border: 1px solid #ccfbf1;
    width: 100%;
    box-sizing: border-box;
    transition: all 0.15s;
  }

  .student-switch-btn:hover {
    background: #ccfbf1;
    color: #115e59;
  }

  @media (max-width: 900px) {
    .login-split-page {
      flex-direction: column;
    }
    .left-image-panel {
      min-height: 240px;
      max-height: 320px;
      flex: none;
    }
    .hero-full-img {
      min-height: 240px;
      max-height: 320px;
    }
    .right-form-panel {
      padding: 32px 24px;
    }
  }
</style>
