const { processMessage } = require('./message');
const respondioService   = require('../../tools/whatsapp/respondio-service');
const { markProcessedDurable, fallbackId } = require('../../tools/db/messages-processed');
const pool = require('../../tools/db/client');

const _processedIds = new Set();
const DEDUP_MAX = 2000;

function markProcessed(messageId) {
  if (!messageId) return false;
  if (_processedIds.has(messageId)) return true;
  _processedIds.add(messageId);
  if (_processedIds.size > DEDUP_MAX) _processedIds.delete(_processedIds.values().next().value);
  return false;
}

function parseRespondioPayload(body) {
  body = body || {};

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
  const messageId = msg.id ?? msg.messageId ?? null;

  if (!text || (!contactId && !phone)) return null;

  return { contactId, phone, text: String(text), name, messageId };
}

async function handleRespondioInbound(body) {
  console.log('[respondio] webhook received');

  let parsed;
  try {
    parsed = parseRespondioPayload(body);
  } catch (err) {
    console.error('[respondio] payload parse error:', err.message);
    return;
  }

  if (!parsed) {
    console.log('[respondio] No valid inbound text message — skipping');
    return;
  }
  if (parsed.echo) {
    console.log('[respondio] Ignored echo/outgoing message');
    return;
  }

  const { contactId, phone, text, name } = parsed;
  const dbPhoneKey = phone || String(contactId).replace(/^\+/, '');
  const messageId = parsed.messageId || fallbackId(dbPhoneKey, text);

  if (markProcessed(messageId)) {
    console.warn('[respondio] duplicate (mem) — skipping', { messageId });
    return;
  }
  try {
    const { duplicate } = await markProcessedDurable(pool, { messageId, telefono: dbPhoneKey, provider: 'respondio' });
    if (duplicate) {
      console.warn('[respondio] duplicate (durable) — skipping', { messageId });
      return;
    }
  } catch (e) {
    console.error('[respondio] dedup durable error (continúa):', e.message);
  }

  const sendTarget = contactId || (phone ? `+${phone}` : null);
  if (!sendTarget) {
    console.error('[respondio] No contactId or phone — cannot reply');
    return;
  }

  console.log('[respondio] incoming message', { phone: dbPhoneKey, name, messageId });

  try {
    await processMessage(dbPhoneKey, text, async (replyText) => {
      await respondioService.sendMessage(sendTarget, replyText);
      console.log('[respondio] bot response sent');
    }, { messageId });
  } catch (err) {
    console.error('[respondio] processing error:', err.message);
  }
}

module.exports = { handleRespondioInbound, parseRespondioPayload };
