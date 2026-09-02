# Absence Marking Implementation Guide

## Overview

The Oasis ClockIn system now automatically marks students as absent if they don't clock in within a specified time window (7 AM – 9 AM, with absence marking at 9:30 AM).

---

## Architecture

### 1. **Database Schema Changes**

Added to `attendance` table:
```sql
marked_absent_at timestamptz       -- When the absence was auto-marked
absence_reason text                -- e.g., "No clock-in by 09:30 AM"
verification_status text           -- Now includes 'AUTO_ABSENT' status
```

### 2. **Backend Components**

#### **absenceMarker.js** (`src/services/absenceMarker.js`)
The core service that handles absence marking logic:
- Runs daily at 9:30 AM (UTC)
- Finds all active sessions started today
- For each session, identifies students with no clock-in
- Creates an absence record with `verification_status = 'AUTO_ABSENT'`
- Logs each action to the audit log

**Key function:**
```javascript
async function markAbsent()
```
- Fetches all sessions started today
- For each session, calls `markAbsentForSession()`

```javascript
async function markAbsentForSession(session, todayDateStr, absenceDeadline)
```
- Gets all active students
- Checks if each student has a clock-in for the session
- If not, creates an absence record

#### **absenceScheduler.js** (`src/jobs/absenceScheduler.js`)
Initializes cron jobs using `node-cron`:
- **9:30 AM daily**: Runs `markAbsent()`
- **Every hour**: Cleanup tasks (optional)

---

## How It Works

### Daily Flow

1. **7:00 AM – 9:00 AM**: Regular attendance window
   - Students clock in during this period
   - On-time students: verified
   - Late students (after 9 AM): marked `is_late = true`

2. **9:30 AM**: Scheduled job triggers
   - Backend queries all sessions that started today
   - For each session:
     - Gets all active students
     - Checks if they have a `clock_in` record for today + session
     - If missing: inserts an absence record

3. **Absence Record Created**
   ```javascript
   {
     student_id: UUID,
     session_id: UUID,
     location_id: UUID,
     type: 'absence',
     recorded_at: '2024-09-01',  // Today's date
     verification_status: 'AUTO_ABSENT',
     marked_absent_at: '2024-09-01T09:30:00Z',
     absence_reason: 'No clock-in by 09:30 AM'
   }
   ```

4. **Audit Log Entry**
   ```javascript
   {
     student_id: UUID,
     event_type: 'student_marked_absent',
     detail: {
       session_id: UUID,
       session_title: 'Morning Session',
       reason: 'No clock-in by 09:30 AM',
       marked_by: 'scheduler'
     }
   }
   ```

---

## Configuration

### Timezone
The default cron schedule is UTC. To use a different timezone, edit `absenceScheduler.js`:

```javascript
// Currently (UTC):
const absenceJob = cron.schedule('30 9 * * *', async () => { ... });

// For Eastern Time (EST/EDT):
const absenceJob = cron.schedule('30 9 * * *', async () => { ... }, {
  timezone: 'America/New_York'
});

// Common timezones:
// 'America/Los_Angeles'
// 'Europe/London'
// 'Asia/Tokyo'
// 'Australia/Sydney'
```

### Absence Deadline
Currently hardcoded to 9:30 AM in `absenceMarker.js`:
```javascript
const absenceDeadline = '09:30';
```

To make it dynamic, you can:
1. Add `absence_deadline` column to `attendance_sessions` table
2. Pass it from the session to `markAbsentForSession()`
3. Update admin UI to let admins set it when starting a session

---

## Admin APIs

### Get Absent Students
```
GET /api/admin/attendance/absent?session_id=<uuid>&from=<date>&to=<date>
```

**Response:**
```json
{
  "absent": [
    {
      "id": "uuid",
      "student_id": "uuid",
      "students": { "full_name": "John Doe", "student_id": "STU-001" },
      "verification_status": "AUTO_ABSENT",
      "absence_reason": "No clock-in by 09:30 AM",
      "marked_absent_at": "2024-09-01T09:30:00Z"
    }
  ]
}
```

### Get All Attendance (includes absences)
```
GET /api/admin/attendance?from=<date>&to=<date>&location_id=<uuid>
```
Returns clock-ins, clock-outs, and auto-marked absences.

---

## Admin Dashboard Integration

The Overview tab now shows:
- **Total absent**: Count of students marked absent today
- **Attendance table**: Includes `AUTO_ABSENT` rows

