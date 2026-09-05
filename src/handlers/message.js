const { getClient }       = require('../../tools/db/get-client');
const { createClient }    = require('../../tools/db/create-client');
const { getHistory }      = require('../../tools/db/get-history');
const { appendMessage }   = require('../../tools/db/append-message');
const { runTurn }         = require('../conversation');
const { runAdminTurn }    = require('../conversation-admin');
const { sendMessage }     = require('../../tools/whatsapp/send-message');
const { updateAppointment } = require('../../tools/db/update-appointment');
const {
  getInquiryByNotifyMsgId,
  getPendingPriceInquiries,
  answerPriceInquiryById,
} = require('../../tools/db/price-inquiries');
const { decideRelayTarget } = require('../relay-router');
const { parseSurveyRating } = require('../survey');
const { sendReviewRequest } = require('./outbound');
const { withLock }        = require('../../tools/lock');
const { shouldBotRespond, parseAdvisorCommand } = require('../control');
const { getConversationState, setConversationState, markBotActivity, takeOverByHuman, releaseToBot } = require('../../tools/db/conversation-state');
const { setProvider }     = require('../../tools/db/mark-provider');
const { enterSafeMode }   = require('../safe-mode');
const pool                = require('../../tools/db/client');
const {
  checkGuards,
  getStaticResponse,
  isRepeatedMessage,
  recordTokenUsage,
  logBlock,
} = require('../guards');
const { getPrecioEstandar } = require('../../tools/db/precios-estandar');
const { createAppointment } = require('../../tools/db/create-appointment');
const { getServiceDuration } = require('../../tools/db/service-durations');

function isLLMTransientError(err) {
  const msg = String(err?.message || err || '');
  return /quota exceeded|resource_exhausted|429|rate limits|free_tier_requests|Groq API error|fetch failed|ECONNRESET|ETIMEDOUT|ENOTFOUND|timeout/i.test(msg);
}

function buildMainMenu(name = 'hola') {
  const shopName = process.env.SHOP_NAME || 'TG Motors';
  const shopHours = process.env.SHOP_HOURS || 'Lunes a Viernes 8:30-17:30, Sábados 9:00-16:00';
  return (
    `Hola ${name} 👋 Soy Monterito, asistente de ${shopName}.\n\n` +
    `Puedo ayudarte con:\n` +
    `1) Horario\n` +
    `2) Dirección\n` +
    `3) Servicios\n` +
    `4) Precio de un servicio\n` +
    `5) Agendar una cita\n\n` +
    `Responde con el número o con tu pregunta directa.\n\n` +
    `Horario: ${shopHours}`
  );
}

function resolveContextualReply(text, clientName = 'hola') {
  const cached = getStaticResponse(text);
  if (cached) return cached;

  const norm = normalizeTextForMatch(text);
  if (/^5$/.test(norm) || /\b(agendar|cita|reservar|turno|agenda)\b/.test(norm)) {
    return 'Perfecto, te ayudo a agendar. Envíame por favor el servicio que necesitas, la fecha preferida y la hora aproximada.';
  }
  if (/^4$/.test(norm) || /\b(precio|cuanto|cuesta|cobran|valor)\b/.test(norm)) {
    return 'Para darte el precio exacto necesito revisar tu vehículo o el servicio específico. Envíame marca, modelo y año, y te ayudo enseguida.';
  }
  if (/\b(hola|buenas|buenos dias|buenas tardes|buenas noches)\b/.test(norm)) {
    return buildMainMenu(clientName.split(' ')[0]);
  }
  return `${buildMainMenu(clientName.split(' ')[0])}\n\nPara avanzar rápido, también puedes escribir algo como: cambio de aceite el lunes a las 9am.`;
}

function makeFallbackReply(text) {
  return resolveContextualReply(text, 'hola');
}

function isWeakGenericReply(reply) {
  const norm = normalizeTextForMatch(reply);
  return (
    /\bte leo\b/.test(norm) ||
    /\bcuentame que necesita tu vehiculo\b/.test(norm) ||
    /\bque te gustaria agendar\b/.test(norm)
  );
}

