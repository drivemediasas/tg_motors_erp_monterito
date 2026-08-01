const pool = require('./client');

/**
 * Devuelve la orden de trabajo más reciente de un teléfono que ya no esté
 * en Borrador (es decir, una que el cliente pueda consultar).
 * Retorna null si no hay ninguna.
 */
async function getOrderStatus(telefono) {
  const { rows } = await pool.query(
    `SELECT c.estado_orden, c.servicio_solicitado, c.trabajos, c.tecnico,
            c.fecha::text AS fecha, cl.placa, cl.marca, cl.modelo
       FROM citas c
       LEFT JOIN clientes cl ON cl.telefono = c.telefono
      WHERE c.telefono = $1
        AND c.estado_orden IS NOT NULL
        AND c.estado_orden <> 'Borrador'
      ORDER BY c.created_at DESC
      LIMIT 1`,
    [telefono]
  );
  return rows[0] || null;
}

module.exports = { getOrderStatus };
