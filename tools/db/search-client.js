const pool = require('./client');

async function searchClient(q) {
  const term = `%${q}%`;
  const { rows } = await pool.query(
    `SELECT id, nombre, telefono, email, placa, marca, modelo, anio,
            cedula, direccion, fecha_ultimo_servicio::text
     FROM clientes
     WHERE nombre   ILIKE $1
        OR placa    ILIKE $1
        OR telefono ILIKE $1
        OR email    ILIKE $1
     ORDER BY nombre
     LIMIT 20`,
    [term]
  );
  return rows;
}

module.exports = { searchClient };
