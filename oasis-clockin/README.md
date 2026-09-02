# Oasis ClockIn

A three-factor attendance system (device identity via WebAuthn + GPS geofence + rotating QR token) for Sandlip Oasis student interns.

## ⚠️ Before you do anything else

Your original spec document had a live Supabase `service_role` key pasted into it. That key bypasses every security rule in the database. **Rotate both your Supabase API keys now** (Project Settings → API → regenerate), then use the new ones below. Never paste the `service_role` key into a prompt, a frontend file, or a mobile app — it's server-only.

## Project layout

```
oasis-clockin/
  backend/           Express API — WebAuthn, geofence, QR tokens, admin routes
  student-pwa/       Installable PWA students use to register + clock in/out
  admin-dashboard/   Svelte admin app — locations, live QR, students, audit log
```

## 1. Database

1. Create/open your Supabase project.
2. SQL Editor → paste and run `backend/db/schema.sql`.

## 2. Backend

```bash
cd backend
npm install
cp .env.example .env
# edit .env: paste your ROTATED Supabase URL + service_role key,
# generate random strings for JWT_SECRET and QR_TOKEN_SECRET
npm run dev
```

Runs on `http://localhost:4000`.

## 3. Student PWA

Any static file server works, e.g.:

```bash
cd student-pwa
npx serve .
```

WebAuthn requires HTTPS (or `localhost`). Open in Chrome/Safari on the phone you want to register — this bind is permanent per spec §2 until an admin resets it.

If you deploy the backend elsewhere, set `window.OASIS_API_BASE` at the top of `app.js` (or inject it via a small `<script>` before `app.js` loads) to the deployed API URL.

## 4. Admin dashboard

```bash
cd admin-dashboard
npm install
npm run dev
```

Runs on `http://localhost:5174`. Set `VITE_API_BASE` in a `.env` file if the backend isn't on `localhost:4000`.

**Note on live QR streaming:** the Locations tab uses Server-Sent Events, and `EventSource` can't send an `Authorization` header. The shipped code passes the token as a query param as a placeholder — for a real deployment, either (a) have the backend accept a short-lived signed URL for this one endpoint, or (b) replace SSE with a `fetch` + `ReadableStream` reader that can set headers. This is called out in `Locations.svelte`.

## 5. Creating your first admin

There's no separate "make me an admin" endpoint on purpose (avoids a privilege-escalation hole). Insert one manually after your first WebAuthn registration:

```sql
update students set role = 'admin' where student_id = 'YOUR-ADMIN-STUDENT-ID';
```

## How the three anti-fraud checks map to the code

| Signal | Where |
|---|---|
| Device identity | `backend/src/routes/webauthn.js` — WebAuthn registration + login |
| Location proof | `backend/src/utils/geofence.js` (Haversine) enforced in `routes/attendance.js` |
| Rotating QR token | `backend/src/utils/qrToken.js` (HMAC, 20–30s TTL) enforced in `routes/attendance.js` |

All three are checked server-side on every `/api/attendance/clock-in` and `/clock-out` call — a client can't skip any of them.

## Next: mobile app

See the prompt below to generate an Android app (via Android Studio / Gemini in Android Studio, sometimes called "Google AI Studio" for app building) that talks to this same backend.