function parsePayload(body) {
  if (body.waId || body.whatsappNumber) {
    return { from: body.waId || body.whatsappNumber, text: body.text || body.message || '' };
  }
  if (body.From && body.Body) {
    return { from: body.From.replace('whatsapp:+', ''), text: body.Body };
  }
  if (body.entry) {
    const msg = body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (msg) {
      return {
        from: msg.from,
        text: msg.text?.body || '',
        messageId: msg.id || null,
        quotedId: msg.context?.id || null,
      };
    }
  }
  return null;
}

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function getAdminPhones() {
  const raw = [
    process.env.ADMIN_PHONE || '',
    process.env.ADMIN_PHONE_1 || '',
    process.env.ADMIN_PHONE_2 || '',
    '593999648041',
    '0999648041',
  ].filter(Boolean);
  return new Set(raw.map(normalizePhone).filter(Boolean));
}

function normalizeTextForMatch(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function parseTime(text) {
  const t = normalizeTextForMatch(text);
  let m = t.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/);
  if (m) {
    let h = parseInt(m[1], 10);
    const min = m[2];
    const ampm = m[3];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${min}`;
  }
  m = t.match(/\b([0-9]{1,2})\s*(am|pm)\b/);
  if (m) {
    let h = parseInt(m[1], 10);
    const ampm = m[2];
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:00`;
  }
  return null;
}

function parseRelativeDate(text) {
  const t = normalizeTextForMatch(text);
  const today = new Date();
  const dayMap = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };
  for (const [name, dow] of Object.entries(dayMap)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) {
      const result = new Date(today);
      const currentDow = today.getDay();
      let delta = dow - currentDow;
      if (delta <= 0) delta += 7;
      result.setDate(today.getDate() + delta);
      return result.toISOString().slice(0, 10);
    }
  }
  const iso = t.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  return null;
}

function inferService(text) {
  const t = normalizeTextForMatch(text);
  const rules = [
    ['cambio de aceite', 'cambio de aceite'],
    ['aceite', 'cambio de aceite'],
    ['frenos', 'inspección de frenos'],
    ['alineacion', 'alineación'],
    ['diagnostico', 'diagnóstico de motor'],
    ['motor', 'diagnóstico de motor'],
    ['filtro', 'cambio de filtros'],
    ['mantenimiento', 'mantenimiento general'],
    ['lavada', 'lavada'],
    ['lavado', 'lavada'],
  ];
  for (const [needle, service] of rules) {
    if (t.includes(needle)) return service;
  }
  return null;
}

async function tryAutoBookAppointment(phone, text) {
  const service = inferService(text);
  const fecha = parseRelativeDate(text);
  const hora = parseTime(text);
  if (!service || !fecha || !hora) return null;

  const client = await getClient(phone);
  const nombreCliente = client?.nombre || 'Cliente';
  const telefono = phone;
  const slot = await pool.query(
    `SELECT id, tecnico FROM disponibilidad
      WHERE fecha = $1 AND TO_CHAR(hora,'HH24:MI') = $2 AND disponible = true
      ORDER BY id LIMIT 1`,
    [fecha, hora]
  );
  if (!slot.rows.length) {
    return `No tengo libre ${fecha} a las ${hora}. Si quieres, te ayudo a buscar otro horario.`;
  }

  const cita = await createAppointment({
    nombreCliente,
    telefono,
    servicio,
    fecha,
    hora,
    slotRecordId: slot.rows[0].id,
    notas: 'Agendada por WhatsApp',
  });

  try {
    const horas = getServiceDuration(service);
    await pool.query(
      'UPDATE citas SET tiempo_estimado = $1, tecnico = COALESCE($2, tecnico) WHERE id = $3',
      [horas, slot.rows[0].tecnico || null, cita.id]
    );
  } catch (e) {
    console.warn('[auto-book] no se pudo guardar duración/técnico:', e.message);
  }

  return `Cita confirmada ✅\n\n` +
    `• Servicio: ${cita.servicio}\n` +
    `• Fecha: ${cita.fecha}\n` +
    `• Hora: ${cita.hora}\n` +
    `• Cliente: ${cita.nombreCliente}\n\n` +
    `Si deseas cambiarla, me dices y te ayudo.`;
}

