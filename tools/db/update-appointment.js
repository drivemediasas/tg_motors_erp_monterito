const pool = require('./client');

// Mapeo de nombres de campo (legado Airtable → columna SQL)
const FIELD_MAP = {
  Estado:          'estado',
  Seguimiento:     'seguimiento',
  Fecha_Completada:'fecha_completada',
  estado_orden:    'estado_orden',
  tecnico:         'tecnico',
};

async function updateAppointment(id, fields) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const [key, val] of Object.entries(fields)) {
    const col = FIELD_MAP[key] || key.toLowerCase();
    sets.push(`${col} = $${i}`);
    vals.push(val);
    i++;
  }
  vals.push(id);
  await pool.query(`UPDATE citas SET ${sets.join(', ')} WHERE id = $${i}`, vals);
  return { id, updated: true };
}

async function getAppointmentsNeedingReminder() {
  // Recordatorio ~2h antes de la HORA de la cita (no 24h). `fecha + hora` es la
  // hora local (Ecuador) tal como se agendó; `AT TIME ZONE 'America/Guayaquil'`
  // la convierte al instante UTC real → la comparación con NOW() es correcta
  // sin depender de la TZ del servidor (Railway corre en UTC). El dedupe por
  // seguimiento='reminder_sent' hace que se envíe una sola vez, en el primer
  // tick del cron en que la cita entra a la ventana de ≤2h.
  const { rows } = await pool.query(
    `SELECT id, nombre_cliente, telefono, fecha::text, TO_CHAR(hora,'HH24:MI') AS hora, servicio_solicitado
     FROM citas
     WHERE (fecha + hora) AT TIME ZONE 'America/Guayaquil'
             BETWEEN NOW() AND NOW() + INTERVAL '2 hours'
       AND (seguimiento IS NULL OR seguimiento != 'reminder_sent')
       AND estado = 'Pendiente'`
  );
  return rows.map(r => ({
    id: r.id,
    nombreCliente: r.nombre_cliente,
    telefono: r.telefono,
    fecha: r.fecha,
    hora: r.hora,
    servicio: r.servicio_solicitado,
  }));
}

async function getAppointmentsNeedingSurvey() {
  const { rows } = await pool.query(
    `SELECT id, nombre_cliente, telefono, servicio_solicitado, fecha_completada::text
     FROM citas
     WHERE estado = 'Completado'
       AND (seguimiento IS NULL OR seguimiento != 'survey_sent')`
  );
  return rows.map(r => ({
    id: r.id,
    nombreCliente: r.nombre_cliente,
    telefono: r.telefono,
    servicio: r.servicio_solicitado,
    fechaCompletada: r.fecha_completada,
  }));
}

module.exports = { updateAppointment, getAppointmentsNeedingReminder, getAppointmentsNeedingSurvey };
