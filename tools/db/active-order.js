const pool = require('./client');

/**
 * Devuelve la orden de trabajo activa más reciente de un cliente (por teléfono),
 * o null si no tiene ninguna. "Activa" = no Completada ni Cancelada.
 */
async function getActiveOrder(telefono) {
  const { rows } = await pool.query(
    `SELECT id, nombre_cliente, telefono, trabajos, estado_orden, created_at,
            (created_at::date = (NOW() AT TIME ZONE 'America/Guayaquil')::date) AS es_de_hoy
     FROM citas
     WHERE telefono = $1
       AND COALESCE(estado_orden,'') NOT IN ('Completada','Cancelada')
     ORDER BY created_at DESC
     LIMIT 1`,
    [telefono]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Agrega un servicio extra al campo `trabajos` de una orden existente.
 * @returns la orden actualizada.
 */
async function appendServiceToOrder(citaId, servicio) {
  const { rows } = await pool.query(
    `UPDATE citas
        SET trabajos = CASE
              WHEN COALESCE(trabajos,'') = '' THEN $2
              ELSE trabajos || E'\n+ ' || $2
            END
      WHERE id = $1
      RETURNING id, nombre_cliente, trabajos`,
    [citaId, servicio]
  );
  return rows.length ? rows[0] : null;
}

module.exports = { getActiveOrder, appendServiceToOrder };
