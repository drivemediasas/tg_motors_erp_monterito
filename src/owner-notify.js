const { sendMessage } = require('../tools/whatsapp/send-message');
const { bump } = require('./metrics');

/**
 * Canal ÚNICO para mandarle WhatsApp al dueño del taller.
 * Rate-limit + dedup en memoria para que un loop de tools o repeticiones del
 * cliente no generen una ráfaga de mensajes al número personal del dueño
 * (eso además degrada el quality rating del número en Meta).
 *
 *   - misma `key` dentro de OWNER_NOTIFY_COOLDOWN_MS      → se suprime
 *   - texto idéntico dentro de OWNER_NOTIFY_DEDUP_MS      → se suprime
 */

const COOLDOWN_MS = parseInt(process.env.OWNER_NOTIFY_COOLDOWN_MS || '600000', 10); // 10 min
const DEDUP_MS    = parseInt(process.env.OWNER_NOTIFY_DEDUP_MS    || '3600000', 10); // 60 min

const _lastByKey  = new Map(); // key  → ts
const _lastByText = new Map(); // text → ts

function _prune(now) {
  for (const [k, ts] of _lastByKey)  if (now - ts > COOLDOWN_MS) _lastByKey.delete(k);
  for (const [t, ts] of _lastByText) if (now - ts > DEDUP_MS)    _lastByText.delete(t);
}

/**
 * Decisión pura: ¿hay que suprimir este envío? Registra el envío si NO se suprime.
 * Testeable con un reloj inyectado.
 * @returns {{ suppress: boolean, reason?: string }}
 */
function registerAndCheck(key, text, now = Date.now()) {
  _prune(now);
  const keyTs  = _lastByKey.get(key);
  const textTs = _lastByText.get(text);
  if (keyTs != null && now - keyTs < COOLDOWN_MS)  return { suppress: true, reason: 'cooldown_key' };
  if (textTs != null && now - textTs < DEDUP_MS)   return { suppress: true, reason: 'dedup_text' };
  _lastByKey.set(key, now);
  _lastByText.set(text, now);
  return { suppress: false };
}

/** Solo para tests. */
function _resetForTest() { _lastByKey.clear(); _lastByText.clear(); }

/**
 * @param {string} text
 * @param {object} opts
 * @param {string} opts.key - agrupador (normalmente el teléfono del cliente que originó el evento)
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function notifyOwner(text, { key = 'global' } = {}) {
  const ownerPhone = (process.env.OWNER_PHONE || '').trim();
  if (!ownerPhone) {
    console.warn('[owner-notify] OWNER_PHONE no configurado — se omite');
    return { sent: false, reason: 'no_owner_phone' };
  }

  const { suppress, reason } = registerAndCheck(key, text);
  if (suppress) {
    bump('ownerNotificationsSuppressed');
    console.warn('[owner-notify] suprimido', { key, reason });
    return { sent: false, reason };
  }

  await sendMessage(ownerPhone, text, { ownerAlert: true });
  bump('ownerNotifications');
  console.log('[owner-notify] enviado al dueño', { key });
  return { sent: true };
}

module.exports = { notifyOwner, registerAndCheck, _resetForTest, COOLDOWN_MS, DEDUP_MS };
