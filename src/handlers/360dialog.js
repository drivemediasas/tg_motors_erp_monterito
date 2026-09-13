const { processMessage } = require('./message');
const d360Service = require('../../tools/whatsapp/360dialog-service');
const { getMediaAck } = require('../guards');
const pool = require('../../tools/db/client');
const { markProcessedDurable, fallbackId } = require('../../tools/db/messages-processed');
const { takeOverByHuman } = require('../../tools/db/conversation-state');
const { bump } = require('../metrics');

const normalizePhone = (p) => String(p || '').replace(/\D/g, '');
// Detección de "la administradora respondió al cliente desde la app de WhatsApp"
// (coexistence). ON por defecto: si el equipo responde a un cliente, el bot se
// calla 20 min para ese cliente (HUMAN_TIMEOUT_MIN); cada nueva respuesta humana
// renueva la ventana. Apagable con COEXISTENCE_ECHO_DETECT=off.
//
// Formato real (doc Meta / 360dialog): los mensajes enviados desde la app llegan
// en un webhook aparte, `field: "smb_message_echoes"`, con `value.message_echoes[]`
// ({ from: <taller>, to: <cliente>, id, type, text }). Los envíos por la API del
// bot NO se ecoan ahí; igual se filtran por id (wasSentByBot) y por texto reciente
// (wasTextSentByBot) como doble seguro para que el bot nunca se calle a sí mismo.
const ECHO_DETECT_ON = (process.env.COEXISTENCE_ECHO_DETECT || 'on').toLowerCase() !== 'off';

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
  const change = body.entry?.[0]?.changes?.[0] || {};
  const value = change.value || {};

  // ── Eco de mensaje enviado desde la app de WhatsApp Business (coexistence) ──
  // field = "smb_message_echoes" → value.message_echoes[]. Es la administradora
  // (o alguien del equipo) respondiendo a mano; NO es un cliente escribiendo.
  const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : null;
  if (echoes && echoes.length) {
    const echo = echoes[0];
    const own = normalizePhone(value.metadata?.display_phone_number);
    const from = normalizePhone(echo.from);
    // Si `from` no es el taller (payload inesperado), no asumir nada.
    if (own && from && from !== own) return { ignore: true, reason: 'echo_from_mismatch' };
    return {
      agentOutbound: true,
      source: change.field || 'smb_message_echoes',
      messageId: echo.id || null,
      customer: normalizePhone(echo.to) || null,
      text: echo.text?.body || '',
      textSnippet: (echo.text?.body || '').slice(0, 40),
    };
  }

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

  // ── ¿Es un mensaje SALIENTE del número del taller? (modo coexistence) ─────────
  // En coexistence, 360dialog reenvía al webhook los mensajes que el equipo manda
  // desde la app de WhatsApp. `from` == número propio del taller (metadata.display_phone_number).
  // Ese caso NO es un cliente escribiendo: es la administradora respondiendo a mano.
  const ownNumber = normalizePhone(value.metadata?.display_phone_number);
  if (ownNumber && normalizePhone(phone) === ownNumber) {
    const customer = normalizePhone(
      msg.to || value.contacts?.[0]?.wa_id || value.statuses?.[0]?.recipient_id || ''
    );
    return {
      agentOutbound: true,
      source: 'messages',
      messageId,
      customer: customer || null,
      text: msg.text?.body || '',
      textSnippet: (msg.text?.body || '').slice(0, 40),
    };
  }

  // Mensajes de texto → flujo normal con el LLM
  if (msg.type === 'text' && msg.text?.body) {
    return { phone, type: 'text', text: msg.text.body, name, messageId, quotedId };
  }

  // Otros tipos (audio, imagen, sticker, video, documento...) → acuse sin LLM
  return { phone, type: msg.type || 'unknown', text: null, name, messageId, quotedId };
}

async function handleD360Inbound(body) {
  // Log a concise summary instead of the full payload to avoid PII in logs
  const change    = body?.entry?.[0]?.changes?.[0];
  const msgCount  = change?.value?.messages?.length || 0;
  const statCount = change?.value?.statuses?.length || 0;
  const echoCount = change?.value?.message_echoes?.length || 0;
  console.log('[360dialog] webhook received', { field: change?.field || null, messages: msgCount, statuses: statCount, echoes: echoCount });

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

  // ── Mensaje saliente del número del taller (coexistence) ─────────────────────
  if (parsed.agentOutbound) {
    if (!ECHO_DETECT_ON) { console.log('[360dialog] agentOutbound ignorado (detección off)'); return; }
    // Si lo mandó el bot por la API, es solo el eco de nuestra propia respuesta.
    if (d360Service.wasSentByBot(parsed.messageId) || d360Service.wasTextSentByBot(parsed.text)) {
      bump('botEchoIgnored');
      console.log('[360dialog] eco de mensaje del bot — ignorado', { source: parsed.source });
      return;
    }
    // Lo mandó un humano (la administradora) desde la app → callar al bot para ese cliente.
    if (parsed.customer) {
      try {
        await takeOverByHuman(parsed.customer, 'admin', 'HUMAN');
        bump('humanEchoDetected');
        console.log('[360dialog] respuesta humana detectada → bot en silencio', { customer: parsed.customer, source: parsed.source, minutes: process.env.HUMAN_TIMEOUT_MIN || '20' });
      } catch (e) {
        console.error('[360dialog] no se pudo pasar a HUMAN:', e.message);
      }
    } else {
      console.warn('[360dialog] respuesta humana detectada pero sin número de cliente en el payload', { snippet: parsed.textSnippet });
    }
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
      console.warn('[360dialog] duplicate_webhook_ignored', { messageId, phone, textSnippet: String(text || '').slice(0, 40), viaFallbackId: !parsed.messageId });
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
