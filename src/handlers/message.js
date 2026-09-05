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
const { getConversationState, markBotActivity, takeOverByHuman, releaseToBot } = require('../../tools/db/conversation-state');
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
const { bump } = require('../metrics');

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

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeTextForMatch(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

async function replyHorario() {
  return getStaticResponse('horario') || `Nuestro horario de atención es: ${process.env.SHOP_HOURS || 'Lunes a Viernes 8:30-17:30, Sábados 9:00-16:00'}.`;
}
async function replyDireccion() {
  return getStaticResponse('direccion') || 'Escríbenos y te damos indicaciones para llegar a TG Motors.';
}
async function replyServicios() {
  return getStaticResponse('servicios') || 'En TG Motors ofrecemos mantenimiento, diagnóstico y reparación de vehículos.';
}
async function replyPrecio() {
  const price = await getPrecioEstandar('cambio de aceite');
  if (price) {
    return `El precio estándar de ${price.servicio} es $${parseFloat(price.precio).toFixed(2)}${price.nota ? ` (${price.nota})` : ''}.\n\n` +
      `Si quieres, te ayudo también con horario, servicios o una cita.`;
  }
  return 'Para darte el precio exacto necesito revisar tu vehículo o el servicio específico.\n\n' +
    'Envíame la marca, modelo y año, y te ayudo enseguida.';
}
async function replyAgendar(phone) {
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

/**
 * Fast path determinístico para preguntas muy comunes. NO agenda citas (eso es
 * responsabilidad del LLM + book_appointment) y NO interpreta un dígito suelto
 * como opción de menú salvo que `allowMenu` sea true (o sea: solo cuando el bot
 * acaba de mostrar el menú numerado o es el primer contacto). Así un "2" que
 * responde a "¿1 o 2 puertas?" no dispara la dirección del taller.
 *
 * @param {string} phone
 * @param {string} text
 * @param {{ allowMenu?: boolean }} [opts]
 */
async function handleQuickReply(phone, text, opts = {}) {
  const allowMenu = opts.allowMenu !== false;
  const t = String(text || '').trim();
  const norm = normalizeTextForMatch(t);
  if (!t) return null;

  // Selección por número — SOLO cuando corresponde (menú recién mostrado / 1er contacto).
  // Si es un dígito suelto fuera de ese contexto, lo maneja el LLM (puede ser respuesta
  // a una pregunta del bot), no el fast-path.
  if (/^[1-5]$/.test(norm)) {
    if (!allowMenu) return null;
    if (norm === '1') return replyHorario();
    if (norm === '2') return replyDireccion();
    if (norm === '3') return replyServicios();
    if (norm === '4') return replyPrecio();
    if (norm === '5') return replyAgendar(phone);
  }

  // El fast-path por palabra clave solo aplica a mensajes MUY cortos y directos
  // ("horario", "servicios", "dónde quedan"). Cualquier frase más larga, o que
  // mezcle otra intención (precio, agendar, cita), la maneja el LLM.
  const wordCount = norm.split(/\s+/).filter(Boolean).length;
  const hasOtherIntent = /\b(precio|costo|cuesta|cuanto|cotiz|agend|cita|reserv|turno|manteni|arregl|revis|diagn|dañ|falla|ruido|chapa|puerta|aceite|freno|llanta|motor)\b/i.test(norm);
  const isShort = wordCount <= 4 && t.length <= 32 && !hasOtherIntent;

  if (isShort) {
    if (/\bhorario\b/i.test(norm) || /\b(a )?qu[eé] hora\b/i.test(norm)) return replyHorario();
    if (/\b(direccion|ubicacion|donde (estan|quedan|queda))\b/i.test(norm)) return replyDireccion();
    if (/\bservicios?\b/i.test(norm)) return replyServicios();
  }

  const isGreeting = wordCount <= 3 && /^(hola|buenas|buenos d[ií]as|buenas tardes|buenas noches|hey|hello|hi|ola)\b/i.test(norm);
  if (isGreeting) {
    const name = (await getClient(phone))?.nombre?.split(' ')[0] || 'hola';
    return `${buildMainMenu(name)}\n\nDime qué necesitas y te ayudo de una.`;
  }

  const cached = getStaticResponse(t);
  if (cached) return cached;

  // Las preguntas de precio en texto libre ("¿cuánto cuesta X?") van al LLM:
  // así usa precio_servicio (precio estándar) o consultar_precio (escala al equipo)
  // según el caso. El fast-path solo resuelve el "4" del menú.
  return null;
}

// Marcadores exclusivos del menú de Monterito (no de una lista cualquiera del LLM).
const MENU_MARKERS = /(puedo ayudarte con:|responde con el n[uú]mero|soy monterito)/i;
const BARE_DIGIT_RE = /^\s*[1-5]\s*$/;

function isMenuMessage(content) {
  const c = String(content || '');
  return MENU_MARKERS.test(c) && /\n\s*1\)/.test(c) && /\n\s*2\)/.test(c);
}

