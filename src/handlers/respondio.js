const { processMessage } = require('./message');
const respondioService   = require('../../tools/whatsapp/respondio-service');

/**
 * Extrae tolerantemente { contactId, phone, text, name } de un webhook de
 * respond.io. El esquema exacto del payload no está 100% confirmado (la doc
 * es una SPA que no se pudo inspeccionar por completo) — por eso se prueban
 * varias rutas de campo plausibles y nunca se lanza una excepción.
 */
function parseRespondioPayload(body) {
  body = body || {};

  // Detección de eco/saliente (defensa adicional — el filtro principal es
  // elegir solo el evento "New Incoming Message" en el dashboard de respond.io)
  const eventType = body.event || body.eventType || body.type || '';
  const direction = body.message?.direction || body.direction || '';
  if (
    /outgoing/i.test(String(eventType)) ||
    /outgoing/i.test(String(direction)) ||
    body.message?.message?.isFromContact === false
  ) {
    return { echo: true };
  }

  const contact = body.contact || body.data?.contact || {};
  const contactId = contact.id ?? contact.contactId ?? body.contactId ?? null;
  const rawPhone = contact.phone ?? contact.phoneNumber ?? contact.whatsappId ?? body.phone ?? null;
  const phone = rawPhone ? String(rawPhone).replace(/^\+/, '') : null;
  const name = contact.firstName ?? contact.name ?? contact.fullName ?? null;

  const msg = body.message || body.data?.message || {};
  const text = msg.text ?? msg.message?.text ?? msg.message?.message?.text ?? msg.content ?? null;

  if (!text || (!contactId && !phone)) return null;

  return { contactId, phone, text: String(text), name };
}

async function handleRespondioInbound(body) {
  console.log('[respondio] raw payload:', JSON.stringify(body));

  let parsed;
  try {
    parsed = parseRespondioPayload(body);
  } catch (err) {
    console.error('[respondio] payload parse error:', err.message);
    return;
  }

  if (!parsed) {
    console.log('[respondio] No valid inbound text message found in payload — skipping');
    return;
  }
  if (parsed.echo) {
    console.log('Ignored echo/outgoing message');
    return;
  }

  const { contactId, phone, text, name } = parsed;
  console.log('Incoming respond.io message', { contactId, phone, name });

  const sendTarget = contactId || (phone ? `+${phone}` : null);
  if (!sendTarget) {
    console.error('[respondio] No contactId or phone available — cannot reply, processing skipped');
    return;
  }
  // Las búsquedas en BD están indexadas por `telefono` sin "+". Si el payload
  // no trae phone (solo contactId), se usa contactId como respaldo degradado.
  const dbPhoneKey = phone || String(contactId).replace(/^\+/, '');

  try {
    await processMessage(dbPhoneKey, text, async (replyText) => {
      await respondioService.sendMessage(sendTarget, replyText);
      console.log('Bot response sent via respond.io');
    });
  } catch (err) {
    console.error('Respond.io API error', err.message);
  }
}

module.exports = { handleRespondioInbound, parseRespondioPayload };
