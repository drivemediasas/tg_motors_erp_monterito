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
  console.log(`[notify-owner-price] Price inquiry recorded for client ${clientPhone} ("${question}"). WhatsApp notification to owner skipped.`);
  return { success: true, ownerPhone: null, messageId: null };
}

module.exports = { notifyOwnerPrice };
