-- Oasis ClockIn — Database Schema (PostgreSQL / Supabase)
-- Run this in the Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  student_id text unique not null,
  email text unique not null,
  registered_ip text,
  registered_mac text,
  role text not null default 'student', -- student | admin
  status text not null default 'active', -- active | suspended | deleted
  created_at timestamptz not null default now()
);

create table if not exists devices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  mac_address text,
  webauthn_credential_id text unique,
  public_key text,
  counter bigint not null default 0,
  transports text[],
  fallback_token_hash text, -- used only if WebAuthn unavailable
  registered_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  geofence_radius_m integer not null default 50,
  active_start time,
  active_end time,
  created_by uuid references students(id),
  created_at timestamptz not null default now()
);

create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  location_id uuid references locations(id),
  type text not null check (type in ('clock_in','clock_out')),
  -- stored as timestamp (no timezone) so ::date cast is immutable and indexable
  recorded_at timestamp not null default (now() at time zone 'UTC'),
  latitude double precision,
  longitude double precision,
  device_id uuid references devices(id),
  session_id uuid,
  risk_score integer,
  verification_status text, -- VERIFIED | REVIEW | REJECTED | AUTO_ABSENT
  punctuality text default 'ON_TIME', -- EARLY | ON_TIME | LATE | AUTO_ABSENT
  device_mac text,
  ip_address text,
  gps_accuracy double precision,
  is_late boolean default false,
  marked_absent_at timestamptz, -- when auto-marked absent by scheduler
  absence_reason text -- e.g., 'No clock-in by 09:30 AM'
);

create unique index if not exists attendance_once_per_day
  on attendance (student_id, location_id, type, (recorded_at::date));

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  event_type text not null, -- device_mismatch | geofence_fail | expired_token | admin_action | etc.
  detail jsonb,
  created_at timestamptz not null default now()
);

create table if not exists admin_accounts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  admin_id text unique not null,
  email text unique not null,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);

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

create table if not exists approved_networks (
  id uuid primary key default gen_random_uuid(),
  cidr text unique not null,
  label text,
  created_by uuid references students(id),
  created_at timestamptz not null default now()
);

create table if not exists attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  location_id uuid references locations(id),
  created_by uuid,
  status text not null default 'ACTIVE', -- ACTIVE | CLOSED | EXPIRED
  started_at timestamptz not null default now(),
  ends_at timestamptz,
  closed_at timestamptz,
  on_time_until time default '09:00',
  created_at timestamptz not null default now()
);

create table if not exists webauthn_challenges (
  key text primary key,
  challenge text not null,
  created_at timestamptz not null default now()
);

create table if not exists holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  description text
);

-- Row Level Security
alter table students enable row level security;
alter table devices enable row level security;
alter table locations enable row level security;
alter table attendance enable row level security;
alter table audit_log enable row level security;
alter table admin_accounts enable row level security;
alter table organization_config enable row level security;
alter table approved_networks enable row level security;
alter table attendance_sessions enable row level security;
alter table webauthn_challenges enable row level security;
alter table holidays enable row level security;

-- The Express backend talks to Postgres using the service_role key (server-side only),
-- which bypasses RLS entirely. These policies protect the DB if anon/publishable keys
-- are ever used to query directly (e.g. Supabase Realtime subscriptions from the admin
-- dashboard). Students should never receive the service_role key.

drop policy if exists "students read own row" on students;
create policy "students read own row"
  on students for select
  using (auth.uid() = id);

drop policy if exists "students read own attendance" on attendance;
create policy "students read own attendance"
  on attendance for select
  using (auth.uid() = student_id);

drop policy if exists "admins read everything - locations" on locations;
create policy "admins read everything - locations"
  on locations for select
  using (true); -- location list is public-ish (needed to render maps); tighten if desired

drop policy if exists "no direct client writes to attendance" on attendance;
create policy "no direct client writes to attendance"
  on attendance for insert
  with check (false); -- all writes go through the backend's validated /api/attendance endpoints
