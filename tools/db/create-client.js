const pool = require('./client');

async function createClient({ nombre, telefono, placa, marca, modelo, año }) {
  const { rows } = await pool.query(
    `INSERT INTO clientes (nombre, telefono, placa, marca, modelo, anio)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (telefono) DO UPDATE SET nombre = EXCLUDED.nombre
     RETURNING *`,
    [nombre, telefono, placa || null, marca || null, modelo || null, año || null]
  );
  const r = rows[0];
  return { id: r.id, nombre: r.nombre, telefono: r.telefono };
}

module.exports = { createClient };
