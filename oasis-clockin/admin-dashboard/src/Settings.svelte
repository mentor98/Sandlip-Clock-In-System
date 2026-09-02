<script>
  import { api } from './lib/api.js';
  import Icon from './lib/Icon.svelte';

  let currentPassword = '';
  let newPassword = '';
  let confirmPassword = '';
  let error = '';
  let success = '';
  let loading = false;

  async function changePassword() {
    error = ''; success = '';
    if (!currentPassword || !newPassword || !confirmPassword) {
      error = 'Fill in all fields.'; return;
    }
    if (newPassword !== confirmPassword) {
      error = 'New passwords do not match.'; return;
    }
    if (newPassword.length < 8) {
      error = 'New password must be at least 8 characters.'; return;
    }
    loading = true;
    try {
      await api('/admin-auth/change-password', {
        method: 'POST',
        body: { current_password: currentPassword, new_password: newPassword },
      });
      success = 'Password updated successfully.';
      currentPassword = newPassword = confirmPassword = '';
    } catch (e) { error = e.message; }
    finally { loading = false; }
  }
</script>

<div class="section">
  <div class="card">
    <div class="card-title-row">
      <div class="icon-wrap">
        <Icon name="lock" size={18} color="#0f766e" />
      </div>
      <div>
        <h3>Security & Credentials</h3>
        <p class="hint">Update your administrator account password.</p>
      </div>
    </div>

    <div class="fields">
      <div class="field">
        <label for="cur">Current Password</label>
        <input id="cur" type="password" bind:value={currentPassword} placeholder="Enter current password" />
      </div>
      <div class="field">
        <label for="new">New Password</label>
        <input id="new" type="password" bind:value={newPassword} placeholder="Minimum 8 characters" />
      </div>
      <div class="field">
        <label for="conf">Confirm New Password</label>
        <input id="conf" type="password" bind:value={confirmPassword} placeholder="Repeat new password" />
      </div>
    </div>

    <button class="btn btn-primary" on:click={changePassword} disabled={loading}>
      <Icon name="check" size={14} />
      <span>{loading ? 'Updating…' : 'Update Password'}</span>
    </button>

    {#if success}<p class="notice success">{success}</p>{/if}
    {#if error}<p class="notice error">{error}</p>{/if}
  </div>
</div>

<style>
  .section { max-width: 520px; }
  .card {
    background: white; border-radius: 14px; padding: 24px;
    border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.03);
    display: flex; flex-direction: column; gap: 16px;
  }
  .card-title-row { display: flex; align-items: center; gap: 12px; }
  .icon-wrap {
    width: 36px; height: 36px; border-radius: 10px; background: #f0fdfa;
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  h3 { margin: 0; font-size: 16px; font-weight: 700; color: #0f172a; }
  .hint { color: #64748b; font-size: 13px; margin: 2px 0 0; }

  .fields { display: flex; flex-direction: column; gap: 14px; }
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field label { font-size: 12px; font-weight: 600; color: #475569; text-transform: uppercase; letter-spacing: 0.03em; }
  input {
    width: 100%; padding: 10px 14px; border-radius: 8px;
    border: 1px solid #cbd5e1; font-size: 14px; color: #0f172a;
    box-sizing: border-box; outline: none; transition: all 0.15s;
  }
  input:focus { border-color: #0f766e; box-shadow: 0 0 0 3px rgba(15,118,110,0.12); }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 7px;
    padding: 10px 18px; border-radius: 8px; border: none;
    cursor: pointer; font-size: 13.5px; font-weight: 600; transition: all 0.15s;
    align-self: flex-start;
  }
  .btn-primary { background: #0f766e; color: white; }
  .btn-primary:hover:not(:disabled) { background: #0b5c54; }
  .btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }

  .notice { padding: 10px 14px; border-radius: 8px; font-size: 13px; font-weight: 500; margin: 0; }
  .notice.success { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .notice.error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

  @media (max-width: 640px) {
    .card { padding: 18px 16px; }
    .btn-primary { width: 100%; }
  }
</style>
