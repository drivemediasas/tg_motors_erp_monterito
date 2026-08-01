const pool = require('./client');

/**
 * Devuelve el horario del día de un técnico: qué slots tiene ocupados y libres.
 */
async function getTechnicianSchedule(tecnico, fecha) {
  const { rows } = await pool.query(
    `SELECT TO_CHAR(d.hora,'HH24:MI') AS hora, d.disponible, c.servicio_solicitado, c.nombre_cliente
     FROM disponibilidad d
     LEFT JOIN citas c ON c.id = d.cita_id
     WHERE d.tecnico = $1 AND d.fecha = $2
     ORDER BY d.hora`,
    [tecnico, fecha]
  );
  return rows;
}

module.exports = { getTechnicianSchedule };