async function handleQuickReply(phone, text) {
  const t = String(text || '').trim();
  const norm = normalizeTextForMatch(t);
  if (!t) return null;

  const bookedReply = await tryAutoBookAppointment(phone, t);
  if (bookedReply) {
    return bookedReply;
  }

  if (/^1$/.test(norm) || /\b(horario)\b/i.test(t)) {
    return getStaticResponse('horario') || `Nuestro horario de atención es: ${process.env.SHOP_HOURS || 'Lunes a Viernes 8:30-17:30, Sábados 9:00-16:00'}.`;
  }
  if (/^2$/.test(norm) || /\b(direccion|ubicacion)\b/i.test(norm)) {
    return getStaticResponse('direccion') || 'Escríbenos y te damos indicaciones para llegar a TG Motors.';
  }
  if (/^3$/.test(norm) || /\b(servicios?)\b/i.test(norm)) {
    return getStaticResponse('servicios') || 'En TG Motors ofrecemos mantenimiento, diagnóstico y reparación de vehículos.';
  }
  if (/^4$/.test(norm) || /\b(precio|c[úu]anto|cobran|valor)\b/i.test(norm)) {
    const price = await getPrecioEstandar('cambio de aceite');
    if (price) {
      return `El precio estándar de ${price.servicio} es $${parseFloat(price.precio).toFixed(2)}${price.nota ? ` (${price.nota})` : ''}.`;
    }
    return 'Para darte el precio exacto necesito revisar tu vehículo o el servicio específico.';
  }
  if (/^5$/.test(norm) || /\b(agendar|cita|reservar|turno|agenda)\b/i.test(norm)) {
    const client = await getClient(phone);
    const name = client?.nombre?.split(' ')[0] || 'hola';
    const hasVehicle = !!(client?.marca || client?.modelo || client?.anio || client?.placa);
    const vehicleText = hasVehicle
      ? `Veo que registraste un vehículo: ${[client.marca, client.modelo, client.anio].filter(Boolean).join(' ')}${client.placa ? `, placa ${client.placa}` : ''}.`
      : 'Aún no tengo tus datos de vehículo.';

    return `Perfecto ${name} 👌 vamos a agendar tu cita.\n\n` +
      `${vehicleText}\n\n` +
      `Envíame por favor:\n` +
      `• El servicio que necesitas\n` +
      `• La fecha que prefieres\n` +
      `• La hora aproximada\n\n` +
      `Si ya me dices todo junto, mejor todavía.`;
  }

  const isGreeting = /\b(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|hello|hi)\b/i.test(t);
  if (isGreeting) {
    const name = (await getClient(phone))?.nombre?.split(' ')[0] || 'hola';
    return `${buildMainMenu(name)}\n\nDime qué necesitas y te ayudo de una.`;
  }

  const cached = getStaticResponse(t);
  if (cached) {
    return cached;
  }

  if (/\b(precio|cu[aá]nto|c[uú]esta|cobran|cobras|valor)\b/i.test(norm)) {
    const price = await getPrecioEstandar('cambio de aceite');
    if (price) {
      return `El precio estándar de ${price.servicio} es $${parseFloat(price.precio).toFixed(2)}${price.nota ? ` (${price.nota})` : ''}.\n\n` +
        `Si quieres, te ayudo también con horario, servicios o una cita.`;
    }
    return 'Para darte el precio exacto necesito revisar tu vehículo o el servicio específico.\n\n' +
      'Envíame la marca, modelo y año, y te ayudo enseguida.';
  }

  return null;
}

/**
 * Detecta si el cliente está aprobando una orden de trabajo.
 * Retorna true si actualizó la orden, false si no había nada que aprobar.
 */
async function handleApproval(telefono) {
  const { rows } = await pool.query(
    `SELECT id FROM citas
     WHERE telefono = $1 AND estado_orden = 'Enviada'
     ORDER BY created_at DESC LIMIT 1`,
    [telefono]
  );
  if (!rows.length) return false;

  await updateAppointment(rows[0].id, { estado_orden: 'Aprobada', Estado: 'En proceso' });
  console.log(`[approval] Orden ${rows[0].id} aprobada por ${telefono}`);
  return true;
}

/**
 * Registra el mensaje de un proveedor (el bot NO le responde al proveedor).
 */
async function forwardProviderToOwner(phone, text) {
  console.log('[provider] message recorded, owner WhatsApp notification skipped', { phone, textSnippet: text.slice(0, 50) });
}

