/**
 * absenceScheduler.js — Initializes scheduled jobs for attendance processing.
 * 
 * Scheduled tasks:
 * - Every day at 9:30 AM: Mark students as absent if no clock-in
 * - Every hour: Clean up expired sessions and QR codes
 */

const cron = require('node-cron');
const { markAbsent } = require('../services/absenceMarker');

/**
 * Initialize all scheduled jobs.
 * Call this once when the server starts.
 */
function initSchedules() {
  console.log('📅 Initializing scheduled jobs...');

  // ── Mark absent at 9:30 AM every day ───────────────────────────────────────
  // Cron format: "minute hour day month dayOfWeek"
  // "30 9 * * *" = at 9:30 AM every day (UTC timezone by default)
  // Change timezone by setting { timezone: 'America/New_York' } for EST, etc.
  const absenceJob = cron.schedule('30 9 * * *', async () => {
    console.log('▶️ Running absence marking job...');
    await markAbsent();
  });

  console.log('✓ Absence job scheduled: every day at 09:30 UTC');

  // ── Cleanup expired sessions (optional, can be done on demand) ──────────────
  const cleanupJob = cron.schedule('0 * * * *', async () => {
    console.log('▶️ Running session cleanup job...');
    // Placeholder for cleanup logic
    // You can add database cleanup here if needed
  });

  console.log('✓ Cleanup job scheduled: every hour at :00');

  return { absenceJob, cleanupJob };
}

module.exports = { initSchedules };
