const { notifyOwner } = require('../../src/owner-notify');

/**
 * Avisa al EQUIPO (la administradora, vía ALERT_PHONE) de una emergencia de un
 * cliente (wincha/grúa/varado). NUNCA le escribe a Diego. Si ALERT_PHONE no está
 * configurada, solo se loguea (la administradora ve el mensaje del cliente igual).
 *
 * @param {object} params
 * @param {string} params.clientName       - nombre del cliente
 * @param {string} params.clientPhone      - teléfono del cliente
 * @param {string} params.emergencyMessage - mensaje original del cliente
 * @returns {object} { success }
 */
async function alertOwner({ clientName, clientPhone, emergencyMessage }) {
  const message =
    `🚨 EMERGENCIA — ${clientName || 'Cliente'} (+${clientPhone})\n\n` +
    `"${emergencyMessage}"\n\n` +
    `Escríbele directo por WhatsApp.`;

  const { sent, reason } = await notifyOwner(message, { key: clientPhone || 'global' });
  console.log(sent
    ? `[alert-owner] aviso enviado para cliente ${clientPhone}`
    : `[alert-owner] aviso NO enviado (${reason}) para cliente ${clientPhone}`);

  return { success: true };
}

module.exports = { alertOwner };
