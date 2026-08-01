require('dotenv').config();
const pool = require('./client');

const DAYS_AHEAD = 14;

function parseSchedule() {
  const raw = process.env.SHOP_HOURS || 'Lunes a Viernes 8:30-17:30, Sábados 9:00-16:00';
  const weekday  = raw.match(/Viernes\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/i);
  const saturday = raw.match(/S[aá]bados?\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})/i);
  return {
    weekday:  weekday  ? [weekday[1],  weekday[2]]  : ['08:30', '17:30'],
    saturday: saturday ? [saturday[1], saturday[2]] : ['09:00', '16:00'],
  };
}

function buildTimeSlots(start, end) {
  const slots = [];
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let cur = sh * 60 + sm;
  const stop = eh * 60 + em;
  while (cur < stop) {
    slots.push(`${String(Math.floor(cur/60)).padStart(2,'0')}:${String(cur%60).padStart(2,'0')}`);
    cur += 60;
  }
  return slots;
}

function addDays(d, n) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function toDateStr(d) { return d.toISOString().split('T')[0]; }

async function generateAvailability() {
  const schedule    = parseSchedule();
  const technicians = (process.env.SHOP_TECHNICIANS || '').split(',').map(t => t.trim()).filter(Boolean);
  const today       = new Date(); today.setHours(0,0,0,0);

  const wanted = [];
  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const d   = addDays(today, i);
    const dow = d.getDay();
    if (dow === 0) continue; // domingo

    const [start, end] = dow === 6 ? schedule.saturday : schedule.weekday;
    const times  = buildTimeSlots(start, end);
    const fecha  = toDateStr(d);

    if (technicians.length) {
      for (const tecnico of technicians)
        for (const hora of times) wanted.push({ fecha, hora, tecnico });
    } else {
      const capacity = parseInt(process.env.SHOP_CAPACITY || '3', 10);
      for (const hora of times)
        for (let c = 0; c < capacity; c++) wanted.push({ fecha, hora, tecnico: null });
    }
  }

  if (!wanted.length) { console.log('[availability] Nada que generar.'); return { created: 0 }; }

  let created = 0;
  for (const { fecha, hora, tecnico } of wanted) {
    await pool.query(
      `INSERT INTO disponibilidad (fecha, hora, disponible, tecnico)
       VALUES ($1, $2, true, $3)
       ON CONFLICT (fecha, hora, COALESCE(tecnico,'')) DO NOTHING`,
      [fecha, hora, tecnico]
    );
    created++;
  }

  console.log(`[availability] Procesados ${created} slots (${toDateStr(addDays(today,1))} → ${toDateStr(addDays(today,DAYS_AHEAD))})`);
  return { created };
}

module.exports = { generateAvailability };

if (require.main === module) {
  generateAvailability()
    .then(r => { console.log(`Listo. Creados: ${r.created}`); pool.end(); })
    .catch(e => { console.error(e); process.exit(1); });
}
