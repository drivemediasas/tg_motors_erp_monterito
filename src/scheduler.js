const cron = require('node-cron');
const { sendReminders, sendSurveys, sendMaintenanceReminders } = require('./handlers/outbound');
const { generateAvailability } = require('../tools/db/generate-availability');

function start() {
  // Every 15 min — appointment reminders ~2h before the appointment time
  cron.schedule('*/15 * * * *', async () => {
    console.log('[cron] Running: sendReminders');
    await sendReminders().catch(e => console.error('[cron] sendReminders error:', e));
  });

  // Daily at 18:00 Ecuador time (UTC-5 = 23:00 UTC) — post-service surveys
  cron.schedule('0 23 * * *', async () => {
    console.log('[cron] Running: sendSurveys');
    await sendSurveys().catch(e => console.error('[cron] sendSurveys error:', e));
  });

  // Daily at 09:00 Ecuador time (UTC-5 = 14:00 UTC) — maintenance reminders
  cron.schedule('0 14 * * *', async () => {
    console.log('[cron] Running: sendMaintenanceReminders');
    await sendMaintenanceReminders().catch(e => console.error('[cron] sendMaintenanceReminders error:', e));
  });

  // Every Sunday at 08:00 Ecuador time (UTC-5 = 13:00 UTC) — generate next 2 weeks of availability
  cron.schedule('0 13 * * 0', async () => {
    console.log('[cron] Running: generateAvailability');
    await generateAvailability().catch(e => console.error('[cron] generateAvailability error:', e));
  });

  console.log('Scheduler started (4 cron jobs active)');
}

module.exports = { start };
