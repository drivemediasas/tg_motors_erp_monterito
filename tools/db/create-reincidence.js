const pool = require('./client');
const { alertOwner } = require('../whatsapp/alert-owner');

async function createReincidence({ placa, telefono, clienteNombre, tecnico,
  trabajoOriginal, fechaOriginal, fechaRegreso, citaOriginalId, citaRegresoId }) {

  const { rows } = await pool.query(
    `INSERT INTO reincidencias
       (placa, telefono, cliente_nombre, tecnico, trabajo_original,
        fecha_original, fecha_regreso, cita_original_id, cita_regreso_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING id`,
    [placa, telefono, clienteNombre, tecnico, trabajoOriginal,
     fechaOriginal, fechaRegreso, citaOriginalId || null, citaRegresoId || null]
  );

  console.log(`[reincidencia] Detectada y registrada en BD para ${clienteNombre} (${placa}) — ID ${rows[0].id}`);
  return rows[0].id;
}

module.exports = { createReincidence };
