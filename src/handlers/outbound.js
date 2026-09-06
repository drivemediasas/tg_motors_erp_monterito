const { getAppointmentsNeedingReminder, getAppointmentsNeedingSurvey, updateAppointment } = require('../../tools/db/update-appointment');
const { getMaintenanceDue, markMaintenanceReminded } = require('../../tools/db/get-maintenance-due');
const { sendMessage }  = require('../../tools/whatsapp/send-message');
const { sendTemplate } = require('../../tools/whatsapp/send-template');
const { getHistory }   = require('../../tools/db/get-history');
const { appendMessage } = require('../../tools/db/append-message');
const { getConversationState } = require('../../tools/db/conversation-state');
const { getClient } = require('../../tools/db/get-client');

const shopName = process.env.SHOP_NAME || 'TG Motors';
const googleReviewUrl = process.env.GOOGLE_REVIEW_URL || '';

const _digits = (p) => String(p || '').replace(/\D/g, '');
const _BUSY_MODES = new Set(['PAUSED', 'HUMAN', 'WAITING_HUMAN', 'WAITING_PRICE', 'CLOSED']);

/**
 * ¿Está bien mandarle un mensaje proactivo (recordatorio/encuesta) a este número?
 * NO si: es Diego, es un proveedor, o un humano está atendiendo esa conversación.
 */
async function canMessageProactively(telefono) {
  if (_digits(process.env.OWNER_PHONE) && _digits(telefono) === _digits(process.env.OWNER_PHONE)) {
    return { ok: false, why: 'owner_phone' };
  }
  try {
    const st = await getConversationState(telefono);
    if (st.owner_type !== 'BOT' || _BUSY_MODES.has(st.conversation_mode)) {
      return { ok: false, why: `estado ${st.owner_type}/${st.conversation_mode}` };
    }
  } catch (e) { /* si no hay estado, asumimos BOT */ }
  try {
    const c = await getClient(telefono);
    if (c && c.es_proveedor) return { ok: false, why: 'proveedor' };
  } catch (e) { /* ignore */ }
  return { ok: true };
}

/**
 * Job 1: Send appointment reminders ~2h before the appointment time.
 * Runs every 15 min. Checks for appointments entering the ≤2h window with no
 * reminder sent yet (see getAppointmentsNeedingReminder for the timezone logic).
 */
async function sendReminders() {
  const appointments = await getAppointmentsNeedingReminder();
  console.log(`[reminders] Found ${appointments.length} appointment(s) needing reminder`);

  for (const apt of appointments) {
    try {
      const gate = await canMessageProactively(apt.telefono);
      if (!gate.ok) { console.log(`[reminders] skip ${apt.telefono} (${gate.why})`); continue; }
      // Use a template if configured, else fall back to free text
      const useTemplate = process.env.REMINDER_TEMPLATE_NAME;

      if (useTemplate) {
        await sendTemplate(apt.telefono, useTemplate, [
          apt.nombreCliente,
          apt.servicio,
          apt.fecha,
          apt.hora,
          shopName,
        ]);
      } else {
        const msg = `Hola ${apt.nombreCliente} 👋 Te recordamos tu cita de hoy en ${shopName}:\n\n🔧 Servicio: ${apt.servicio}\n🕐 Hora: ${apt.hora}\n\n¡Te esperamos!`;
        await sendMessage(apt.telefono, msg);
      }

      await updateAppointment(apt.id, { Seguimiento: 'reminder_sent' });
      console.log(`[reminders] Sent to ${apt.telefono}`);
    } catch (err) {
      console.error(`[reminders] Failed for ${apt.telefono}:`, err.message);
    }
  }
}

/**
 * Job 2: Send post-service satisfaction surveys.
 * Runs daily at 18:00. Checks for completed appointments with no survey sent.
 */
async function sendSurveys() {
  const appointments = await getAppointmentsNeedingSurvey();
  console.log(`[surveys] Found ${appointments.length} appointment(s) needing survey`);

  for (const apt of appointments) {
    try {
      const gate = await canMessageProactively(apt.telefono);
      if (!gate.ok) { console.log(`[surveys] skip ${apt.telefono} (${gate.why})`); continue; }
      const msg = `Hola ${apt.nombreCliente} 😊 Gracias por confiar en ${shopName}.\n\n¿Cómo calificarías tu experiencia de hoy?\n\n⭐ 1 - Malo\n⭐⭐ 2 - Regular\n⭐⭐⭐ 3 - Bueno\n⭐⭐⭐⭐ 4 - Muy bueno\n⭐⭐⭐⭐⭐ 5 - Excelente\n\nResponde con el número de estrellas.`;
      await sendMessage(apt.telefono, msg);
      await updateAppointment(apt.id, { Seguimiento: 'survey_sent' });
      // Guardar la pregunta en el historial (usando el recordId existente para NO
      // pisar el historial) → si el cliente responde texto libre, el LLM tiene contexto.
      try {
        const h = await getHistory(apt.telefono);
        await appendMessage({ telefono: apt.telefono, paso: h?.paso || 'activo',
          servicioElegido: h?.servicioElegido || null,
          newMessages: [{ role: 'assistant', content: msg }],
          existingRecordId: h?.recordId || null });
      } catch (e) { console.warn('[surveys] no se pudo guardar en historial:', e.message); }
      console.log(`[surveys] Sent to ${apt.telefono}`);
    } catch (err) {
      console.error(`[surveys] Failed for ${apt.telefono}:`, err.message);
    }
  }
}

/**
 * Job 3: Send maintenance reminders (4-month follow-up).
 * Runs daily at 09:00.
 */
async function sendMaintenanceReminders() {
  const clients = await getMaintenanceDue();
  console.log(`[maintenance] Found ${clients.length} client(s) due for maintenance`);

  for (const c of clients) {
    try {
      const gate = await canMessageProactively(c.telefono);
      if (!gate.ok) { console.log(`[maintenance] skip ${c.telefono} (${gate.why})`); continue; }
      const vehicle = [c.marca, c.modelo].filter(Boolean).join(' ');
      const msg = `Hola ${c.nombre} 🚗 Han pasado aproximadamente 4 meses desde tu último servicio${vehicle ? ` de tu ${vehicle}` : ''}.\n\nEn ${shopName} te recomendamos una revisión preventiva para mantener tu vehículo en óptimas condiciones.\n\n¿Te gustaría agendar una cita? Escríbenos y te ayudamos 😊`;
      await sendMessage(c.telefono, msg);
      await markMaintenanceReminded(c.id);
      console.log(`[maintenance] Sent to ${c.telefono}`);
    } catch (err) {
      console.error(`[maintenance] Failed for ${c.telefono}:`, err.message);
    }
  }
}

/**
 * Job 4 (inline): After a survey response of 4-5 stars, send Google Review request.
 * Called from the inbound message handler when a survey reply is detected.
 */
async function sendReviewRequest(telefono, nombre) {
  if (!googleReviewUrl) {
    console.warn('[review] GOOGLE_REVIEW_URL not set — skipping review request');
    return;
  }
  const msg = `¡Qué alegría saber que tuviste una buena experiencia, ${nombre}! 🙌\n\nSi tienes un momento, nos ayudaría mucho que dejes una reseña en Google. Solo toma 1 minuto:\n${googleReviewUrl}\n\n¡Gracias de corazón! 🙏`;
  await sendMessage(telefono, msg);
}

module.exports = { sendReminders, sendSurveys, sendMaintenanceReminders, sendReviewRequest, canMessageProactively };
