const { sendMessage } = require('./send-message');

/**
 * Notify the shop owner of a customer price inquiry over WhatsApp.
 * The owner replies (admin mode) and the answer is relayed back to the customer.
 *
 * @param {object} params
 * @param {string} params.clientName  - customer name
 * @param {string} params.clientPhone - customer phone (no +)
 * @param {string} params.question    - contextualized question (vehicle + need)
 * @returns {object} { success, ownerPhone }
 */
async function notifyOwnerPrice({ clientName, clientPhone, question }) {
  const ownerPhone = (process.env.OWNER_PHONE || '').trim();
  const ownerName  = (process.env.OWNER_NAME  || 'Equipo').trim();

  if (!ownerPhone) {
    console.warn('[notify-owner-price] OWNER_PHONE not configured — skipping');
    return { success: false, ownerPhone: null };
  }

  const message =
    `📋 CONSULTA DEL CLIENTE — ${clientName || 'Cliente'} (+${clientPhone})\n\n` +
    `"${question}"\n\n` +
    `Para responder, CITA (desliza a responder) ESTE mensaje y escribe el precio o la información. Así se lo envío al cliente correcto.`;

  const res = await sendMessage(ownerPhone, message);
  // El id del mensaje permite emparejar la respuesta citada de Diego con esta consulta.
  const messageId = res?.messages?.[0]?.id || null;
  console.log(`[notify-owner-price] Sent to ${ownerName} (${ownerPhone}) for client ${clientPhone} (msgId ${messageId})`);

  return { success: true, ownerPhone, messageId };
}

module.exports = { notifyOwnerPrice };
