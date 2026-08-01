const pool = require('./client');

/**
 * Devuelve el historial COMPLETO de citas/órdenes de un cliente por teléfono.
 */
async function getClientHistory(telefono) {
  const { rows } = await pool.query(
    `SELECT id, servicio_solicitado, fecha::text, TO_CHAR(hora,'HH24:MI') AS hora,
            estado, estado_orden, tecnico, trabajos, descripcion_problema,
            repuestos, kilometraje, mano_de_obra, tipo_servicio, created_at::text
     FROM citas
     WHERE telefono = $1
     ORDER BY fecha DESC NULLS LAST, created_at DESC
     LIMIT 500`,
    [telefono]
  );
  return rows;
}

module.exports = { getClientHistory };
