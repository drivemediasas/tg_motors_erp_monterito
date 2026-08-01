const pool = require('./client');

/**
 * Estado de control de la conversación (ownership + modo) por teléfono.
 * Vive en la tabla `conversaciones` (una fila por wa_id). NUNCA mezcla usuarios.
 */

const OWNER_TYPES = ['BOT', 'HUMAN', 'SYSTEM'];
const MODES = ['BOT', 'HUMAN', 'PAUSED', 'WAITING_PRICE', 'WAITING_APPROVAL', 'WAITING_APPOINTMENT', 'WAITING_HUMAN', 'CLOSED'];

/**
 * Devuelve el estado de control del teléfono (o defaults BOT si no existe fila).
 */
async function getConversationState(telefono) {
  const { rows } = await pool.query(
    `SELECT owner_type, owner_id, conversation_mode, intencion,
            last_owner_change, last_human_activity, last_bot_activity,
            last_answered_message_id
       FROM conversaciones WHERE telefono = $1 LIMIT 1`,
    [telefono]
  );
  if (!rows.length) {
    return { owner_type: 'BOT', owner_id: null, conversation_mode: 'BOT', intencion: null,
      last_owner_change: null, last_human_activity: null, last_bot_activity: null,
      last_answered_message_id: null };
  }
  return rows[0];
}

/**
 * Upsert parcial del estado de control (solo escribe lo que se pasa).
 * Crea la fila de conversaciones si no existe.
 */
async function setConversationState(telefono, patch = {}) {
  const cols = { owner_type: null, owner_id: null, conversation_mode: null, intencion: null,
    last_owner_change: null, last_human_activity: null, last_bot_activity: null,
    last_answered_message_id: null };
  const allowed = Object.keys(cols).filter(k => patch[k] !== undefined);
  if (!allowed.length) return;

  // Asegurar fila (sin pisar historial)
  await pool.query(
    `INSERT INTO conversaciones (telefono) VALUES ($1)
     ON CONFLICT (telefono) DO NOTHING`,
    [telefono]
  );

  const sets = allowed.map((k, i) => `${k} = $${i + 2}`);
  sets.push('updated_at = NOW()');
  await pool.query(
    `UPDATE conversaciones SET ${sets.join(', ')} WHERE telefono = $1`,
    [telefono, ...allowed.map(k => patch[k])]
  );
}

/** Marca actividad del bot (timestamp + último messageId respondido). */
async function markBotActivity(telefono, answeredMessageId) {
  await setConversationState(telefono, {
    last_bot_activity: new Date().toISOString(),
    ...(answeredMessageId ? { last_answered_message_id: answeredMessageId } : {}),
  });
}

/** Toma la conversación para un humano (owner=HUMAN). */
async function takeOverByHuman(telefono, ownerId, mode = 'HUMAN') {
  await setConversationState(telefono, {
    owner_type: 'HUMAN', owner_id: ownerId || null, conversation_mode: mode,
    last_owner_change: new Date().toISOString(), last_human_activity: new Date().toISOString(),
  });
}

/** Devuelve la conversación al bot (owner=BOT). */
async function releaseToBot(telefono, mode = 'BOT') {
  await setConversationState(telefono, {
    owner_type: 'BOT', owner_id: null, conversation_mode: mode,
    last_owner_change: new Date().toISOString(),
  });
}

module.exports = {
  OWNER_TYPES, MODES,
  getConversationState, setConversationState,
  markBotActivity, takeOverByHuman, releaseToBot,
};
