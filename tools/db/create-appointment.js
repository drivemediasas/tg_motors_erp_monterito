const pool = require('./client');

async function createAppointment({ nombreCliente, telefono, servicio, fecha, hora, slotRecordId, notas }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO citas (nombre_cliente, telefono, servicio_solicitado, fecha, hora, estado, notas)
       VALUES ($1, $2, $3, $4, $5, 'Pendiente', $6)
       RETURNING *`,
      [nombreCliente, telefono, servicio, fecha, hora, notas || null]
    );
    const cita = rows[0];

    if (slotRecordId) {
      await client.query(
        'UPDATE disponibilidad SET disponible = false, cita_id = $1 WHERE id = $2',
        [cita.id, slotRecordId]
      );
    }

    await client.query('COMMIT');
    return {
      id: cita.id,
      nombreCliente: cita.nombre_cliente,
      fecha: cita.fecha,
      hora: cita.hora,
      servicio: cita.servicio_solicitado,
      estado: cita.estado,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { createAppointment };
