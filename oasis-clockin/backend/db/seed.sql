-- ═══════════════════════════════════════════════════════════════════════════
-- Oasis ClockIn — Supabase Seed Data (Pre-Populated Admins, Students & Campus)
-- Run this in your Supabase SQL Editor once after running migrations.sql
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto;

-- ── 1. Admin Accounts ──────────────────────────────────────────────────────
-- Default Admin Password: admin12345
-- Salt: a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90
-- PBKDF2-SHA512 (100k iterations):
-- bcfbcddb69828d09f7a93a1050a49c9523f2f5ba7c645ebff6f082e6c525f212fbddacdbca7845778a3c87fce0e8838d72740bc43a7dafb5b060f69a53163351

insert into admin_accounts (full_name, admin_id, email, password_hash, password_salt)
values (
  'System Administrator',
  'ADMIN-001',
  'admin@oasis.edu',
  'bcfbcddb69828d09f7a93a1050a49c9523f2f5ba7c645ebff6f082e6c525f212fbddacdbca7845778a3c87fce0e8838d72740bc43a7dafb5b060f69a53163351',
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
)
on conflict (admin_id) do update set
  password_hash = excluded.password_hash,
  password_salt = excluded.password_salt;

-- ── 2. Students ────────────────────────────────────────────────────────────
insert into students (id, full_name, student_id, email, role, status)
values
  ('b0000000-0000-0000-0000-000000000001', 'Ada Lovelace', 'SAN-2026-014', 'ada@oasis.edu', 'student', 'active'),
  ('b0000000-0000-0000-0000-000000000002', 'Charles Babbage', 'SAN-2026-015', 'charles@oasis.edu', 'student', 'active'),
  ('b0000000-0000-0000-0000-000000000003', 'Grace Hopper', 'SAN-2026-016', 'grace@oasis.edu', 'student', 'active')
on conflict (student_id) do nothing;

-- ── 3. Locations ───────────────────────────────────────────────────────────
insert into locations (id, name, latitude, longitude, geofence_radius_m, active_start, active_end)
values
  ('c0000000-0000-0000-0000-000000000001', 'Sandlip Oasis - Lecture & Hall Complex', 8.9280843, 11.3307533, 200, '06:00:00', '22:00:00'),
  ('c0000000-0000-0000-0000-000000000002', 'Sandlip Oasis - Innovation & Tech Wing', 8.9280843, 11.3307533, 200, '06:00:00', '22:00:00')
on conflict (id) do nothing;

-- ── 4. Organization Config ─────────────────────────────────────────────────
insert into organization_config (id, name, address, latitude, longitude, attendance_radius_m, require_gps, require_device_auth, require_ip_match, require_qr, ip_check_mode, status)
values (
  'default',
  'Sandlip Oasis',
  'Sandlip Oasis Campus, Innovation Way',
  8.9280843,
  11.3307533,
  200,
  true,
  false,
  false,
  false,
  'warn',
  'active'
)
on conflict (id) do update set
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  attendance_radius_m = excluded.attendance_radius_m;

-- ── 5. Attendance Sessions ─────────────────────────────────────────────────
insert into attendance_sessions (id, title, location_id, status, started_at, ends_at, on_time_until)
values (
  'd0000000-0000-0000-0000-000000000001',
  'General Attendance Session',
  'c0000000-0000-0000-0000-000000000001',
  'ACTIVE',
  now() - interval '2 hours',
  now() + interval '8 hours',
  '09:00:00'
)
on conflict (id) do nothing;