Example UI updates needed:

### Overview.svelte
```javascript
// Add to stats calculation
stats.absentToday = todayRecords.filter(r => r.verification_status === 'AUTO_ABSENT').length;

// In template
<div class="stat-card stat-gray">
  <span class="stat-icon">—</span>
  <span class="stat-val">{stats.absentToday || 0}</span>
  <span class="stat-lbl">Absent today</span>
</div>
```

### Attendance Table Column
```svelte
<th>Status</th> <!-- Add this -->
```

```svelte
<td>
  {#if r.verification_status === 'AUTO_ABSENT'}
    <span class="pill pill-absent">Absent</span>
  {:else if r.verification_status === 'VERIFIED'}
    <span class="pill pill-verified">Verified</span>
  {/if}
</td>
```

---

## Testing

### Manual Test (Without Waiting 9:30 AM)

Call the absence marker directly from Node REPL:
```javascript
const { markAbsent } = require('./src/services/absenceMarker');
await markAbsent();
```

Or create a manual trigger endpoint:
```javascript
// In admin.js (dev only, remove in production)
router.post('/admin/trigger-absence-check', async (req, res) => {
  const { markAbsent } = require('../services/absenceMarker');
  await markAbsent();
  res.json({ success: true, message: 'Absence check triggered' });
});
```

### Test Scenarios

1. **No clock-in**: Create a session, don't clock in, wait for 9:30 AM → student marked absent
2. **Clock-in but late**: Clock in at 9:45 AM → marked `is_late = true`, NOT absent
3. **Multiple sessions**: One morning, one afternoon → separate absence marking per session
4. **Duplicate prevention**: If student already has absence record, cron won't create another (due to unique constraint on student + session + date)

---

## Database Migration

Run in Supabase SQL editor:

```sql
-- Add new columns to attendance table
ALTER TABLE attendance
ADD COLUMN IF NOT EXISTS marked_absent_at timestamptz,
ADD COLUMN IF NOT EXISTS absence_reason text;

-- Create index for fast absence queries
CREATE INDEX IF NOT EXISTS attendance_absent_idx
  ON attendance(verification_status, marked_absent_at DESC)
  WHERE verification_status = 'AUTO_ABSENT';
```

---

## Troubleshooting

### Cron Job Not Running
1. Check backend logs: `npm run dev` should show "Initializing scheduled jobs..."
2. Verify Node.js version: `node-cron` requires Node.js 12+
3. Check server timezone: `console.log(Intl.DateTimeFormat().resolvedOptions().timeZone)`

### Students Not Marked Absent
1. Verify sessions were created for today: `SELECT * FROM attendance_sessions WHERE DATE(started_at) = TODAY()`
2. Check if students exist: `SELECT * FROM students WHERE status = 'active'`
3. Verify clock-in records: `SELECT * FROM attendance WHERE type = 'clock_in' AND DATE(recorded_at) = TODAY()`
4. Manually trigger: `POST /api/admin/trigger-absence-check` (dev endpoint)

### Too Many Absences Marked
- Verify absence deadline in `absenceMarker.js` — ensure it's after your intended arrival window
- Check if sessions are auto-closing unexpectedly

---

## Future Enhancements

1. **Dynamic absence deadline** — Set per-session in admin UI
2. **Exemptions** — Mark students as exempt from absence (medical, approved absence)
3. **Grace period** — 5-10 minute buffer after deadline before marking absent
4. **Notifications** — Email/SMS to admins when bulk absences detected
5. **Reversal** — Admins can manually un-mark a student if they find evidence of on-time arrival
6. **Reports** — Absence trends, repeat offenders, location-based patterns

---

## Files Modified

1. **backend/db/schema.sql** — Added columns to attendance table
2. **backend/src/index.js** — Integrated scheduler
3. **backend/src/services/absenceMarker.js** — NEW
4. **backend/src/jobs/absenceScheduler.js** — NEW
5. **backend/src/routes/admin.js** — Added GET /admin/attendance/absent endpoint
6. **backend/package.json** — Added node-cron dependency

---

## Deployment Notes

- **Production**: Ensure server timezone is set correctly (e.g., `TZ=UTC` environment variable)
- **Scaling**: If multiple backend instances, use a message queue or distributed lock to prevent duplicate marking
- **Monitoring**: Add alerts for when the cron job fails
- **Backups**: Keep audit_log backups in case administrators need to dispute absence records
