const crypto = require('crypto');

/**
 * Dedup DURABLE de webhooks (fuente de verdad = PostgreSQL).
 * El Set en memoria del handler es solo una caché rápida; esto sobrevive reinicios.
 *
 * @param {object} store - pg pool (o un fake con .query para tests)
 * @param {object} p     - { messageId, telefono, provider }
 * @returns {Promise<{duplicate:boolean}>}
 */
async function markProcessedDurable(store, { messageId, telefono, provider }) {
  if (!messageId) return { duplicate: false };
  const { rowCount } = await store.query(
    `INSERT INTO mensajes_procesados (message_id, telefono, provider)
     VALUES ($1, $2, $3)
     ON CONFLICT (message_id) DO NOTHING`,
    [messageId, telefono || null, provider || null]
  );
  // rowCount === 0 → ya existía (duplicado)
  return { duplicate: rowCount === 0 };
}

/**
 * Fallback cuando el proveedor NO envía message_id.
 * RIESGO DOCUMENTADO: dos mensajes idénticos del mismo número dentro de la misma
 * ventana de 10s colisionan (se tratarían como duplicado). Aceptable como degradación.
 */
function fallbackId(telefono, body) {
  const bucket = Math.floor(Date.now() / 10000); // ventana de 10s
  return 'fb_' + crypto.createHash('sha1')
    .update(`${telefono || ''}|${bucket}|${body || ''}`)
    .digest('hex')
    .slice(0, 24);
}

module.exports = { markProcessedDurable, fallbackId };
