# Oasis ClockIn — Android App Build Prompt

Paste everything in the box below as a single prompt into Android Studio's Gemini (or Google AI Studio's Android/Gemini app-building flow). Before pasting, replace the two placeholders marked `<<...>>` with your own values — never paste your Supabase `service_role` key anywhere in this prompt; the app only ever needs the public API base URL.

---

```
Build a complete, fully functioning native Android app in Kotlin using Jetpack Compose called
"Oasis ClockIn" — a student attendance app that clocks students in/out by combining three checks:
device identity, GPS location, and a rotating QR code. It talks to an existing Node.js/Express
REST API (already built, do not change its contract) at this base URL:

API_BASE = "<<https://your-deployed-backend-url.com/api>>"

Do NOT hardcode or ask me for any Supabase service_role key, database password, or admin secret —
this app only ever calls the REST API above over HTTPS with a Bearer session token it receives
from that API. It never talks to Supabase directly.

## Screens (match this exact visual style)

A clean, modern split/card design in a teal (#0F9B8E primary, #0B5C54 dark accent, #EAFAF7 light
accent) and white palette, with soft rounded corners (16–22dp) and a decorative cluster of
overlapping teal circular blobs in a bottom corner of the welcome/sign-in screen, similar to a
premium SaaS sign-in page. Use this navigation:

1. **Welcome / Sign in** — App name "Oasis ClockIn" top-left, big "Welcome" headline, a short
   tagline, a Student ID text field, a primary "Sign in with device" button, and a text link
   "New here? Register an account."
2. **Register** — Full name, Student/Staff ID, Email fields, a primary "Create account & bind
   device" button, and a "Back to sign in" link.
3. **Home** — Greeting with the student's name, a big pill showing "Clocked in" (teal) or
   "Not clocked in" (grey), a live clock, a large primary "Clock in" / "Clock out" button (label
   toggles based on state), a "Scan QR" button/icon in the top bar, and a scrollable "Recent
   activity" list of past clock-in/out events with location name and timestamp.
4. **QR Scanner** — Full-screen camera preview with a scanning frame overlay and the hint text
   "Point your camera at the location's QR code."

## Core anti-fraud flow (all three must pass before a clock-in/out is accepted — enforced by the
backend, but the app must correctly collect and send all three signals)

1. **Device identity — passkey/WebAuthn via Android's Credential Manager API**
   (`androidx.credentials`, `CredentialManager`, `CreatePublicKeyCredentialRequest` and
   `GetPublicKeyCredentialOption`). This app is the "authenticator app" side of the same
   WebAuthn Relying Party used by the existing web PWA, so the JSON options/response formats
   must exactly match the `@simplewebauthn/server` library's expected shapes:
   - `POST {API_BASE}/auth/register` → `{ full_name, student_id, email }` returns
     `{ student, registrationToken }`. Store `registrationToken` and send it as
     `Authorization: Bearer <token>` on the next two calls.
   - `POST {API_BASE}/auth/webauthn/register-challenge` (auth header from above) returns
     standard WebAuthn `PublicKeyCredentialCreationOptions` JSON (challenge, rp, user,
     pubKeyCredParams, authenticatorSelection, etc., all base64url-encoded per the WebAuthn
     JSON serialization spec).
   - Pass those options into `CreatePublicKeyCredentialRequest(requestJson = ...)` via
     Credential Manager, prompting biometric/device unlock.
   - `POST {API_BASE}/auth/webauthn/register-verify` (same auth header) with the credential
     response JSON returned by Credential Manager, unmodified. Returns
     `{ verified: true, sessionToken }`.
   - For sign-in: `POST {API_BASE}/auth/webauthn/login-challenge` with `{ student_id }` returns
     `PublicKeyCredentialRequestOptions` plus an `internalStudentId` field — keep that field
     alongside the options, don't send it to Credential Manager.
   - Use `GetPublicKeyCredentialOption(requestJson = ...)` via Credential Manager to get an
     assertion.
   - `POST {API_BASE}/auth/webauthn/login-verify` with
     `{ internalStudentId, assertion: <credential response JSON> }` returns
     `{ verified: true, sessionToken, deviceId }`.
   - Store `sessionToken` and `deviceId` securely (EncryptedSharedPreferences /
     Jetpack Security `androidx.security.crypto`), and send
     `Authorization: Bearer <sessionToken>` on every authenticated call after this.
   - If any WebAuthn step fails, show the generic message "Please, you're not a student here."
     — never a more specific error, to avoid leaking account existence.

2. **Location proof — FusedLocationProviderClient (Google Play Services location)**
   - Request `ACCESS_FINE_LOCATION` at runtime with a clear rationale dialog first.
   - On clock-in/out, get one fresh high-accuracy location fix (not a cached/stale one) and
     send `latitude`/`longitude` as numbers.
   - Handle "permission denied" and "location unavailable" gracefully with a retry button —
     never let the app silently send a stale/fake coordinate.

3. **Rotating QR token — CameraX + ML Kit Barcode Scanning**
   - Use `androidx.camera.camera2` (CameraX) for the preview and
     `com.google.mlkit:barcode-scanning` to decode QR codes in real time from the camera feed.
   - The QR encodes a URL like
     `<<https://your-deployed-frontend-url>>/scan?location_id=<uuid>&token=<hmac-token>`.
     Parse out `location_id` and `token` query params from the scanned string — do not attempt
     to decode or validate the token yourself, just forward it to the backend as-is. Tokens
     expire in ~20–30 seconds, so scan-to-submit should happen immediately; if the backend
     rejects it as expired, prompt the user to rescan rather than retry the same token.
   - Also support a "direct sign-in" path with no QR (send `location_id` without
     `location_token`) for the case where an admin has shared a fixed kiosk location.