/**
 * ¿El menú numerado sigue "activo"? Lo está si:
 *   · es el primer contacto (sin historial), o
 *   · el bot mostró el menú y, desde entonces, el cliente SOLO mandó dígitos 1-5.
 * Si el cliente escribió texto libre después del menú (ej. "tengo un Corsa"),
 * el menú deja de estar activo y un "2" posterior lo maneja el LLM (puede ser
 * respuesta a "¿1 o 2 puertas?"), no el fast-path.
 */
function menuJustShown(priorMessages) {
  if (!Array.isArray(priorMessages) || priorMessages.length === 0) return true;
  let lastMenuIdx = -1;
  for (let i = priorMessages.length - 1; i >= 0; i--) {
    const m = priorMessages[i];
    if (m.role === 'assistant' && isMenuMessage(m.content)) { lastMenuIdx = i; break; }
  }
  if (lastMenuIdx === -1) return false;
  for (let j = lastMenuIdx + 1; j < priorMessages.length; j++) {
    const m = priorMessages[j];
    if (m.role === 'user' && !BARE_DIGIT_RE.test(String(m.content || ''))) return false;
  }
  return true;
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
      const isWatchdog = /watchdog timeout/i.test(err.message || '');
      if (isWatchdog) bump('turnTimeouts');
      try {
        await sendFn(makeFallbackReply(text));
      } catch (sendErr) {
        console.error('[processMessage] fallback send failed:', sendErr.message);
      }
      if (!isLLMTransientError(err) && !isWatchdog) {
        await enterSafeMode(phone, err, { reason: 'process_exception' });
      } else {
        console.warn('[processMessage] error transitorio/watchdog; fallback enviado sin SAFE_MODE');
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

  // ── Número del dueño (Diego) ────────────────────────────────────────────────
  // El WhatsApp del taller lo atiende la administradora; Diego usa este chat para
  // hablar con ella. El bot NO debe meterse. Solo reacciona a:
  //   · comandos del asesor: #humano / #bot / #proveedor / #cliente
  //   · una respuesta CITANDO la notificación 📋 de una consulta de precio (relay)
  // Cualquier otro texto de Diego → se guarda en historial y el bot calla.
  const ownerPhone = normalizePhone(process.env.OWNER_PHONE);
  if (ownerPhone && incomingPhone === ownerPhone) {
    const isCommand = !!parseAdvisorCommand(text);
    if (isCommand || meta.quotedId) {
      return handleAdminMessage(phone, text, sendFn, meta);
    }
    const h = await getHistory(phone);
    await appendMessage({ telefono: phone, paso: 'owner_chat', servicioElegido: h?.servicioElegido || null,
      newMessages: [{ role: 'user', content: text }], existingRecordId: h?.recordId || null });
    console.log('[owner] mensaje de Diego sin comando — bot en silencio', { phone });
    return;
  }

  // Fast path para preguntas muy comunes: evita el LLM por completo.
  const preHist = await getHistory(phone);
  const quickReplyText = await handleQuickReply(phone, text, { allowMenu: menuJustShown(preHist?.historial) });
  if (quickReplyText) {
    await markBotActivity(phone, meta.messageId).catch(() => {});
    await sendFn(quickReplyText);
    await appendMessage({
      telefono: phone, paso: 'activo',
      servicioElegido: preHist?.servicioElegido || null,
      newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: quickReplyText }],
      existingRecordId: preHist?.recordId || null,
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

  const finalReply = reply;

  // Anti-loop: marcar ANTES de enviar, para que un reintento del webhook que
  // sortee el dedup no genere una segunda respuesta.
  await markBotActivity(phone, meta.messageId).catch(() => {});

  await sendFn(finalReply);
  console.log(`[outbound] ${phone}: ${finalReply.slice(0, 80)}...`);

  await appendMessage({
    telefono: phone, paso: 'activo',
    servicioElegido: history?.servicioElegido || null,
    newMessages: [{ role: 'user', content: text }, { role: 'assistant', content: finalReply }],
    existingRecordId,
  });
}

module.exports = { processMessage, handleQuickReply, menuJustShown, buildMainMenu, PAYMENT_ISSUE_RE };