/**
 * Maneja la respuesta a la encuesta de satisfacción (1–5) de forma determinística,
 * SIN LLM. Solo actúa si hay una encuesta pendiente (seguimiento='survey_sent').
 * @returns {boolean} true si procesó la calificación, false si no aplica.
 */
async function handleSurveyReply(phone, text) {
  const rating = parseSurveyRating(text);
  if (rating == null) return false;

  const { rows } = await pool.query(
    `SELECT id, nombre_cliente FROM citas
      WHERE telefono = $1 AND seguimiento = 'survey_sent' AND calificacion IS NULL
      ORDER BY created_at DESC LIMIT 1`,
    [phone]
  );
  if (!rows.length) return false; // no hay encuesta pendiente → no es una calificación

  const cita = rows[0];
  await updateAppointment(cita.id, { Seguimiento: 'survey_done', calificacion: rating });
  console.log(`[survey] Cita ${cita.id} calificada ${rating}/5 por ${phone}`);

  const nombre = cita.nombre_cliente || '';
  if (rating >= 4) {
    await sendMessage(phone, `¡Muchas gracias por tu calificación de ${rating} ⭐, ${nombre}! Nos alegra que hayas tenido una buena experiencia. 🙌`);
    try { await sendReviewRequest(phone, nombre); } catch (e) { console.warn('[survey] review request:', e.message); }
  } else {
    await sendMessage(phone, `Gracias por tu sinceridad, ${nombre}. Lamentamos que la experiencia no haya sido la mejor. 🙏 Un miembro del equipo te contactará para ayudarte a resolverlo.`);
  }
  return true;
}

// Mensaje ÚNICO y fijo para el handoff de pagos (capa 1 regex y capa 2 LLM usan el mismo).
// Sin montos ni detalles: solo defiere al equipo. El bot no vuelve a hablar del tema.
const PAYMENT_HANDOFF_MSG = `Gracias 🙏 Le haré saber al equipo de ${process.env.SHOP_NAME || 'TG Motors'} para que revise tu tema de pago directamente contigo. Un asesor te contactará por aquí.`;

// Temas de facturación/cuenta que requieren intervención humana (NO método de pago).
// Enfocado para evitar falsos positivos como "¿puedo pagar con tarjeta?": la palabra
// suelta "pago/pagar" NO dispara; sí lo hacen términos de facturación/disputa.
// Es la CAPA 1 (determinística). La CAPA 2 (tool escalar_pago del LLM) cubre las frases
// que el regex no atrape; ambas terminan en modo PAUSED y con este mismo mensaje.
const PAYMENT_ISSUE_RE = /retenci[oó]n|comprobante|transferenc|dep[oó]sit|factura|reembolso|nota de venta|\bboleta\b|\bsaldo\b|\bdeuda\b|\babono\b|pago pendiente|pendiente\b[\s\S]{0,15}\bpago\b|pag(?:u[eé]|[oó])\b[\s\S]{0,15}de m[aá]s|cobr\w*[\s\S]{0,15}de m[aá]s/i;

/**
 * Handoff de pagos: si el mensaje es un tema de pago/facturación, envía UN mensaje
 * fijo (sin LLM), pasa la conversación a humano en modo PAUSED (silencio permanente
 * hasta que el asesor haga #bot <tel>) y guarda el mensaje. El bot NO vuelve a
 * responder por su cuenta → la interacción sigue con el asesor/dueño.
 * @returns {boolean} true si escaló (detener el procesamiento), false si no aplica.
 */
async function handlePaymentHandoff(phone, text, sendFn) {
  if (!PAYMENT_ISSUE_RE.test(text)) return false;

  await sendFn(PAYMENT_HANDOFF_MSG);
  await takeOverByHuman(phone, 'asesor', 'PAUSED');

  const h = await getHistory(phone);
  await appendMessage({ telefono: phone, paso: 'pago_humano', servicioElegido: h?.servicioElegido || null,
    newMessages: [{ role: 'user', content: text }], existingRecordId: h?.recordId || null });
  console.log('[payment] handoff a humano (PAUSED, regex) — bot en silencio', { phone });
  return true;
}

