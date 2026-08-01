const pool = require('./client');

/**
 * Precios estándar de servicios básicos que el bot puede responder directo.
 * Los específicos (que dependen del vehículo/situación) van por consultar_precio (Diego).
 */

/**
 * Busca el precio estándar de un servicio por nombre (match flexible).
 * Estrategia: match exacto (case-insensitive) → match por contención en cualquier dirección.
 * @returns { servicio, precio, nota } o null.
 */
async function getPrecioEstandar(servicio) {
  const q = (servicio || '').trim();
  if (!q) return null;

  // 1) Coincidencia exacta (sin distinguir mayúsculas/acentos básicos)
  let { rows } = await pool.query(
    `SELECT servicio, precio, nota FROM precios_estandar
     WHERE activo = true AND LOWER(servicio) = LOWER($1)
     LIMIT 1`,
    [q]
  );
  if (rows.length) return rows[0];

  // 2) Coincidencia por contención (el pedido contiene el servicio o viceversa)
  ({ rows } = await pool.query(
    `SELECT servicio, precio, nota FROM precios_estandar
     WHERE activo = true
       AND ($1 ILIKE '%' || servicio || '%' OR servicio ILIKE '%' || $1 || '%')
     ORDER BY LENGTH(servicio) DESC
     LIMIT 1`,
    [q]
  ));
  return rows.length ? rows[0] : null;
}

/**
 * Lista todos los precios estándar activos.
 */
async function listPreciosEstandar() {
  const { rows } = await pool.query(
    `SELECT id, servicio, precio, nota FROM precios_estandar
     WHERE activo = true ORDER BY servicio`
  );
  return rows;
}

module.exports = { getPrecioEstandar, listPreciosEstandar };
