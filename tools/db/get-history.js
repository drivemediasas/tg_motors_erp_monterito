const pool = require('./client');

async function getHistory(telefono) {
  const { rows } = await pool.query(
    'SELECT * FROM conversaciones WHERE telefono = $1 LIMIT 1',
    [telefono]
  );
  if (!rows.length) return null;
  const r = rows[0];
  return {
    recordId: r.id,
    paso: r.paso || 'inicio',
    servicioElegido: r.servicio_elegido || null,
    historial: Array.isArray(r.historial) ? r.historial : [],
  };
}

module.exports = { getHistory };
