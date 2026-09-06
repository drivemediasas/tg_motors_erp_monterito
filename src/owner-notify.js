const d360Service = require('../tools/whatsapp/360dialog-service');
const { bump } = require('./metrics');

/**
 * Canal ÚNICO para avisar al EQUIPO (la administradora) por WhatsApp de un evento
 * urgente de un cliente (emergencia/wincha). NUNCA le escribe a Diego (OWNER_PHONE).
 * Manda a ALERT_PHONE si está configurada; si no, solo loguea (la administradora ve
 * el mensaje del cliente igual, porque ella atiende el número del taller).
 * Rate-limit + dedup para que un loop de tools no genere una ráfaga.
 *   - misma `key` dentro de OWNER_NOTIFY_COOLDOWN_MS  → se suprime
 *   - texto idéntico dentro de OWNER_NOTIFY_DEDUP_MS  → se suprime
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
  const alertPhone = (process.env.ALERT_PHONE || '').replace(/\D/g, '');

  const { suppress, reason } = registerAndCheck(key, text);
  if (suppress) {
    bump('ownerNotificationsSuppressed');
    console.warn('[owner-notify] suprimido', { key, reason });
    return { sent: false, reason };
  }

  if (!alertPhone) {
    console.warn('[owner-notify] ALERT_PHONE no configurada — solo log:', text.replace(/\n/g, ' ').slice(0, 120));
    return { sent: false, reason: 'no_alert_phone' };
  }

  await d360Service.sendMessage(alertPhone, text);
  bump('ownerNotifications');
  console.log('[owner-notify] aviso enviado a ALERT_PHONE', { key });
  return { sent: true };
}

module.exports = { notifyOwner, registerAndCheck, _resetForTest, COOLDOWN_MS, DEDUP_MS };
