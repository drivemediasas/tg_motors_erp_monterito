/**
 * Envía una plantilla aprobada de WhatsApp (360dialog). El guard de OWNER_PHONE
 * vive en 360dialog-service.sendTemplate.
 *
 * @param {string} to           - teléfono destino (internacional, sin +)
 * @param {string} templateName - nombre de la plantilla aprobada
 * @param {Array}  params        - valores para los placeholders del body
 */
async function sendTemplate(to, templateName, params = []) {
  return require('./360dialog-service').sendTemplate(to, templateName, params);
}

module.exports = { sendTemplate };
