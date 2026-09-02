# Oasis ClockIn System — Technical Specification

**Project:** Student IT Intern attendance system for Sandlip Oasis
**Version:** 1.0 (Competition Build)
**Last updated:** 2026-08-31

---

## 1. Overview

Oasis ClockIn is a web-based attendance system for IT interns/students at Sandlip Oasis. Students sign in and sign out once per day either by scanning a location-bound, time-rotating QR code or by visiting the site directly on a registered device. The system is designed so that attendance can only be recorded by the specific person it belongs to, from the specific device they registered, while physically present at the registered location — without relying on browser-inaccessible identifiers like MAC addresses.

**Core anti-fraud model (three independent signals, all required):**

1. **Device identity** — a WebAuthn credential bound to the student's specific phone/laptop at registration.
2. **Location proof** — GPS geofence check (student must be within a configurable radius of the location).
3. **Time-boxed QR token** — the QR code rotates every 20–30 seconds, so a photographed/shared code expires before it can be reused.

A clock-in only succeeds if all three checks pass. Any failure returns a generic rejection: *"Please, you're not a student here."*

---

## 2. Why not MAC address / IP address (design correction)

The original concept proposed binding attendance to a device's MAC address and validating the student's IP address. Both are not viable in a browser context:

- **MAC address:** Not accessible to JavaScript or any web API. Modern OSes (iOS, Android, Windows, macOS) also randomize MAC addresses per network by default for privacy, so even native code can't reliably read a stable one.
- **IP address:** Changes constantly on mobile data (carrier NAT) and can be shared across many devices on the same wifi/campus network. Using it as a pass/fail gate produces false rejections and is trivially bypassed with a VPN.

