const { processMessage } = require('./message');
const d360Service = require('../../tools/whatsapp/360dialog-service');
const { getMediaAck } = require('../guards');
const pool = require('../../tools/db/client');
const { markProcessedDurable, fallbackId } = require('../../tools/db/messages-processed');

// In-memory dedup cache: prevents double-processing if 360dialog sends the same
// messageId twice (edge case during network retries). Capped at 2000 entries to
// avoid unbounded growth — oldest entry evicted when limit is reached.
const _processedIds = new Set();
const DEDUP_MAX = 2000;

function markProcessed(messageId) {
  if (!messageId) return false;
  if (_processedIds.has(messageId)) return true; // already seen
  _processedIds.add(messageId);
  if (_processedIds.size > DEDUP_MAX) {
    _processedIds.delete(_processedIds.values().next().value);
  }
  return false;
}

/**
 * Extrae { phone, text, name, messageId } del webhook de 360dialog/WhatsApp
 * Cloud API. Ignora eventos de status/delivery receipts y mensajes sin texto
 * (mismo shape estándar de Meta Cloud API: entry[0].changes[0].value).
 */
function parseD360Payload(body) {
  body = body || {};
  const value = body.entry?.[0]?.changes?.[0]?.value || {};

  // Statuses/delivery receipts no traen "messages" — son eventos salientes, se ignoran
  if (!value.messages || !value.messages.length) {
    return { ignore: true };
  }

  const msg = value.messages[0];
  const phone = msg.from;
  const messageId = msg.id || null;
  // Si el usuario citó/deslizó a responder, WhatsApp incluye el id del mensaje citado.
  const quotedId = msg.context?.id || null;
  const contacts = value.contacts || [];
  const contact = contacts.find((c) => c.wa_id === phone) || contacts[0] || {};
  const name = contact.profile?.name || null;

  if (!phone) return { ignore: true };

  // Mensajes de texto → flujo normal con el LLM
  if (msg.type === 'text' && msg.text?.body) {
    return { phone, type: 'text', text: msg.text.body, name, messageId, quotedId };
  }

  // Otros tipos (audio, imagen, sticker, video, documento...) → acuse sin LLM
  return { phone, type: msg.type || 'unknown', text: null, name, messageId, quotedId };
}

async function handleD360Inbound(body) {
  // Log a concise summary instead of the full payload to avoid PII in logs
  const msgCount  = body?.entry?.[0]?.changes?.[0]?.value?.messages?.length || 0;
  const statCount = body?.entry?.[0]?.changes?.[0]?.value?.statuses?.length || 0;
  console.log('[360dialog] webhook received', { messages: msgCount, statuses: statCount });

  let parsed;
  try {
    parsed = parseD360Payload(body);
  } catch (err) {
    console.error('[360dialog] payload parse error:', err.message);
    return;
  }

  if (!parsed || parsed.ignore) {
    console.log('[360dialog] ignored status/outgoing event');
    return;
  }

  const { phone, type, text, name, quotedId } = parsed;
  const messageId = parsed.messageId || fallbackId(phone, text);

  // Dedup en memoria (caché rápida) — descarta retries inmediatos
  if (markProcessed(messageId)) {
    console.warn('[360dialog] duplicate (mem) — skipping', { messageId, phone });
    return;
  }
  // Dedup DURABLE (fuente de verdad = PostgreSQL) — sobrevive reinicios
  try {
    const { duplicate } = await markProcessedDurable(pool, { messageId, telefono: phone, provider: '360dialog' });
    if (duplicate) {
      console.warn('[360dialog] duplicate_webhook_ignored', { messageId, phone });
      return;
    }
  } catch (e) {
    console.error('[360dialog] dedup durable error (continúa):', e.message);
  }

  // Non-text messages (audio, image, sticker...) → fixed acknowledgment, no LLM
  if (type !== 'text') {
    console.log('[360dialog] media ack', { type, phone, messageId });
    try {
      await d360Service.sendMessage(phone, getMediaAck(type));
    } catch (err) {
      console.error('[360dialog] media ack error:', err.message);
    }
    return;
  }

  console.log('[360dialog] incoming message', { phone, name, messageId });

  try {
    await processMessage(phone, text, async (replyText) => {
      await d360Service.sendMessage(phone, replyText);
      console.log('[360dialog] bot response sent', { to: phone });
    }, { quotedId, messageId });
  } catch (err) {
    console.error('[360dialog] processing error:', err.message);
  }
}

module.exports = { handleD360Inbound, parseD360Payload };
