const pool = require('./client');

const MAX_HISTORY = 12;

async function appendMessage({ telefono, paso, servicioElegido, newMessages, existingRecordId }) {
  // Cargar historial actual
  let historial = [];
  if (existingRecordId) {
    const { rows } = await pool.query('SELECT historial FROM conversaciones WHERE id = $1', [existingRecordId]);
    if (rows.length) historial = rows[0].historial || [];
  }

  historial = [...historial, ...newMessages].slice(-MAX_HISTORY);

  const { rows } = await pool.query(
    `INSERT INTO conversaciones (telefono, paso, servicio_elegido, historial, ultima_actualizacion)
     VALUES ($1, $2, $3, $4::jsonb, NOW())
     ON CONFLICT (telefono) DO UPDATE SET
       paso                 = EXCLUDED.paso,
       servicio_elegido     = EXCLUDED.servicio_elegido,
       historial            = EXCLUDED.historial,
       ultima_actualizacion = NOW()
     RETURNING id`,
    [telefono, paso, servicioElegido || null, JSON.stringify(historial)]
  );
  return { recordId: rows[0].id };
}

module.exports = { appendMessage };
