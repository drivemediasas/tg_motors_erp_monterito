const pool = require('./client');

/**
 * Cancela la próxima cita futura del cliente y libera los cupos que ocupaba.
 * Retorna { id } de la cita cancelada, o null si no había ninguna pendiente.
 */
async function cancelAppointment(telefono) {
  const { rows } = await pool.query(
    `SELECT id FROM citas
      WHERE telefono = $1
        AND fecha >= CURRENT_DATE
        AND COALESCE(estado, '') NOT IN ('Cancelada', 'Completado')
      ORDER BY fecha ASC, hora ASC
      LIMIT 1`,
    [telefono]
  );
  if (!rows.length) return null;

  const id = rows[0].id;
  await pool.query(`UPDATE citas SET estado = 'Cancelada' WHERE id = $1`, [id]);
  // Liberar los cupos que la cita había bloqueado en disponibilidad.
  await pool.query(
    `UPDATE disponibilidad SET disponible = true, cita_id = NULL WHERE cita_id = $1`,
    [id]
  );
  return { id };
}

module.exports = { cancelAppointment };
