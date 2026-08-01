const pool = require('./client');

/**
 * Devuelve slots disponibles deduplicados por fecha+hora.
 * Si hay múltiples técnicos libres en el mismo horario, solo retorna uno.
 */
async function getAvailability(daysAhead = 14) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (fecha, hora)
       id AS "recordId",
       fecha::text,
       TO_CHAR(hora, 'HH24:MI') AS hora,
       tecnico
     FROM disponibilidad
     WHERE disponible = true
       AND fecha > CURRENT_DATE
       AND fecha <= CURRENT_DATE + ($1::int)
     ORDER BY fecha, hora, id`,
    [daysAhead]
  );
  return rows;
}

module.exports = { getAvailability };