/**
 * Construye el mensaje (mínimo, exacto) que recibe el cliente con la respuesta de Diego.
 * No pasa por el LLM → cero posibilidad de mezclar precios.
 */
function buildClientRelayMessage(inq, ownerText) {
  const nombre = inq.nombre ? ` ${inq.nombre.split(' ')[0]}` : '';
  const ref = inq.concepto || inq.vehiculo || '';
  return `Hola${nombre} 👋 Sobre tu consulta${ref ? ` de ${ref}` : ''}:\n\n${ownerText}`;
}

/**
 * Modo admin (dueño/asesor). Relay determinístico de cotizaciones:
 *  - Diego CITA la notificación de una consulta → reenvío server-side exacto (bypass LLM).
 *  - No cita y hay >1 pendiente → pedir que cite (nunca adivinar).
 *  - 1 pendiente o nada → agente admin (LLM).
 */
async function handleAdminMessage(phone, text, sendFn, meta = {}) {
  const history = await getHistory(phone);
  const priorMessages = history?.historial || [];
  const existingRecordId = history?.recordId || null;

  // ── Comandos del asesor: #humano <tel> (tomar) / #bot <tel> (devolver) ───────
  const cmd = parseAdvisorCommand(text);
  if (cmd) {
    let target = cmd.target;
    // Si no especifica número, intentar el de una consulta citada.
    if (!target && meta.quotedId) {
      try { const inq = await getInquiryByNotifyMsgId(meta.quotedId); if (inq) target = inq.telefono; } catch {}
    }
    if (!target) {
      await sendFn(`Indica el número del cliente. Ej: ${cmd.cmd === 'take' ? '#humano 593...' : '#bot 593...'}`);
      return;
    }
    if (cmd.cmd === 'take') {
      await takeOverByHuman(target, 'asesor', 'HUMAN');
      console.log('[CONTROL] takeover', { target, by: 'asesor', owner: 'HUMAN' });
      await sendFn(`✅ Tomaste la conversación de +${target}. El bot quedó en silencio para ese cliente.`);
    } else if (cmd.cmd === 'mark_provider') {
      await setProvider(target, true);
      console.log('[CONTROL] mark_provider', { target });
      await sendFn(`✅ +${target} marcado como PROVEEDOR. El bot ya no le responderá; sus mensajes te los reenvío a ti.`);
    } else if (cmd.cmd === 'unmark_provider') {
      await setProvider(target, false);
      console.log('[CONTROL] unmark_provider', { target });
      await sendFn(`✅ +${target} vuelve a ser CLIENTE normal. El bot lo atenderá de nuevo.`);
    } else {
      await releaseToBot(target, 'BOT');
      console.log('[CONTROL] release', { target, owner: 'BOT' });
      await sendFn(`✅ Devuelta al bot la conversación de +${target}.`);
    }
    await appendMessage({ telefono: phone, paso: 'admin', servicioElegido: null,
      newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: 'comando ownership' }],
      existingRecordId });
    return;
  }

  let quotedInquiry = null;
  if (meta.quotedId) {
    try { quotedInquiry = await getInquiryByNotifyMsgId(meta.quotedId); }
    catch (e) { console.warn('[admin] no se pudo resolver mensaje citado:', e.message); }
  }

  let pending = [];
  try { pending = await getPendingPriceInquiries(); }
  catch (e) { console.warn('[admin] no se pudieron cargar consultas pendientes:', e.message); }

  const decision = decideRelayTarget({ quotedInquiry, pendingInquiries: pending });

  // ── Relay determinístico server-side (solo mensaje citado) ──────────────────
  if (decision.action === 'send' && quotedInquiry) {
    const inq = decision.inquiry;
    const clientMsg = buildClientRelayMessage(inq, text);
    await sendMessage(inq.telefono, clientMsg);
    const closed = await answerPriceInquiryById(inq.id, text);
    // El humano ya respondió la cotización → el bot retoma para manejar la aprobación.
    await releaseToBot(inq.telefono, 'WAITING_APPROVAL').catch(() => {});
    const reply = `✅ Reenviado a ${inq.nombre || inq.telefono}. Consulta cerrada.`;
    await sendFn(reply);
    console.log('[CONTROL] relay', { inquiry_id: inq.id, target_phone: inq.telefono,
      status_before: 'pendiente', status_after: closed ? 'respondida' : 'no_pendiente',
      routed_by: 'quoted_message_id' });
    await appendMessage({ telefono: phone, paso: 'admin', servicioElegido: null,
      newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: reply }],
      existingRecordId });
    return;
  }

  // ── Ambiguo: varias pendientes y no citó → no adivinar ──────────────────────
  if (decision.action === 'reject_ambiguous') {
    const reply = 'Tengo varias consultas pendientes. Para no enviarle el precio al cliente equivocado, responde CITANDO (desliza a responder) el mensaje exacto de la consulta.';
    await sendFn(reply);
    console.log('[CONTROL] relay', { target_phone: null, routed_by: 'rejected_ambiguous',
      pending: pending.length });
    await appendMessage({ telefono: phone, paso: 'admin', servicioElegido: null,
      newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: reply }],
      existingRecordId });
    return;
  }

  // ── 1 pendiente (sin cita) o consulta admin normal → agente LLM ─────────────
  let replyContext = null;
  if (decision.action === 'send' && decision.inquiry) {
    const inq = decision.inquiry;
    replyContext = `Hay UNA sola consulta pendiente: ${inq.nombre || 'cliente'} (teléfono ${inq.telefono}): "${inq.pregunta}". Si este mensaje es la respuesta a esa consulta, usa responder_consulta_precio con el teléfono ${inq.telefono}. Si es otra cosa (consulta del ERP), respóndela normal.`;
  }
  const { reply, usage } = await runAdminTurn(priorMessages, text, replyContext);
  recordTokenUsage(phone, usage.input, usage.output);
  await sendFn(reply);
  await appendMessage({ telefono: phone, paso: 'admin', servicioElegido: null,
    newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: reply }],
    existingRecordId });
}