## Clock-in / clock-out API calls (send all three signals together)

```
POST {API_BASE}/attendance/clock-in
POST {API_BASE}/attendance/clock-out
Headers: Authorization: Bearer <sessionToken>
Body: {
  "location_id": "<uuid from QR or selected kiosk>",
  "location_token": "<hmac token from QR, omit field entirely if direct sign-in>",
  "latitude": <double>,
  "longitude": <double>,
  "device_id": "<deviceId stored at login>"
}
```
Success → 201 with `{ success: true, attendance: {...} }`. Any failure → generic
`{ error: "Please, you're not a student here." }` or a 409 "already clocked in/out today" —
surface that 409 message to the user as-is since it's not sensitive, but show the generic
message for every 401/403.

## Attendance history

`GET {API_BASE}/attendance/me` with the Bearer token returns
`{ attendance: [ { id, type, recorded_at, latitude, longitude, locations: { name } }, ... ] }`
ordered newest-first — populate the Home screen's "Recent activity" list and use the most
recent same-day `clock_in`/`clock_out` pair to decide whether the big button should say
"Clock in" or "Clock out".

## Offline resilience

If a clock-in/out network call fails purely due to no connectivity (not a validation
rejection), queue it locally in a Room database table and retry automatically via WorkManager
once connectivity returns (`ConnectivityManager` network callback or `WorkManager`
constraints). Show a "Saved offline — will sync automatically" message instead of an error in
that specific case.

## Tech requirements

- Kotlin, Jetpack Compose, Material 3 theming using the teal palette above (create a proper
  Compose `ColorScheme`, don't hardcode colors inline everywhere).
- Retrofit + OkHttp for networking, with a single `Authorization` interceptor that reads the
  stored session token.
- `androidx.security.crypto.EncryptedSharedPreferences` for storing the session token,
  device ID, and student ID.
- `androidx.credentials` (Credential Manager) for all WebAuthn/passkey operations — do not use
  a manually-written FIDO2 client.
- CameraX + ML Kit Barcode Scanning for the QR screen.
- FusedLocationProviderClient for geolocation.
- Room + WorkManager for the offline attendance queue.
- Target minSdk 26+ (passkeys/Credential Manager require API 28+ for full support; gracefully
  message unsupported devices rather than crashing).
- Include the AndroidManifest permissions: `INTERNET`, `ACCESS_FINE_LOCATION`, `CAMERA`, and
  Credential Manager's required manifest entries.
- Include a clear `Config.kt` (or `BuildConfig` field) holding only `API_BASE` — no secrets.

Build this as a complete, runnable Android Studio project with all Gradle files, manifest,
and source files needed to compile and run on a physical device.
```

---

### A few notes for you before you run this

- **`<<https://your-deployed-backend-url.com/api>>`** — replace with wherever you deploy the `backend/` folder from the main project (e.g. Render, Railway, Fly.io, a VPS). It must be HTTPS in production; WebAuthn/passkeys will not work over plain HTTP except on `localhost`.
- The app needs the *same* `RP_ID` (Relying Party domain) your backend and web PWA use, since passkeys are domain-bound. Make sure `RP_ID` in the backend's `.env` matches the domain you deploy the PWA/QR deep links to.
- If Android Studio's Gemini asks follow-up questions (e.g. Gradle version, min SDK), answer with whatever the current stable Android Studio defaults suggest — nothing above depends on a specific version.
- Nothing in this prompt includes your Supabase keys, by design. The mobile app never needs them.
