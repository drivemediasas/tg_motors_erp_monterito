const pool = require('./client');

async function getMaintenanceDue() {
  const { rows } = await pool.query(
    `SELECT id, nombre, telefono, marca, modelo, fecha_ultimo_servicio::text
     FROM clientes
     WHERE fecha_ultimo_servicio BETWEEN CURRENT_DATE - 130 AND CURRENT_DATE - 110
       AND mantenimiento_recordado = false`
  );
  return rows.map(r => ({
    id: r.id,
    nombre: r.nombre,
    telefono: r.telefono,
    marca: r.marca,
    modelo: r.modelo,
    fechaUltimoServicio: r.fecha_ultimo_servicio,
  }));
}

async function markMaintenanceReminded(id) {
  await pool.query('UPDATE clientes SET mantenimiento_recordado = true WHERE id = $1', [id]);
}

module.exports = { getMaintenanceDue, markMaintenanceReminded };
