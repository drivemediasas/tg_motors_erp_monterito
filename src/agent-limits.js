/**
 * Límites del loop agéntico (LLM ↔ herramientas).
 * Puro y sin dependencias → testeable directo.
 *
 * Problema que resuelve: modelos pequeños (Kimi/Groq) a veces re-emiten la misma
 * tool call en cada vuelta. Sin tope, `alert_owner` / `responder_consulta_precio`
 * mandan un WhatsApp por iteración (spam al dueño / al cliente) y agotan la cuota.
 */

const MAX_TOOL_ITERATIONS = 2;

// Herramientas con efecto colateral externo (mandan mensajes, escriben BD de forma
// visible, cambian ownership). Solo pueden ejecutarse UNA vez por turno.
const SIDE_EFFECT_TOOLS = new Set([
  'alert_owner',
  'book_appointment',
  'cancel_appointment',
  'save_client_info',
  'responder_consulta_precio',
]);

const REPEATED_TOOL_RESULT =
  'Esta acción ya se ejecutó en este turno. No la repitas; responde al cliente con lo que ya tienes.';

/**
 * Separa los bloques tool_use en los que se pueden ejecutar y los que hay que
 * bloquear por ser un side-effect repetido en el mismo turno.
 *
 * @param {Array<{id:string,name:string,input:object}>} toolUseBlocks
 * @param {Set<string>} ranSet - nombres de side-effect tools ya ejecutadas este turno
 * @returns {{ toRun: Array, blocked: Array<{tool_use_id:string, content:string}> }}
 */
function filterRepeatedSideEffects(toolUseBlocks, ranSet) {
  const toRun = [];
  const blocked = [];
  for (const block of toolUseBlocks || []) {
    if (SIDE_EFFECT_TOOLS.has(block.name) && ranSet.has(block.name)) {
      blocked.push({ tool_use_id: block.id, content: REPEATED_TOOL_RESULT });
    } else {
      toRun.push(block);
    }
  }
  return { toRun, blocked };
}

module.exports = {
  MAX_TOOL_ITERATIONS,
  SIDE_EFFECT_TOOLS,
  REPEATED_TOOL_RESULT,
  filterRepeatedSideEffects,
};
