# Setting Up Absence Marking — Quick Start Guide

## What's New

Your Oasis ClockIn system now automatically marks students as **absent** if they don't clock in within a specified time window.

**Example**: 
- Attendance window: 7:00 AM – 9:00 AM
- Absence marking: 9:30 AM daily
- Any student without a clock-in by 9:30 AM → marked `AUTO_ABSENT`

---

## Step 1: Install Dependencies

In the backend directory:

```bash
cd oasis-clockin/backend
npm install
```

The `node-cron` package was added to `package.json`. Running `npm install` will fetch it.

---

## Step 2: Run Database Migrations

In the Supabase SQL editor (or your PostgreSQL client):

1. Open [Supabase Dashboard](https://supabase.com) → Your project → SQL Editor
2. Create a new query and paste the contents of:
   ```
   oasis-clockin/backend/db/migrations.sql
   ```
3. Click "Run"

This adds:
- `marked_absent_at` — timestamp when absence was auto-marked
- `absence_reason` — why the student was marked absent
- `is_late` — boolean to track late arrivals
- `on_time_until` — time column in `attendance_sessions` to set the deadline

---

## Step 3: Verify Backend Startup

Start the backend:

```bash
npm run dev
```

You should see:

```
📅 Initializing scheduled jobs...
✓ Absence job scheduled: every day at 09:30 UTC
✓ Cleanup job scheduled: every hour at :00
Oasis ClockIn backend listening on :4000
```

The cron job is now active and will run automatically at 9:30 AM UTC every day.

---

## Step 4 (Optional): Set Timezone

The default schedule runs at **9:30 AM UTC**. If your school operates in a different timezone, edit:

**File**: `backend/src/jobs/absenceScheduler.js`

Find this line:
```javascript
const absenceJob = cron.schedule('30 9 * * *', async () => {
```

Add timezone config:
```javascript
const absenceJob = cron.schedule('30 9 * * *', async () => {
  // ...
}, {
  timezone: 'America/New_York'  // Change this
});
```

**Common timezones**:
- `America/New_York` — Eastern Time
- `America/Chicago` — Central Time
- `America/Denver` — Mountain Time
- `America/Los_Angeles` — Pacific Time
- `Europe/London` — UK Time
- `Europe/Berlin` — Central European Time
- `Asia/Tokyo` — Japan Time
- `Australia/Sydney` — Australian Time

Restart the backend after changing timezone.

---

## Step 5: Test the Feature

### Without Waiting Until 9:30 AM

Create a **dev-only endpoint** to manually trigger the absence job:

**Edit**: `backend/src/routes/admin.js`

Add this at the end (before `module.exports`):

```javascript
// DEV ONLY — remove before production
if (process.env.NODE_ENV !== 'production') {
  router.post('/trigger-absence-check', async (req, res) => {
    const { markAbsent } = require('../services/absenceMarker');
    try {
      await markAbsent();
      res.json({ success: true, message: 'Absence check triggered' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });
}
```

Then call it:

```bash
curl -X POST http://localhost:4000/api/admin/trigger-absence-check \
  -H "Authorization: Bearer <admin_token>" \
  -H "Content-Type: application/json"
```

Or use Postman/Insomnia.

### Manual Test Scenario

1. **Create a session** in the admin dashboard (Morning Session)
2. **Don't clock in** as any student
3. **Wait until 9:30 AM** (or manually trigger via dev endpoint)
4. **Refresh Overview** — you should see "Absent today: 1"
5. Click the attendance table to verify the student is marked `AUTO_ABSENT`

---

## Step 6: Admin Dashboard Integration

The overview should now show:

### Stats Card
```
⊘ Absent today
<number>
```

### Attendance Table Columns
- Student name
- Clock-in time
- Location
- Risk score
- **Status** (new) — shows "Absent" in gray for auto-marked absences

### Example UI Update (Optional)

If you want to display absence stats in your admin dashboard, update **Overview.svelte**:

```javascript
// In the load function
const absent = todayRecords.filter(r => r.verification_status === 'AUTO_ABSENT');
stats.absentToday = absent.length;

// In the template
<div class="stat-card stat-gray">
  <span class="stat-icon">—</span>
  <span class="stat-val">{stats.absentToday || 0}</span>
  <span class="stat-lbl">Absent today</span>
</div>
```

---

## API Endpoints

### Get Absent Students
```
GET /api/admin/attendance/absent
```

**Query Parameters**:
- `session_id` (optional) — filter by session
- `from` (optional) — date range start
- `to` (optional) — date range end

**Response**:
```json
{
  "absent": [
    {
      "id": "uuid",
      "student_id": "uuid",
      "students": {
        "full_name": "John Doe",
        "student_id": "STU-001"
      },
      "verification_status": "AUTO_ABSENT",
      "absence_reason": "No clock-in by 09:30 AM",
      "marked_absent_at": "2024-09-01T09:30:00Z"
    }
  ]
}
```

### Get All Attendance (Includes Absences)
```
GET /api/admin/attendance?from=2024-09-01&to=2024-09-01
```

Returns clock-ins, clock-outs, and auto-marked absences.

---

## Configuration

### Absence Deadline

Currently hardcoded to **9:30 AM** in `backend/src/services/absenceMarker.js`:

```javascript
const absenceDeadline = '09:30';
```

To make it dynamic per-session:

1. Admin sets it when starting a session (already done in Sessions UI)
2. Backend passes `on_time_until` to the absence marker
3. Students clocking in after this time are marked `is_late = true`
4. If they don't clock in at all by 9:30 AM, they're marked `AUTO_ABSENT`

---

## How It Works

### Daily Flow

| Time | What Happens |
|------|--------------|
| 7:00 AM | Admin starts "Morning Session" with `on_time_until = 09:00` |
| 7:00 – 9:00 AM | Students can clock in; marked on-time |
| 9:01 – 9:30 AM | Students clock in but marked `is_late = true` |
| 9:30 AM | **Cron job runs**: Any student without clock-in → marked `AUTO_ABSENT` |
| 10:00 AM | Admin closes the session |

### Database Record for Absent Student

```javascript
{
  id: 'uuid',
  student_id: 'uuid',
  session_id: 'uuid',
  location_id: 'uuid',
  type: 'absence',  // Not a real clock-in
  recorded_at: '2024-09-01',
  verification_status: 'AUTO_ABSENT',  // Special status
  marked_absent_at: '2024-09-01T09:30:00Z',
  absence_reason: 'No clock-in by 09:30 AM'
}
```

### Audit Log Entry

Every absence marking is logged:

```javascript
{
  student_id: 'uuid',
  event_type: 'student_marked_absent',
  detail: {
    session_id: 'uuid',
    session_title: 'Morning Session',
    reason: 'No clock-in by 09:30 AM',
    marked_by: 'scheduler'
  },
  created_at: '2024-09-01T09:30:00Z'
}
```

---

## Troubleshooting

### Cron Job Not Running?

1. **Check logs**: Run `npm run dev` and look for "Initializing scheduled jobs..."
2. **Node version**: Ensure Node.js 12 or higher: `node --version`
3. **Server time**: Check server clock is correct: `date`
4. **Timezone**: Verify server timezone matches your config: `timedatectl` (Linux) or `Get-TimeZone` (Windows)

### Students Not Marked Absent?

```bash
# Check if sessions exist today
SELECT * FROM attendance_sessions 
WHERE DATE(started_at) = CURRENT_DATE;

# Check if students exist
SELECT * FROM students WHERE status = 'active';

# Manually trigger the job (dev endpoint)
curl -X POST http://localhost:4000/api/admin/trigger-absence-check \
  -H "Authorization: Bearer <admin_token>"

# Check audit log for errors
SELECT * FROM audit_log 
WHERE event_type = 'student_marked_absent'
ORDER BY created_at DESC LIMIT 10;
```

### Too Many Absences?

- Verify `on_time_until` is set correctly (e.g., `09:00` not `90:00`)
- Check if sessions are actually active at 9:30 AM
- Verify student data has no duplicates

---

## Production Deployment

Before going live:

1. **Remove dev endpoint**: Delete the `trigger-absence-check` endpoint from `admin.js`
2. **Set timezone**: Configure to your actual location's timezone
3. **Monitor cron**: Add monitoring/alerts for when the job runs (optional)
4. **Backups**: Keep database backups in case of disputes
5. **Communicate**: Tell admins the feature is active and how to interpret results

---

## Files Modified/Created

**New Files**:
- `backend/src/services/absenceMarker.js` — Core absence marking logic
- `backend/src/jobs/absenceScheduler.js` — Cron job initialization

**Modified Files**:
- `backend/db/schema.sql` — Added columns to `attendance` table
- `backend/db/migrations.sql` — Added migration statements
- `backend/src/index.js` — Integrated scheduler startup
- `backend/src/routes/admin.js` — Added `/attendance/absent` endpoint
- `backend/package.json` — Added `node-cron` dependency

---

## Next Steps

1. ✅ Install dependencies
2. ✅ Run migrations
3. ✅ Start backend with scheduler
4. ✅ Test via dev endpoint or wait until 9:30 AM
5. ✅ Update admin dashboard UI (optional)
6. ✅ Deploy to production

---

## Questions?

Refer to `ABSENCE_MARKING_IMPLEMENTATION.md` for detailed architecture and advanced configuration.
