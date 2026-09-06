const { sendMessage } = require('../tools/whatsapp/send-message');
const { bump } = require('./metrics');

const COOLDOWN_MS = parseInt(process.env.OWNER_NOTIFY_COOLDOWN_MS || '1800000', 10); // 30 min
const DEDUP_MS    = parseInt(process.env.OWNER_NOTIFY_DEDUP_MS    || '14400000', 10); // 4 hours
const DAILY_CAP   = parseInt(process.env.OWNER_NOTIFY_DAILY_CAP   || '3', 10);

const _lastByKey  = new Map();
const _lastByText = new Map();

let _dailyCount = 0;
let _dailyReset = _nextMidnightEcuador();

function _nextMidnightEcuador() {
  const now = new Date();
  const utc5 = new Date(now.getTime() - 5 * 3600000);
  const tomorrow = new Date(utc5);
  tomorrow.setUTCHours(24, 0, 0, 0);
  return tomorrow.getTime() + 5 * 3600000;
}

function _prune(now) {
  for (const [k, ts] of _lastByKey)  if (now - ts > COOLDOWN_MS) _lastByKey.delete(k);
  for (const [t, ts] of _lastByText) if (now - ts > DEDUP_MS)    _lastByText.delete(t);
}

function registerAndCheck(key, text, now = Date.now()) {
  if (now >= _dailyReset) { _dailyCount = 0; _dailyReset = _nextMidnightEcuador(); }
  if (_dailyCount >= DAILY_CAP) return { suppress: true, reason: 'daily_cap' };

  _prune(now);
  const keyTs  = _lastByKey.get(key);
  const textTs = _lastByText.get(text);
  if (keyTs != null && now - keyTs < COOLDOWN_MS)  return { suppress: true, reason: 'cooldown_key' };
  if (textTs != null && now - textTs < DEDUP_MS)   return { suppress: true, reason: 'dedup_text' };
  _lastByKey.set(key, now);
  _lastByText.set(text, now);
  _dailyCount++;
  return { suppress: false };
}

function _resetForTest() { _lastByKey.clear(); _lastByText.clear(); _dailyCount = 0; }

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

module.exports = { notifyOwner, registerAndCheck, _resetForTest, COOLDOWN_MS, DEDUP_MS, DAILY_CAP };
