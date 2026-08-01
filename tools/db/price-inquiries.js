const pool = require('./client');

/**
 * Price inquiry relay storage.
 *
 * When a customer asks for a price that varies by vehicle/situation, Monterito
 * records the inquiry here and notifies the owner. The owner replies (admin mode)
 * and the answer is relayed back to the customer.
 */

/**
 * Record a pending price inquiry.
 * @param {object} p
 * @param {string} p.telefono - customer phone (no +)
 * @param {string} p.nombre   - customer name
 * @param {string} p.pregunta - the contextualized question (vehicle + need)
 */
async function createPriceInquiry({ telefono, nombre, pregunta, vehiculo, placa, concepto }) {
  const { rows } = await pool.query(
    `INSERT INTO consultas_precio (telefono, nombre, pregunta, vehiculo, placa, concepto, estado)
     VALUES ($1, $2, $3, $4, $5, $6, 'pendiente')
     RETURNING id`,
    [telefono, nombre || null, pregunta, vehiculo || null, placa || null, concepto || null]
  );
  return { id: rows[0].id };
}

/**
 * List pending price inquiries from the last 48h (oldest first).
 * Las más viejas se consideran expiradas y NO entran al matching del relay.
 */
async function getPendingPriceInquiries() {
  const { rows } = await pool.query(
    `SELECT id, telefono, nombre, pregunta, vehiculo, placa, concepto, created_at
     FROM consultas_precio
     WHERE estado = 'pendiente'
       AND created_at > NOW() - INTERVAL '48 hours'
     ORDER BY created_at ASC`
  );
  return rows;
}

/**
 * Store the WhatsApp message id of the owner notification, so a quoted reply
 * from the owner can be matched back to this exact inquiry.
 */
async function setInquiryNotifyMsgId(id, msgId) {
  if (!id || !msgId) return;
  await pool.query('UPDATE consultas_precio SET notify_msg_id = $2 WHERE id = $1', [id, msgId]);
}

/**
 * Find a pending inquiry by the notification message id the owner quoted/replied to.
 * @returns the row, or null.
 */
async function getInquiryByNotifyMsgId(msgId) {
  if (!msgId) return null;
  const { rows } = await pool.query(
    `SELECT id, telefono, nombre, pregunta, vehiculo, placa, concepto, estado
     FROM consultas_precio
     WHERE notify_msg_id = $1 AND estado = 'pendiente'
     ORDER BY created_at DESC
     LIMIT 1`,
    [msgId]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Cierra la consulta EXACTA por id (no "la más reciente"). Determinístico.
 * @returns the updated row, or null si no estaba pendiente.
 */
async function answerPriceInquiryById(id, respuesta) {
  const { rows } = await pool.query(
    `UPDATE consultas_precio
        SET estado = 'respondida', respuesta = $2, answered_at = NOW()
      WHERE id = $1 AND estado = 'pendiente'
      RETURNING *`,
    [id, respuesta]
  );
  return rows.length ? rows[0] : null;
}

/**
 * Mark the most recent pending inquiry for a phone as answered.
 * (Legado — el relay determinístico usa answerPriceInquiryById.)
 */
async function answerPriceInquiry(telefono, respuesta) {
  const { rows } = await pool.query(
    `UPDATE consultas_precio
        SET estado = 'respondida', respuesta = $2, answered_at = NOW()
      WHERE id = (
        SELECT id FROM consultas_precio
         WHERE telefono = $1 AND estado = 'pendiente'
         ORDER BY created_at DESC
         LIMIT 1
      )
      RETURNING *`,
    [telefono, respuesta]
  );
  return rows.length ? rows[0] : null;
}

module.exports = {
  createPriceInquiry,
  getPendingPriceInquiries,
  answerPriceInquiry,
  answerPriceInquiryById,
  setInquiryNotifyMsgId,
  getInquiryByNotifyMsgId,
};
