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

/**
 * Red de seguridad global: loguea errores no capturados SIN tumbar el proceso.
 * Un webhook debe seguir vivo aunque un turno individual falle feo.
 */
function installGlobalSafeNet() {
  process.on('unhandledRejection', (reason) => {
    console.error('[SAFE_MODE] unhandledRejection', { error: reason && reason.message ? reason.message : String(reason) });
  });
  process.on('uncaughtException', (err) => {
    console.error('[SAFE_MODE] uncaughtException', { error: err && err.message ? err.message : String(err) });
  });
}

module.exports = { enterSafeMode, installGlobalSafeNet };
