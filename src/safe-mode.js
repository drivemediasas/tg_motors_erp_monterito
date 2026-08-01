const { sendMessage } = require('../tools/whatsapp/send-message');
const { takeOverByHuman } = require('../tools/db/conversation-state');

/**
 * Emergency Switch / SAFE MODE.
 * Ante cualquier error (excepción, timeout LLM, fallo BD, estado inconsistente):
 *  1. pasar la conversación a HUMAN (no responder automáticamente),
 *  2. loguear el error (sin secretos),
 *  3. notificar al admin,
 *  4. esperar intervención humana.
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

  try {
    const ownerPhone = (process.env.OWNER_PHONE || '').trim();
    if (ownerPhone) {
      await sendMessage(
        ownerPhone,
        `⚠️ Error atendiendo a +${telefono}. El bot quedó en pausa (modo humano) para no responder algo incorrecto. Requiere intervención.`
      );
    }
  } catch (e) {
    console.error('[SAFE_MODE] no se pudo notificar al admin:', e.message);
  }
}

/** Registra un handler global para promesas no capturadas → notifica (sin tumbar el server). */
function installGlobalSafeNet() {
  process.on('unhandledRejection', (reason) => {
    console.error('[SAFE_MODE] unhandledRejection', { error: reason && reason.message ? reason.message : String(reason) });
  });
}

module.exports = { enterSafeMode, installGlobalSafeNet };
