const { takeOverByHuman } = require('../tools/db/conversation-state');

/**
 * Emergency Switch / SAFE MODE.
 * Ante cualquier error (excepción, timeout LLM, fallo BD, estado inconsistente):
 *  1. pasar la conversación a HUMAN (no responder automáticamente),
 *  2. loguear el error (sin secretos),
 *  3. esperar intervención humana.
 * Regla: mejor no responder que responder algo incorrecto.
 *
 * El mensaje entrante YA quedó guardado por el dedup durable; aquí no inventamos respuesta.
 */
async function enterSafeMode(telefono, error, context = {}) {
  const msg = (error && error.message) ? error.message : String(error);
  console.error('[SAFE_MODE]', { telefono, reason: context.reason || 'exception', error: msg });

  try {
    await takeOverByHuman(telefono, 'SYSTEM', 'HUMAN');
  } catch (e) {
    console.error('[SAFE_MODE] no se pudo marcar HUMAN:', e.message);
  }

  console.error('[SAFE_MODE] technical alert suppressed; owner was not notified by WhatsApp');
}

/** Registra un handler global para promesas no capturadas → notifica (sin tumbar el server). */
function installGlobalSafeNet() {
  process.on('unhandledRejection', (reason) => {
    console.error('[SAFE_MODE] unhandledRejection', { error: reason && reason.message ? reason.message : String(reason) });
  });
}

module.exports = { enterSafeMode, installGlobalSafeNet };