/**
 * Punto de entrada: serializa por teléfono (mismo wa_id → en orden; números
 * distintos → en paralelo). Evita race condition sobre el historial.
 * Envuelto en SAFE MODE: ante cualquier error → pausa humano, loguea, no notifica al dueño.
 */
async function processMessage(phone, text, sendFn, meta = {}) {
  return withLock(phone, async () => {
    try {
      return await processMessageInner(phone, text, sendFn, meta);
    } catch (err) {
      console.error('[processMessage] error:', err.message);
      try {
        await sendFn(makeFallbackReply(text));
      } catch (sendErr) {
        console.error('[processMessage] fallback send failed:', sendErr.message);
      }
      if (!isLLMTransientError(err)) {
        await enterSafeMode(phone, err, { reason: 'process_exception' });
      } else {
        console.warn('[processMessage] LLM transient error; fallback reply sent without SAFE_MODE');
      }
    }
  });
}

/**
 * Lógica central de procesamiento de un mensaje entrante, independiente del
 * transporte. `sendFn(replyText)` es el callback que entrega la respuesta
 * por el canal correspondiente (Twilio/WATI/Meta o respond.io).
 */
async function processMessageInner(phone, text, sendFn, meta = {}) {
  const textNorm = text.trim().toLowerCase();
  console.log(`[inbound] ${phone}: ${text.slice(0, 120)}`);

  const incomingPhone = normalizePhone(phone);
  const adminPhones = getAdminPhones();

  // Admin de pruebas: bypass total para validar el bot sin quedar atrapado en HUMAN.
  if (adminPhones.has(incomingPhone)) {
    // Si quedó con estado humano/pausa, lo regresamos a BOT para pruebas.
    await setConversationState(phone, {
      owner_type: 'BOT',
      owner_id: null,
      conversation_mode: 'BOT',
      last_owner_change: new Date().toISOString(),
      last_human_activity: null,
    }).catch(() => {});
    const quickReplyText = await handleQuickReply(phone, text);
    if (quickReplyText) {
      await sendFn(quickReplyText);
      const h = await getHistory(phone);
      await appendMessage({
        telefono: phone, paso: 'activo',
        servicioElegido: h?.servicioElegido || null,
        newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: quickReplyText }],
        existingRecordId: h?.recordId || null,
      });
      return;
    }
    console.log('[admin-test] bypass', { phone: incomingPhone });
    return handleAdminMessage(phone, text, sendFn, meta);
  }

  // Admin mode: owner bypasses all guards — they need full ERP access
  const ownerPhone = normalizePhone(process.env.OWNER_PHONE);
  if (ownerPhone && incomingPhone === ownerPhone) {
    return handleAdminMessage(phone, text, sendFn, meta);
  }

  // Fast path for very common questions: avoids Gemini/tool failures entirely.
  const quickReplyText = await handleQuickReply(phone, text);
  if (quickReplyText) {
    await sendFn(quickReplyText);
    const h = await getHistory(phone);
    await appendMessage({
      telefono: phone, paso: 'activo',
      servicioElegido: h?.servicioElegido || null,
      newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: quickReplyText }],
      existingRecordId: h?.recordId || null,
    });
    return;
  }

  // ── Conversation Control Layer ───────────────────────────────────────────────
  // ÚNICA decisión de si el bot responde. El LLM nunca decide esto.
  const state = await getConversationState(phone);
  const nowMs = Date.now();

  // Un estado dejado por error técnico no debe bloquear al cliente real.
  // SYSTEM = safe mode técnico; lo soltamos apenas el cliente vuelva a escribir.
  if (state.owner_type === 'HUMAN' && state.owner_id === 'SYSTEM') {
    await releaseToBot(phone, 'BOT').catch(() => {});
    state.owner_type = 'BOT';
    state.owner_id = null;
    state.conversation_mode = 'BOT';
    state.last_owner_change = new Date().toISOString();
    state.last_human_activity = null;
    console.log('[CONTROL] system_handoff reset → BOT', { phone });
  }

  const ctrl = shouldBotRespond({
    safeMode: false,
    isDuplicate: false, // el dedup durable ya filtró antes de llegar aquí
    alreadyAnswered: !!(meta.messageId && state.last_answered_message_id === meta.messageId),
    isSpam: false,      // el guard de repetidos se evalúa abajo
    ownerType: state.owner_type || 'BOT',
    conversationMode: state.conversation_mode || 'BOT',
    lastHumanActivityMs: state.last_human_activity ? new Date(state.last_human_activity).getTime() : null,
    lastOwnerChangeMs: state.last_owner_change ? new Date(state.last_owner_change).getTime() : null,
    nowMs,
    targetMatches: true,
  });
  console.log('[CONTROL]', { phone, owner: state.owner_type, mode: state.conversation_mode,
    decision: ctrl.decision, reason: ctrl.reason, llm_called: ctrl.decision === 'ALLOW_BOT',
    human_active: ctrl.humanActive });

  if (ctrl.decision === 'IGNORE') return;
  if (ctrl.decision === 'ERROR') { await enterSafeMode(phone, new Error(ctrl.reason), { reason: ctrl.reason }); return; }
  if (ctrl.decision === 'ALLOW_HUMAN') {
    // Silent AI Mode: guardamos el mensaje del cliente, NO respondemos.
    const h = await getHistory(phone);
    await appendMessage({ telefono: phone, paso: 'humano', servicioElegido: h?.servicioElegido || null,
      newMessages: [{ role: 'user', content: text }], existingRecordId: h?.recordId || null });
    return;
  }
  // Reactivación por timeout: si era HUMAN/PAUSED pero venció su ventana, ya volvió a BOT
  // lógicamente (el control layer devolvió ALLOW_BOT); persistir owner=BOT.
  if (state.owner_type === 'HUMAN' && !ctrl.humanActive) {
    await releaseToBot(phone, 'BOT').catch(() => {});
    console.log('[CONTROL] handoff expiró → owner=BOT', { phone, mode_prev: state.conversation_mode });
  }

  // ── Proveedor ya marcado → reenviar al dueño, NO responder ────────────────────
  let clientRecord = await getClient(phone);
  if (clientRecord && clientRecord.es_proveedor) {
    await forwardProviderToOwner(phone, text);
    const h = await getHistory(phone);
    await appendMessage({ telefono: phone, paso: 'proveedor', servicioElegido: h?.servicioElegido || null,
      newMessages: [{ role: 'user', content: text }], existingRecordId: h?.recordId || null });
    return;
  }

  // ── Pre-LLM guards ───────────────────────────────────────────────────────────
  // Run before any DB or LLM call. Returns 200 to 360dialog immediately (handled
  // in the webhook handler) but the reply must still be sent to the user.

  const guard = checkGuards(phone, text);
  if (guard.blocked) {
    await sendFn(guard.response);
    return;
  }

  // Respuesta a la encuesta de satisfacción (1–5) — determinístico, sin LLM.
  if (await handleSurveyReply(phone, text)) return;

  // Approval detection — checked after guards (approval is always automotive context)
  if (/^(aprobado|apruebo|aprobada|si apruebo|sí apruebo|autorizado)/i.test(textNorm)) {
    const approved = await handleApproval(phone);
    if (approved) {
      await sendFn('Perfecto, tu orden fue aprobada. Ya comenzamos el trabajo. Te avisamos cuando esté listo.');
      return;
    }
  }

  // Tema de pago/facturación → escalar a humano y pausar el bot (silencio permanente).
  if (await handlePaymentHandoff(phone, text, sendFn)) return;

  // Static cache: horario / dirección / servicios → respond without LLM
  const cached = getStaticResponse(text);
  if (cached) {
    console.log(`[guard:cache_hit] ${phone} — static response served`);
    await sendFn(cached);
    return;
  }

  // Repeated message: same exact text sent REPEAT_BLOCK_AT times → skip LLM
  if (isRepeatedMessage(phone, text)) {
    logBlock(phone, 'repeated_msg', text.slice(0, 80));
    await sendFn('Ya te respondí ese mensaje. ¿Puedo ayudarte con algo más?');
    return;
  }

  // ── Normal LLM flow ──────────────────────────────────────────────────────────

  if (!clientRecord) {
    clientRecord = await createClient({ nombre: 'Cliente nuevo', telefono: phone });
  }

  const history = await getHistory(phone);
  const priorMessages    = history?.historial || [];
  const existingRecordId = history?.recordId || null;

  const { reply, usage, isProvider, isPaymentEscalation } = await runTurn(clientRecord, priorMessages, text);
  recordTokenUsage(phone, usage.input, usage.output);

  // CAPA 2 — Si el LLM escaló un tema de pago (escalar_pago): ya quedó PAUSED dentro del
  // tool. Enviamos el mensaje fijo (NO el texto libre del LLM) y cortamos. El bot no vuelve
  // a responder hasta que el asesor haga #bot <tel>.
  if (isPaymentEscalation) {
    await sendFn(PAYMENT_HANDOFF_MSG);
    console.log('[payment] handoff a humano (PAUSED, LLM) — bot en silencio', { phone });
    await appendMessage({ telefono: phone, paso: 'pago_humano',
      servicioElegido: history?.servicioElegido || null,
      newMessages: [{ role: 'user', content: text }], existingRecordId });
    return;
  }

  // Si el LLM detectó un proveedor: ya se avisó al dueño en el tool. NO responder.
  if (isProvider) {
    console.log('[provider] detectado por LLM — sin respuesta al proveedor', { phone });
    await appendMessage({ telefono: phone, paso: 'proveedor',
      servicioElegido: history?.servicioElegido || null,
      newMessages: [{ role: 'user', content: text }], existingRecordId });
    return;
  }

  const finalReply = isWeakGenericReply(reply)
    ? resolveContextualReply(text, clientRecord.nombre || 'hola')
    : reply;

  await sendFn(finalReply);
  console.log(`[outbound] ${phone}: ${finalReply.slice(0, 80)}...`);

  await appendMessage({
    telefono: phone, paso: 'activo',
    servicioElegido: history?.servicioElegido || null,
    newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: finalReply }],
    existingRecordId,
  });

  // Anti-loop: registrar que ya respondimos este messageId + actividad del bot.
  await markBotActivity(phone, meta.messageId).catch(() => {});
}

async function handleInbound(body) {
  console.log('[webhook] raw body:', JSON.stringify(body));
  const parsed = parsePayload(body);
  console.log('[webhook] parsed:', JSON.stringify(parsed));
  if (!parsed || !parsed.text) return;

  await processMessage(
    parsed.from,
    parsed.text,
    (msg) => sendMessage(parsed.from, msg),
    { messageId: parsed.messageId || null, quotedId: parsed.quotedId || null }
  );
}

module.exports = { handleInbound, processMessage };
