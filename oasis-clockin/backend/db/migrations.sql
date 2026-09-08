-- ═══════════════════════════════════════════════════════════════════════════
-- Oasis ClockIn — Full Migration Script
-- Run this in the Supabase SQL editor AFTER the original schema.sql
-- Safe to run multiple times (uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. devices — add status, authorized_by, authorized_at ─────────────────
alter table devices
  add column if not exists status text not null default 'PENDING',
  add column if not exists authorized_by uuid references students(id),
  add column if not exists authorized_at timestamptz,
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists mac_address text,
  add column if not exists last_seen_at timestamptz;

-- ── 1b. students — add network & device identity fields ───────────────────
alter table students
  add column if not exists registered_ip text,
  add column if not exists registered_mac text;

-- Backfill existing rows: treat any active (non-revoked) device as AUTHORIZED
update devices set status = 'AUTHORIZED'
  where revoked_at is null and status = 'PENDING';

update devices set status = 'REVOKED'
  where revoked_at is not null and status = 'PENDING';

-- ── 2. locations — add QR nonce columns ───────────────────────────────────
alter table locations
  add column if not exists active_qr_nonce text,
  add column if not exists qr_generated_at timestamptz;

-- ── 3. attendance — add new validation columns ────────────────────────────
alter table attendance
  add column if not exists session_id uuid,
  add column if not exists risk_score integer,
  add column if not exists verification_status text,
  add column if not exists punctuality text default 'ON_TIME',
  add column if not exists device_mac text,
  add column if not exists ip_address text,
  add column if not exists gps_accuracy double precision,
  add column if not exists is_late boolean default false,
  add column if not exists marked_absent_at timestamptz,
  add column if not exists absence_reason text;

-- ── 4. webauthn_challenges — persist WebAuthn challenges across restarts ──
create table if not exists webauthn_challenges (
  key text primary key,
  challenge text not null,
  created_at timestamptz not null default now()
);
alter table webauthn_challenges enable row level security;
drop policy if exists "no direct client access to challenges" on webauthn_challenges;
create policy "no direct client access to challenges"
  on webauthn_challenges for all using (false);

-- ── 5. admin_accounts — admin email+password auth ─────────────────────────
create table if not exists admin_accounts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  admin_id text unique not null,
  email text unique not null,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);
alter table admin_accounts enable row level security;
drop policy if exists "no direct client access to admin_accounts" on admin_accounts;
create policy "no direct client access to admin_accounts"
  on admin_accounts for all using (false);

-- ── 6. organization_config — single-row org settings ─────────────────────
create table if not exists organization_config (
  id text primary key default 'default',
  name text not null,
  address text,
  latitude double precision,
  longitude double precision,
  attendance_radius_m integer not null default 150,
  require_gps boolean not null default true,
  require_device_auth boolean not null default true,
  require_ip_match boolean not null default false,
  require_wifi_match boolean not null default true,
  require_qr boolean not null default false,
  ip_check_mode text not null default 'warn', -- off | warn | strict
  work_start_time text default '08:00',
  grace_period_minutes integer default 15,
  early_threshold_minutes integer default 15,
  wifi_mac text default 'be:64:b4:14:4d:67',
  wifi_ip text default '192.168.1.156',
  wifi_ssid text default 'Sandlip-Oasis-WiFi',
  status text not null default 'active',
  updated_at timestamptz not null default now()
);

-- Ensure all schedule and WiFi columns exist if table was previously created
alter table organization_config
  add column if not exists work_start_time text default '08:00',
  add column if not exists grace_period_minutes integer default 15,
  add column if not exists early_threshold_minutes integer default 15,
  add column if not exists require_wifi_match boolean default true,
  add column if not exists wifi_mac text default 'be:64:b4:14:4d:67',
  add column if not exists wifi_ip text default '192.168.1.156',
  add column if not exists wifi_ssid text default 'Sandlip-Oasis-WiFi';

alter table organization_config enable row level security;
drop policy if exists "no direct client access to org_config" on organization_config;
create policy "no direct client access to org_config"
  on organization_config for all using (false);

-- ── 7. approved_networks — IP/CIDR whitelist ─────────────────────────────
create table if not exists approved_networks (
  id uuid primary key default gen_random_uuid(),
  cidr text unique not null,
  label text,
  created_by uuid references students(id),
  created_at timestamptz not null default now()
);
alter table approved_networks enable row level security;
drop policy if exists "no direct client access to approved_networks" on approved_networks;
create policy "no direct client access to approved_networks"
  on approved_networks for all using (false);

-- ── 8. attendance_sessions ────────────────────────────────────────────────
create table if not exists attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  location_id uuid references locations(id),
  created_by uuid,
  status text not null default 'ACTIVE', -- ACTIVE | CLOSED | EXPIRED
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  closed_at timestamptz,
  on_time_until time default '09:00', -- Mark late if clock-in after this time
  created_at timestamptz not null default now()
);

-- Add on_time_until if table already exists without it
alter table attendance_sessions
  add column if not exists on_time_until time default '09:00';
alter table attendance_sessions enable row level security;
drop policy if exists "no direct client access to sessions" on attendance_sessions;
create policy "no direct client access to sessions"
  on attendance_sessions for all using (false);

-- ── 9. Realtime publications ──────────────────────────────────────────────
-- Enables Supabase Realtime for admin dashboard live updates (safely checks if already in publication)
do $$
begin
  alter publication supabase_realtime add table devices;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table students;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table attendance;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table audit_log;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table attendance_sessions;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table organization_config;
exception when others then null;
end $$;

-- ── 10. Reload PostgREST schema cache ─────────────────────────────────────
-- Notifies PostgREST to immediately refresh its schema cache for new columns
notify pgrst, 'reload schema';

-- ── 11. Useful indexes ────────────────────────────────────────────────────
create index if not exists idx_devices_student_id on devices(student_id);
create index if not exists idx_devices_status on devices(status);
create index if not exists idx_attendance_student_date on attendance(student_id, recorded_at);
create index if not exists idx_attendance_session on attendance(session_id);
create index if not exists idx_audit_log_student on audit_log(student_id);
create index if not exists idx_sessions_status on attendance_sessions(status);
