/**
 * Conversation Control Layer.
 * `shouldBotRespond(ctx)` es la ÚNICA función que decide si el bot responde.
 * Es PURA (sin DB/red) → testeable. El LLM nunca decide si responder.
 *
 * Decisión ∈ ALLOW_BOT | ALLOW_HUMAN | WAIT | IGNORE | ERROR
 *   ALLOW_BOT   → correr flujo normal y responder
 *   ALLOW_HUMAN → silent mode: guardar/analizar, NO enviar
 *   WAIT        → escalar (enviar UN aviso y pasar a humano)
 *   IGNORE      → duplicado/spam: no procesar, no responder
 *   ERROR       → estado inconsistente → SAFE MODE
 */

const HUMAN_TIMEOUT_MIN = parseInt(process.env.HUMAN_TIMEOUT_MIN || '20', 10);
// Pausa por tema de pago (modo PAUSED): se auto-reactiva pasado este lapso, asumiendo
// que para entonces el equipo ya resolvió el tema. Configurable en Railway.
const PAUSED_TIMEOUT_HOURS = parseInt(process.env.PAUSED_TIMEOUT_HOURS || '48', 10);

/**
 * @param {object} ctx
 * @param {boolean} ctx.safeMode
 * @param {boolean} ctx.isDuplicate
 * @param {boolean} ctx.alreadyAnswered      - messageId == last_answered_message_id
 * @param {boolean} ctx.isSpam               - mismo texto repetido en ventana
 * @param {string}  ctx.ownerType            - 'BOT'|'HUMAN'|'SYSTEM'
 * @param {string}  ctx.conversationMode
 * @param {number|null} ctx.lastHumanActivityMs - epoch ms (o null)
 * @param {number|null} ctx.lastOwnerChangeMs   - epoch ms del último cambio de owner (o null)
 * @param {number}  ctx.nowMs
 * @param {number}  [ctx.humanTimeoutMin]
 * @param {number}  [ctx.pausedTimeoutHours]
 * @param {boolean} [ctx.targetMatches=true] - sanity: destino == teléfono del contexto
 * @returns {{decision:string, reason:string, humanActive:boolean}}
 */
function shouldBotRespond(ctx = {}) {
  const timeoutMin = ctx.humanTimeoutMin != null ? ctx.humanTimeoutMin : HUMAN_TIMEOUT_MIN;

  // Humano activo = owner HUMAN y con actividad dentro de la ventana de timeout.
  const humanActive = ctx.ownerType === 'HUMAN'
    && ctx.lastHumanActivityMs != null
    && (ctx.nowMs - ctx.lastHumanActivityMs) <= timeoutMin * 60 * 1000;

  // 1. SAFE MODE → no responder
  if (ctx.safeMode) return { decision: 'ALLOW_HUMAN', reason: 'safe_mode', humanActive };

  // 2/5. Duplicado / ya respondido → ignorar (anti-loop, anti doble respuesta)
  if (ctx.isDuplicate || ctx.alreadyAnswered) return { decision: 'IGNORE', reason: 'duplicate', humanActive };

  // 3. Spam (mismo texto repetido) → ignorar (responder una sola vez)
  if (ctx.isSpam) return { decision: 'IGNORE', reason: 'spam', humanActive };

  // 3b. Pausa por tema de pago (PAUSED): silencio hasta que el asesor haga #bot <tel>,
  // o hasta que pase PAUSED_TIMEOUT_HOURS (auto-reactivación en el siguiente mensaje del
  // cliente: para entonces el tema ya se resolvió y puede volver a consultar normal).
  if (ctx.conversationMode === 'PAUSED') {
    const pausedTimeoutMs = (ctx.pausedTimeoutHours != null ? ctx.pausedTimeoutHours : PAUSED_TIMEOUT_HOURS) * 60 * 60 * 1000;
    const stillPaused = ctx.lastOwnerChangeMs == null
      || (ctx.nowMs - ctx.lastOwnerChangeMs) <= pausedTimeoutMs;
    if (stillPaused) return { decision: 'ALLOW_HUMAN', reason: 'paused', humanActive };
    // Expiró la pausa → cae a la lógica normal; message.js persiste owner=BOT.
  }

  // 4/6. Humano atendiendo → silent (guardar/analizar, no enviar)
  if (humanActive) return { decision: 'ALLOW_HUMAN', reason: 'human_owner', humanActive };

  // 8. Sanity: destino debe ser el del contexto
  if (ctx.targetMatches === false) return { decision: 'ERROR', reason: 'target_mismatch', humanActive };

  // 9. Por defecto → el bot responde
  return { decision: 'ALLOW_BOT', reason: 'ok', humanActive };
}

/** Comandos del asesor (desde OWNER_PHONE): #humano/#bot/#proveedor/#cliente <tel>. */
function parseAdvisorCommand(text) {
  const t = (text || '').trim();
  let m = t.match(/^#?\s*humano\b[\s:]*([0-9+\s]{6,})?/i) || (/tomar (conversaci[oó]n|chat)/i.test(t) ? [t, null] : null);
  if (m) return { cmd: 'take', target: (m[1] || '').replace(/\D/g, '') || null };
  m = t.match(/^#?\s*bot\b[\s:]*([0-9+\s]{6,})?/i) || (/volver al bot/i.test(t) ? [t, null] : null);
  if (m) return { cmd: 'release', target: (m[1] || '').replace(/\D/g, '') || null };
  m = t.match(/^#?\s*proveedor\b[\s:]*([0-9+\s]{6,})?/i);
  if (m) return { cmd: 'mark_provider', target: (m[1] || '').replace(/\D/g, '') || null };
  m = t.match(/^#?\s*cliente\b[\s:]*([0-9+\s]{6,})?/i);
  if (m) return { cmd: 'unmark_provider', target: (m[1] || '').replace(/\D/g, '') || null };
  return null;
}

module.exports = { shouldBotRespond, parseAdvisorCommand, HUMAN_TIMEOUT_MIN, PAUSED_TIMEOUT_HOURS };
