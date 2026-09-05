const { notifyOwner } = require('../../src/owner-notify');

/**
 * Send an emergency alert to the shop owner's personal WhatsApp number.
 *
 * @param {object} params
 * @param {string} params.clientName       - Customer name
 * @param {string} params.clientPhone      - Customer phone number
 * @param {string} params.emergencyMessage - Original message from customer
 * @returns {object} { success, ownerPhone }
 */
async function alertOwner({ clientName, clientPhone, emergencyMessage }) {
  const ownerPhone = (process.env.OWNER_PHONE || '').trim();
  const ownerName  = (process.env.OWNER_NAME  || 'Equipo').trim();

  if (!ownerPhone) {
    console.warn('[alert-owner] OWNER_PHONE not configured — skipping alert');
    return { success: false, ownerPhone: null };
  }

  const message =
    `🚨 EMERGENCIA — ${clientName} (+${clientPhone})\n\n` +
    `"${emergencyMessage}"\n\n` +
    `Responde a este número directamente por WhatsApp.`;

  const { sent, reason } = await notifyOwner(message, { key: clientPhone || 'global' });
  if (sent) {
    console.log(`[alert-owner] Alert sent to ${ownerName} (${ownerPhone}) for client ${clientPhone}`);
  } else {
    console.warn(`[alert-owner] Alert suppressed (${reason}) for client ${clientPhone}`);
  }

  return { success: true, ownerPhone };
}

module.exports = { alertOwner };
