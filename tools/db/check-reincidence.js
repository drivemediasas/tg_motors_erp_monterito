const pool = require('./client');

async function checkReincidence({ telefono, placa }) {
  const { rows } = await pool.query(
    `SELECT c.id, c.servicio_solicitado, c.fecha::text, c.tecnico
     FROM citas c
     LEFT JOIN clientes cl ON cl.telefono = c.telefono
     WHERE (
       (c.telefono = $1 AND $1 != '')
       OR ($2 != '' AND cl.placa ILIKE $2)
     )
       AND c.fecha >= CURRENT_DATE - INTERVAL '30 days'
       AND c.estado IN ('Completado','En proceso','Completada')
     ORDER BY c.fecha DESC
     LIMIT 1`,
    [telefono || '', placa || '']
  );
  return rows.length ? rows[0] : null;
}

module.exports = { checkReincidence };
