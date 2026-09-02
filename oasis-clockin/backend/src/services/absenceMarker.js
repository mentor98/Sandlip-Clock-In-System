/**
 * absenceMarker.js — Scheduled job to mark students as absent if no clock-in by deadline.
 * 
 * Runs at 9:30 AM daily:
 * 1. Find all active sessions that started today
 * 2. For each session, find all enrolled students (students in that location)
 * 3. Mark students with no clock-in by 09:30 AM as absent
 * 4. Log to audit log
 */

const { supabaseAdmin } = require('../config/supabase');

/**
 * Mark students absent if no clock-in by deadline.
 * Called by a scheduled job (e.g., node-cron or external scheduler).
 */
async function markAbsent() {
  console.log('🔔 Absence marker job started at', new Date().toISOString());

  try {
    // Get today's date (in UTC, midnight)
    const today = new Date().toISOString().split('T')[0];
    const absenceDeadline = '09:30'; // e.g., mark absent if no clock-in by 9:30 AM

    // ── 1. Find sessions that started today ────────────────────────────────────
    const { data: sessions, error: sessionError } = await supabaseAdmin
      .from('attendance_sessions')
      .select('id, title, location_id, created_by')
      .gte('started_at', `${today}T00:00:00Z`)
      .lte('started_at', `${today}T23:59:59Z`);

    if (sessionError) {
      console.error('Error fetching sessions:', sessionError);
      return;
    }

    if (!sessions || sessions.length === 0) {
      console.log('No sessions started today.');
      return;
    }

    console.log(`Found ${sessions.length} session(s) today.`);

    // ── 2. For each session, mark absent students ──────────────────────────────
    for (const session of sessions) {
      await markAbsentForSession(session, today, absenceDeadline);
    }

    console.log('✓ Absence marker job completed.');
  } catch (error) {
    console.error('Absence marker job failed:', error);
  }
}

/**
 * Mark absent students for a specific session.
 */
async function markAbsentForSession(session, todayDateStr, absenceDeadline) {
  const { id: sessionId, title, location_id, created_by } = session;

  console.log(`Processing session: ${title} (ID: ${sessionId})`);

  // ── Get all students in this organization ──────────────────────────────────
  // (Assuming all active students should have clocked in at the location.)
  // In a real system, you might have an enrollment table. For now, we'll mark
  // any student with no clock-in for this session/location combo as absent.

  const { data: allStudents, error: studentError } = await supabaseAdmin
    .from('students')
    .select('id, full_name, student_id')
    .eq('status', 'active');

  if (studentError) {
    console.error(`Error fetching students for session ${sessionId}:`, studentError);
    return;
  }

  if (!allStudents || allStudents.length === 0) {
    console.log(`No active students found.`);
    return;
  }

  console.log(`Checking ${allStudents.length} active student(s)...`);

  // ── For each student, check if they have a clock-in for this session ────────
  for (const student of allStudents) {
    const { id: studentId, full_name, student_id: studentIdStr } = student;

    // Check if student already has a clock-in for today
    const { data: clockins, error: clockinError } = await supabaseAdmin
      .from('attendance')
      .select('id, type, recorded_at')
      .eq('student_id', studentId)
      .eq('session_id', sessionId)
      .eq('type', 'clock_in')
      .gte('recorded_at', `${todayDateStr}T00:00:00`)
      .lte('recorded_at', `${todayDateStr}T23:59:59`);

    if (clockinError) {
      console.error(`Error checking clock-in for student ${studentIdStr}:`, clockinError);
      continue;
    }

    // If no clock-in found, mark as absent
    if (!clockins || clockins.length === 0) {
      const absenceRecord = {
        student_id: studentId,
        session_id: sessionId,
        location_id,
        type: 'absence',
        recorded_at: new Date().toISOString().split('T')[0], // Today's date
        verification_status: 'AUTO_ABSENT',
        marked_absent_at: new Date().toISOString(),
        absence_reason: `No clock-in by ${absenceDeadline}`,
      };

      const { data: inserted, error: insertError } = await supabaseAdmin
        .from('attendance')
        .insert(absenceRecord)
        .select()
        .single();

      if (insertError) {
        // Ignore duplicate errors (student already marked absent)
        if (insertError.code !== '23505') {
          console.error(`Error marking student ${studentIdStr} absent:`, insertError);
        }
      } else {
        console.log(`✓ Marked ${full_name} (${studentIdStr}) as absent.`);

        // Log audit event
        await supabaseAdmin.from('audit_log').insert({
          student_id: studentId,
          event_type: 'student_marked_absent',
          detail: {
            session_id: sessionId,
            session_title: title,
            reason: `No clock-in by ${absenceDeadline}`,
            marked_by: 'scheduler',
          },
        });
      }
    }
  }
}

module.exports = { markAbsent };
