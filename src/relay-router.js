/**
 * Decisión PURA de a qué consulta pertenece la respuesta de Diego.
 * Sin DB, sin red → testeable directamente.
 *
 * Reglas (determinísticas, nunca adivinar):
 *   - Diego citó una consulta pendiente  → enviar a ESA.
 *   - No citó y hay exactamente 1 pendiente → enviar a esa.
 *   - No citó y hay >1 pendiente           → rechazar (pedir que cite).
 *   - No hay pendientes                    → no es un relay.
 *
 * @param {object} p
 * @param {object|null} p.quotedInquiry     - inquiry resuelta por el mensaje citado (o null)
 * @param {Array}       p.pendingInquiries  - consultas pendientes (<48h)
 * @returns {{action:'send'|'reject_ambiguous'|'no_relay', inquiry?:object, routedBy:string}}
 */
function decideRelayTarget({ quotedInquiry = null, pendingInquiries = [] } = {}) {
  if (quotedInquiry) {
    return { action: 'send', inquiry: quotedInquiry, routedBy: 'quoted_message_id' };
  }
  const pend = Array.isArray(pendingInquiries) ? pendingInquiries : [];
  if (pend.length === 1) {
    return { action: 'send', inquiry: pend[0], routedBy: 'single_pending' };
  }
  if (pend.length > 1) {
    return { action: 'reject_ambiguous', routedBy: 'rejected_ambiguous' };
  }
  return { action: 'no_relay', routedBy: 'no_pending' };
}

module.exports = { decideRelayTarget };
