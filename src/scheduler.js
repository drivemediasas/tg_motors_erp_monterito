const cron = require('node-cron');
const { generateAvailability } = require('../tools/db/generate-availability');

function start() {
  // Recordatorios, encuestas y mantenimiento DESACTIVADOS.
  // El bot solo agenda la cita y listo — no envía mensajes posteriores al cliente.

  // Every Sunday at 08:00 Ecuador time (UTC-5 = 13:00 UTC) — generate next 2 weeks of availability
  cron.schedule('0 13 * * 0', async () => {
    console.log('[cron] Running: generateAvailability');
    await generateAvailability().catch(e => console.error('[cron] generateAvailability error:', e));
  });

  console.log('Scheduler started (1 cron job active — availability generation only)');
}

module.exports = { start };
