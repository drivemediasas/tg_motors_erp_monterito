/**
 * Contadores en memoria para observabilidad (se exponen en /health).
 * No persisten: se reinician con el proceso. Sirven para detectar en vivo
 * loops de tools, timeouts y supresiones de alertas al dueño.
 */

const _startedAt = new Date().toISOString();

const _counters = {
  loopCapHits: 0,
  ownerNotifications: 0,
  ownerNotificationsSuppressed: 0,
  groqTimeouts: 0,
  groqFallbackUsed: 0,
  outboundRetries: 0,
  turnTimeouts: 0,
};

function bump(name, n = 1) {
  if (name in _counters) _counters[name] += n;
}

function getMetrics() {
  return { metrics: { ..._counters, since: _startedAt } };
}

module.exports = { bump, getMetrics };
