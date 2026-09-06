const d360Service = require('./360dialog-service');

/**
 * Envía un mensaje de texto por WhatsApp. Proveedor: 360dialog (el único activo).
 * NUNCA le envía nada a Diego (OWNER_PHONE) — última línea de defensa.
 *
 * @param {string} to      - teléfono destino (internacional, sin +)
 * @param {string} message - texto
 */
async function sendMessage(to, message) {
  const owner = (process.env.OWNER_PHONE || '').replace(/\D/g, '');
  if (owner && String(to || '').replace(/\D/g, '') === owner) {
    console.warn('[send-message] BLOQUEADO envío a OWNER_PHONE — Diego no recibe nada del bot');
    return null;
  }
  return d360Service.sendMessage(to, message);
}

module.exports = { sendMessage };
