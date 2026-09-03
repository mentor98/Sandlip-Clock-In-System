const API_BASE = import.meta.env.VITE_API_BASE || '/api';

function token() {
  return localStorage.getItem('oasis_admin_session');
}

export async function api(path, { method = 'GET', body, auth = true, token: customToken } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const t = customToken || (auth ? token() : null);
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

export function getAdminSession() {
  return localStorage.getItem('oasis_admin_session') || '';
}

export function setAdminSession(sessionToken) {
  localStorage.setItem('oasis_admin_session', sessionToken);
}

export function isLoggedIn() {
  return !!token();
}

export function logout() {
  localStorage.removeItem('oasis_admin_session');
}
