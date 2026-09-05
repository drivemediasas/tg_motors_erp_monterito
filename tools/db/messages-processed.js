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
 * Fallback cuando el proveedor NO envía message_id (raro: 360dialog casi siempre
 * manda `wamid`). Contador incremental por (telefono|texto): cada inbound recibe
 * un id ÚNICO, incluso dos mensajes idénticos seguidos ("2" y "2"). Preferimos
 * procesar de más antes que tragarnos un mensaje del cliente (silencio total).
 * El webhook responde 200 de inmediato, así que los reintentos del proveedor son
 * mínimos; el dedup real vive en el `wamid` cuando sí viene.
 */
const _fbSeq = new Map(); // `${telefono}|${body}` → n

function fallbackId(telefono, body) {
  const key = `${telefono || ''}|${body || ''}`;
  const n = (_fbSeq.get(key) || 0) + 1;
  _fbSeq.set(key, n);
  if (_fbSeq.size > 5000) _fbSeq.delete(_fbSeq.keys().next().value);
  return 'fb_' + crypto.createHash('sha1').update(`${key}|${n}|${Date.now()}`).digest('hex').slice(0, 24);
}

module.exports = { markProcessedDurable, fallbackId };