**Replacement:** device-bound WebAuthn credentials (real device identity that can't be copied) + GPS geofencing (real location proof) + rotating QR tokens (defeats screenshot sharing). This is what the rest of this spec implements.

---

## 3. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Student app (frontend) | HTML, CSS, JavaScript (installable PWA) | Mobile-first, works via URL or QR deep link |
| Admin dashboard (frontend) | Svelte | Separate app, same backend API |
| Backend | Node.js + Express | REST API, JWT auth, WebAuthn server library (`@simplewebauthn/server`) |
| Database | PostgreSQL via Supabase | Row Level Security enabled |
| QR generation | `bwip-js` | Server-side, regenerated on a rolling interval |
| Maps (admin location picker, optional student view) | OpenFreeMap + MapLibre GL JS | Free, no API key, no usage limits |
| Reverse geocoding (address lookup only) | LocationIQ | Used only to turn a dropped pin into a readable address for admin UI — never used for the pass/fail distance check |
| Device binding | WebAuthn (platform authenticator) | Falls back to a signed device-token in IndexedDB if biometric hardware unavailable |
| Realtime | Supabase Realtime | Live admin dashboard |
| Notifications | Email (and optionally SMS) | Suspicious device/location mismatch alerts |

---

## 4. User Roles

### 4.1 Admin
- Create/edit/delete **locations** (name, lat/long, geofence radius, active hours).
- Generate and display the rotating **QR code** for a location.
- View/search students, suspend or delete accounts.
- Force a **device re-registration** for a student (replaces "change IP/MAC" from the original plan — used when a student gets a new phone or loses access).
- View live attendance feed, audit log, and export reports (CSV).
- Manage holidays/non-attendance days for calendar sync.

### 4.2 Student
- Register once: create account, verify identity, bind current device via WebAuthn.
- Each day: clock in and clock out once each, via QR scan or direct site visit.
- View personal attendance history and calendar.

---

## 5. Core Flows

### 5.1 Registration
1. Student creates an account (name, matric/staff ID, email).
2. Server issues a WebAuthn registration challenge.
3. Browser prompts for platform authenticator (fingerprint/Face ID/Windows Hello/PIN).
4. Public key credential is stored server-side, tied to `student_id`.
5. If no authenticator is available, fall back to a random signed device token stored in IndexedDB (weaker, but functional — flag this account tier differently in admin UI).
6. Student's record is now "device-bound." Any future auth attempt from an unbound device is rejected.

### 5.2 Clock-in / Clock-out (QR path)
1. Admin's display shows a QR code that re-renders every 20–30 seconds. Each QR encodes: `location_id` + a short-lived signed token (HMAC, server secret, expiry).
2. Student scans QR with their phone camera → opens a deep link into the student PWA.
3. PWA prompts WebAuthn authentication (proves *this device, this person*).
4. PWA requests geolocation permission and captures current lat/long.
5. PWA sends `{ location_token, webauthn_assertion, lat, long, timestamp }` to the API.
6. Server validates, in order:
   - Token not expired and matches the claimed location.
   - WebAuthn assertion verifies against the student's stored credential.
   - Haversine distance between submitted coordinates and location's registered coordinates ≤ geofence radius.
   - Student hasn't already clocked in (or out) today for this session type.
7. On success: insert `attendance` row, return confirmation. On any failure: generic rejection message + entry in `audit_log`.

### 5.3 Clock-in (direct URL path)
Same as above minus the QR token step — used when a student visits the site directly. Location and device checks still apply.

---

## 6. Database Schema (PostgreSQL / Supabase)

```sql
create table students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  student_id text unique not null,
  email text unique not null,
  status text not null default 'active', -- active | suspended | deleted
  created_at timestamptz not null default now()
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id) on delete cascade,
  webauthn_credential_id text unique,
  public_key text,
  fallback_token_hash text, -- used only if WebAuthn unavailable
  registered_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table locations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  latitude double precision not null,
  longitude double precision not null,
  geofence_radius_m integer not null default 50,
  active_start time,
  active_end time,
  created_by uuid references students(id), -- admin account
  created_at timestamptz not null default now()
);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  location_id uuid references locations(id),
  type text not null, -- clock_in | clock_out
  recorded_at timestamptz not null default now(),
  latitude double precision,
  longitude double precision,
  device_id uuid references devices(id),
  unique (student_id, location_id, type, (recorded_at::date))
);

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references students(id),
  event_type text not null, -- device_mismatch | geofence_fail | expired_token | admin_action | etc.
  detail jsonb,
  created_at timestamptz not null default now()
);

create table holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  description text
);
```

Row Level Security: students can only `select`/`insert` rows in `attendance` where `student_id = auth.uid()`; all `admin`-role policies are separate and scoped to a service role.

---

## 7. API Endpoints (Express)

| Method | Route | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create student account |
| POST | `/api/auth/webauthn/register-challenge` | Start device binding |
| POST | `/api/auth/webauthn/register-verify` | Complete device binding |
| POST | `/api/auth/webauthn/login-challenge` | Start clock-in auth |
| POST | `/api/auth/webauthn/login-verify` | Complete clock-in auth |
| POST | `/api/attendance/clock-in` | Record clock-in (validates token + geofence + device) |
| POST | `/api/attendance/clock-out` | Record clock-out |
| GET | `/api/attendance/me` | Student's own history |
| POST | `/api/admin/locations` | Create/edit location |
| GET | `/api/admin/locations/:id/qr` | Live rotating QR stream (SSE or short-poll) |
| GET | `/api/admin/students` | List/search students |
| PATCH | `/api/admin/students/:id/suspend` | Suspend account |
| DELETE | `/api/admin/students/:id` | Delete account |
| POST | `/api/admin/students/:id/reset-device` | Revoke old device, issue new registration link |
| GET | `/api/admin/attendance/export` | CSV export |
| GET | `/api/admin/audit-log` | View flagged events |

All admin routes require an `admin` role JWT claim; all student routes require a valid session + device assertion.

---

## 8. Security Notes

- HTTPS/HSTS enforced everywhere (WebAuthn requires a secure context anyway).
- QR tokens signed with HMAC-SHA256, short expiry (20–30s), single-use.
- Rate limiting on all auth and clock-in endpoints (e.g. `express-rate-limit`).
- All admin actions logged to `audit_log` with actor + timestamp.
- Geofence radius and active hours are per-location, admin-configurable, so a location can reject attempts outside working hours even if geolocation passes.

---

## 9. Stand-out Features for Competition Demo

- **Live admin dashboard** via Supabase Realtime — attendance rows appear on screen as students scan.
- **Installable PWA** with offline queueing — a clock-in attempted with no signal is stored locally and synced automatically once connectivity returns.
- **Map view** (OpenFreeMap/MapLibre) on the admin location editor — drop a pin, set a radius, see the geofence circle visually.
- **Audit/security screen** — shows blocked attempts (wrong device, outside geofence, expired token) as a visible "we stopped fraud" moment.
- **CSV/report export** and a simple attendance-rate chart per student/location.
- **Calendar sync** — holidays table excludes non-working days from required attendance automatically; optional iCal export of a student's attendance record.

---

## 10. Open Decisions

- Fallback UX for devices without biometric hardware (older Android phones) — token-based fallback is functional but weaker; consider flagging these accounts for tighter geofence/QR expiry.
- SMS provider for alerts, if used (cost consideration for a student competition budget).
- Exact geofence radius per location — recommend starting at 50m and tuning based on GPS accuracy in real testing.


SUPABASE_URL=https://gqwdibokfrzekmiwsska.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_3b9tpvsJPCW2reGzQsXU4Q_QdX1_geO
SUPABASE_SECRET_KEY=sb_secret_e9TLeBzrALnfMOW8xjJrsw_bmIC00gZ
SUPABASE_JWKS_URL=https://gqwdibokfrzekmiwsska.supabase.co/auth/v1/.well-known/jwks.json
anon public=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxd2RpYm9rZnJ6ZWttaXdzc2thIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgyNTc0NTYsImV4cCI6MjEwMzgzMzQ1Nn0.RB6Gb8ibxYJQ7fTZKayF3X7WeBzER0o1rgpIBL_FJfo

service_role secret=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdxd2RpYm9rZnJ6ZWttaXdzc2thIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODI1NzQ1NiwiZXhwIjoyMTAzODMzNDU2fQ.PiOu-trgKhptBmmrI2baCIOBZXN7q9lsjBQUN68g_08
