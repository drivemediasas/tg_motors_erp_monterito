const { buildSystemPrompt } = require('../prompts/monterito');
const { getAvailability } = require('../tools/db/get-availability');
const { createAppointment } = require('../tools/db/create-appointment');
const { alertOwner } = require('../tools/whatsapp/alert-owner');
const { getServiceDuration } = require('../tools/db/service-durations');
const { getOrderStatus } = require('../tools/db/get-order-status');
const { cancelAppointment } = require('../tools/db/cancel-appointment');
const { createPriceInquiry, setInquiryNotifyMsgId } = require('../tools/db/price-inquiries');
const { notifyOwnerPrice } = require('../tools/whatsapp/notify-owner-price');
const { getActiveOrder, appendServiceToOrder } = require('../tools/db/active-order');
const { getPrecioEstandar } = require('../tools/db/precios-estandar');
const { sendMessage } = require('../tools/whatsapp/send-message');
const { takeOverByHuman } = require('../tools/db/conversation-state');
const { setProvider } = require('../tools/db/mark-provider');
const pool = require('../tools/db/client');
const { trimHistory } = require('./guards');
const { runGroqChat } = require('./llm/groq');
const { MAX_TOOL_ITERATIONS, SIDE_EFFECT_TOOLS, filterRepeatedSideEffects } = require('./agent-limits');
const { bump } = require('./metrics');

// Tool definitions exposed to the LLM
const TOOLS = [
  {
    name: 'check_availability',
    description: 'Horarios libres para citas en los próximos días.',
    input_schema: {
      type: 'object',
      properties: {
        dias: { type: 'number', description: 'Días hacia adelante (default 7)' },
      },
      required: [],
    },
  },
  {
    name: 'book_appointment',
    description: 'Reserva la cita. Solo tras confirmar servicio, fecha y hora con el cliente.',
    input_schema: {
      type: 'object',
      properties: {
        nombreCliente:  { type: 'string', description: 'Nombre completo del cliente' },
        telefono:       { type: 'string', description: 'Número de WhatsApp del cliente' },
        servicio:       { type: 'string', description: 'Servicio solicitado' },
        fecha:          { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
        hora:           { type: 'string', description: 'Hora del turno (ej. 09:00)' },
        slotRecordId:   { type: 'string', description: 'ID del registro en TABLA 3 para marcar como ocupado' },
        notas:          { type: 'string', description: 'Notas adicionales (opcional)' },
      },
      required: ['nombreCliente', 'telefono', 'servicio', 'fecha', 'hora'],
    },
  },
  {
    name: 'alert_owner',
    description: 'Alerta al equipo por una emergencia REAL fuera del taller (grúa, wincha, varado en la vía, accidente, no arranca en carretera).',
    input_schema: {
      type: 'object',
      properties: {
        clientName:       { type: 'string', description: 'Nombre del cliente (si lo conoces; no es obligatorio)' },
        emergencyMessage: { type: 'string', description: 'Mensaje original del cliente describiendo la emergencia' },
      },
      required: ['emergencyMessage'],
    },
  },
  {
    name: 'check_order_status',
    description: 'Estado de la orden de trabajo del cliente (cómo va su vehículo).',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancela la próxima cita del cliente (solo si él lo confirma). Para reagendar: cancela y luego book_appointment.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'save_client_info',
    description: 'Guarda datos que el cliente ESCRIBIÓ (nombre, correo, cédula/RUC, vehículo). No inventes nada; guarda solo lo que dijo.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre completo del cliente' },
        correo: { type: 'string', description: 'Correo electrónico del cliente (ej: juan@gmail.com)' },
        cedula: { type: 'string', description: 'Cédula o RUC del cliente (ej: 1712345678)' },
        marca:  { type: 'string', description: 'Marca del vehículo (ej: Toyota)' },
        modelo: { type: 'string', description: 'Modelo del vehículo (ej: Hilux)' },
        anio:   { type: 'string', description: 'Año del vehículo (ej: 2019)' },
        placa:  { type: 'string', description: 'Placa del vehículo (ej: PBK-1234)' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'consultar_precio',
    description: 'Manda la consulta de precio al equipo (para servicios que dependen del vehículo, o servicios fuera de la lista base). NUNCA inventes precios ni digas que no se hace.',
    input_schema: {
      type: 'object',
      properties: {
        pregunta: { type: 'string', description: 'Consulta completa: vehículo (marca, modelo, año) + qué necesita. Ej: "Enderezada y pintura de 2 puertas de un Chevrolet Corsa 2001".' },
      },
      required: ['pregunta'],
    },
  },
  {
    name: 'precio_servicio',
    description: 'Precio estándar de un servicio básico. Llámala PRIMERO ante cualquier pregunta de precio. Si no hay precio, usa consultar_precio.',
    input_schema: {
      type: 'object',
      properties: {
        servicio: { type: 'string', description: 'Nombre del servicio que pregunta el cliente (ej: "cambio de aceite", "lavada", "alineación")' },
      },
      required: ['servicio'],
    },
  },
  {
    name: 'agregar_servicio_orden',
    description: 'Suma un servicio extra a la orden ACTIVA del cliente (si ya tiene una en curso). No crees una cita nueva.',
    input_schema: {
      type: 'object',
      properties: {
        servicio: { type: 'string', description: 'El servicio extra a agregar (ej: "lavada", "cambio de llanta ponchada")' },
      },
      required: ['servicio'],
    },
  },
  {
    name: 'marcar_proveedor',
    description: 'Marca a quien escribe como PROVEEDOR (viene a DEJAR productos/insumos/factura AL taller) y avisa al equipo. No lo registres como cliente.',
    input_schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string', description: 'El mensaje o resumen de lo que dijo el proveedor (para reenviar al equipo)' },
      },
      required: ['mensaje'],
    },
  },
  {
    name: 'escalar_pago',
    description: 'Escala al equipo un tema de dinero YA movido (pagos hechos/pendientes, saldos, deudas, facturas, transferencias, comprobantes, reembolsos, "me cobraron de más"). No discutas montos. NO es "¿cuánto cuesta X?".',
    input_schema: {
      type: 'object',
      properties: {
        mensaje: { type: 'string', description: 'Resumen del tema de pago que planteó el cliente (para registro del equipo)' },
      },
      required: [],
    },
  },
];

/**
 * Execute a tool call requested by the LLM.
 * @param {object} context - datos de la conversación (ej. { telefono } del cliente real)
 */
async function executeTool(name, input, context = {}) {
  if (name === 'check_availability') {
    const slots = await getAvailability(input.dias || 7);
    if (!slots.length) {
      return 'No hay horarios disponibles en los próximos días. Por favor comunícate directamente con el taller.';
    }
    // Format slots for the LLM to relay to the user
    const formatted = slots
      .slice(0, 8) // cap at 8 options
      .map(s => `- ${s.fecha} a las ${s.hora} (ID: ${s.recordId})`)
      .join('\n');
    return `Horarios disponibles:\n${formatted}`;
  }

  if (name === 'book_appointment') {
    // Anti-duplicado: si el cliente ya tiene una orden activa creada hoy, no crear otra;
    // redirigir a agregar el servicio a esa orden.
    try {
      const activa = await getActiveOrder(context.telefono);
      if (activa && activa.es_de_hoy) {
        return `El cliente ya tiene una orden de trabajo activa hoy (#${activa.id}). NO crees otra cita ni orden. Si quiere un servicio adicional, usa agregar_servicio_orden para sumarlo a esa orden.`;
      }
    } catch (e) { console.warn('[book_appointment] no se pudo verificar orden activa:', e.message); }

    const horas = getServiceDuration(input.servicio);
    const cita = await createAppointment(input);
    // Bloquear los cupos que ocupa la cita según la duración del servicio.
    try {
      // Elegir un técnico libre en ese horario (o el del slot reservado).
      const { rows: slot } = await pool.query(
        `SELECT tecnico FROM disponibilidad
          WHERE fecha = $1 AND TO_CHAR(hora,'HH24:MI') = $2 AND disponible = true
          ORDER BY id LIMIT 1`,
        [input.fecha, input.hora]
      );
      const tecnico = slot.length ? slot[0].tecnico : null;
      const [hh, mm] = String(input.hora).split(':').map(Number);
      const startMin = hh * 60 + (mm || 0);
      const endMin   = startMin + horas * 60;
      await pool.query(
        `UPDATE disponibilidad SET disponible = false, cita_id = $1
          WHERE COALESCE(tecnico,'') = COALESCE($2,'') AND fecha = $3
            AND (EXTRACT(HOUR FROM hora)*60 + EXTRACT(MINUTE FROM hora)) >= $4
            AND (EXTRACT(HOUR FROM hora)*60 + EXTRACT(MINUTE FROM hora)) <  $5`,
        [cita.id, tecnico, input.fecha, startMin, endMin]
      );
      await pool.query(
        'UPDATE citas SET tiempo_estimado = $1, tecnico = COALESCE($2, tecnico) WHERE id = $3',
        [horas, tecnico, cita.id]
      );
    } catch (e) {
      console.warn('[book_appointment] no se pudo bloquear duración:', e.message);
    }
    return `Cita confirmada:\n- Cliente: ${cita.nombreCliente}\n- Servicio: ${cita.servicio}\n- Fecha: ${cita.fecha}\n- Hora: ${cita.hora}\n- Duración estimada: ${horas}h\n- Estado: ${cita.estado}`;
  }

  if (name === 'alert_owner') {
    // El teléfono SIEMPRE sale del contexto (el chat real), nunca de lo que arme el LLM.
    await alertOwner({
      clientName:       input.clientName || context.nombre,
      clientPhone:      context.telefono,
      emergencyMessage: input.emergencyMessage,
    });
    return 'El equipo ya quedó avisado de la emergencia. Dile al cliente que lo contactan de inmediato.';
  }

  if (name === 'check_order_status') {
    const orden = await getOrderStatus(context.telefono);
    if (!orden) {
      return 'No encuentro una orden de trabajo activa a tu nombre. Si crees que es un error, dile que el equipo lo verificará.';
    }
    const vehiculo = [orden.marca, orden.modelo].filter(Boolean).join(' ');
    const placa = orden.placa ? ` (placa ${orden.placa})` : '';
    const estados = {
      'Enviada':    'Te enviamos la proforma y estamos esperando tu aprobación. Responde APROBADO para que comencemos.',
      'Aprobada':   'Tu trabajo fue aprobado y ya estamos trabajando en tu vehículo. 🔧',
      'En proceso': 'Estamos trabajando en tu vehículo en este momento. 🔧',
      'Completada': '¡Tu vehículo ya está listo para retirar! ✅',
    };
    const msg = estados[orden.estado_orden] || `Estado actual: ${orden.estado_orden}.`;
    return `Orden del vehículo${vehiculo ? ` ${vehiculo}` : ''}${placa}:\n${msg}${orden.tecnico ? `\nTécnico a cargo: ${orden.tecnico}` : ''}`;
  }

  if (name === 'cancel_appointment') {
    const result = await cancelAppointment(context.telefono);
    if (!result) {
      return 'No encontré una cita próxima a tu nombre para cancelar.';
    }
    return 'La cita fue cancelada y el cupo quedó liberado.';
  }

  if (name === 'save_client_info') {
    const sets = [], vals = [];
    let i = 1;
    if (input.nombre) { sets.push(`nombre=$${i}`); vals.push(input.nombre); i++; }
    if (input.correo) { sets.push(`email=$${i}`);  vals.push(input.correo); i++; }
    if (input.cedula) { sets.push(`cedula=$${i}`); vals.push(input.cedula); i++; }
    if (input.marca)  { sets.push(`marca=$${i}`);  vals.push(input.marca);  i++; }
    if (input.modelo) { sets.push(`modelo=$${i}`); vals.push(input.modelo); i++; }
    if (input.anio)   { sets.push(`anio=$${i}`);   vals.push(input.anio);   i++; }
    if (input.placa)  { sets.push(`placa=$${i}`);  vals.push(input.placa);  i++; }
    if (sets.length) {
      vals.push(context.telefono);
      await pool.query(`UPDATE clientes SET ${sets.join(', ')} WHERE telefono=$${i}`, vals);
    }
    console.log('[save_client_info] actualizado:', input.nombre, context.telefono);
    return 'Información guardada correctamente.';
  }

  if (name === 'consultar_precio') {
    const inquiry = await createPriceInquiry({
      telefono: context.telefono,
      nombre:   context.nombre,
      pregunta: input.pregunta,
      vehiculo: context.vehiculo,
      placa:    context.placa,
      concepto: input.servicio || null,
    });
    const notified = await notifyOwnerPrice({
      clientName:  context.nombre,
      clientPhone: context.telefono,
      question:    input.pregunta,
    });
    // Guardar el id del mensaje a Diego para emparejar su respuesta citada con esta consulta.
    if (notified.messageId) {
      try { await setInquiryNotifyMsgId(inquiry.id, notified.messageId); }
      catch (e) { console.warn('[consultar_precio] no se pudo guardar notify_msg_id:', e.message); }
    }
    // Escalada: la conversación pasa a manos del asesor hasta que responda o venza el timeout.
    try { await takeOverByHuman(context.telefono, 'asesor', 'WAITING_HUMAN'); }
    catch (e) { console.warn('[consultar_precio] no se pudo marcar WAITING_HUMAN:', e.message); }
    console.log('[consultar_precio] registrada:', context.telefono, '| owner notificado:', notified.success);
    return 'Consulta de precio enviada al equipo. Dile al cliente que estás confirmando el precio exacto para su caso y que en breve le respondes por aquí. No inventes un precio.';
  }

  if (name === 'precio_servicio') {
    const hit = await getPrecioEstandar(input.servicio);
    if (!hit) {
      return `No hay un precio estándar para "${input.servicio}". Es un servicio específico: usa consultar_precio para que el equipo dé el precio exacto.`;
    }
    const precio = `$${parseFloat(hit.precio).toFixed(2)}`;
    return `Precio estándar de ${hit.servicio}: ${precio}${hit.nota ? ` (${hit.nota})` : ''}. Puedes decírselo directamente al cliente.`;
  }

  if (name === 'agregar_servicio_orden') {
    const orden = await getActiveOrder(context.telefono);
    if (!orden) {
      return 'El cliente no tiene una orden de trabajo activa. Si quiere agendar, usa check_availability y book_appointment.';
    }
    await appendServiceToOrder(orden.id, input.servicio);
    console.log(`[agregar_servicio_orden] orden #${orden.id} +"${input.servicio}" (notificación WhatsApp omitida)`);
    return `Servicio "${input.servicio}" agregado a la orden activa #${orden.id}. Confírmale al cliente que lo sumaste a su orden actual y que el equipo ya quedó notificado. No se creó una orden nueva.`;
  }

  if (name === 'marcar_proveedor') {
    try { await setProvider(context.telefono, true, context.nombre); }
    catch (e) { console.warn('[marcar_proveedor] no se pudo marcar:', e.message); }
    console.log('[marcar_proveedor] marcado en BD (notificación WhatsApp a dueño omitida):', context.telefono);
    // El caller (message.js) detecta que se marcó proveedor y NO envía respuesta al proveedor.
    return 'PROVEEDOR_MARCADO';
  }

  if (name === 'escalar_pago') {
    // Tema de pago/facturación → pausa PERMANENTE (no expira con el timeout de 20 min).
    // El caller (message.js) envía un mensaje fijo y NO deja pasar el texto libre del LLM.
    try { await takeOverByHuman(context.telefono, 'asesor', 'PAUSED'); }
    catch (e) { console.warn('[escalar_pago] no se pudo marcar PAUSED:', e.message); }
    console.log('[escalar_pago] handoff a humano (PAUSED) — bot en silencio:', context.telefono);
    return 'PAGO_ESCALADO';
  }

  return 'Herramienta no reconocida.';
}

/**
 * Remove markdown formatting so WhatsApp renders plain text without visible symbols.
 * Handles **bold**, *bold*, _italic_, and `code` patterns.
 */
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/\*(.*?)\*/gs, '$1')
    .replace(/_(.*?)_/gs, '$1')
    .replace(/`([^`\n]*)`/g, '$1');
}

/**
 * Run one full conversation turn.
 * Handles tool-use loops internally until the LLM returns a final text reply.
 *
 * @param {object} clientRecord  - from getClient / createClient
 * @param {Array}  history       - prior messages [{ role, content }]
 * @param {string} userMessage   - the new inbound text
 * @returns {string} Monterito's final reply
 */
const MAX_REPLY_TOKENS = 400; // respuestas de WhatsApp son cortas; menos presión de TPM

/**
 * Run one full conversation turn.
 * Returns { reply: string, usage: { input: number, output: number } }
 */
async function runTurn(clientRecord, history, userMessage) {
  // Trim history to last HISTORY_MAX_MSGS messages before sending to the LLM
  const trimmed = trimHistory(history);

  const messages = [
    ...trimmed,
    { role: 'user', content: userMessage },
  ];

  const systemPrompt = buildSystemPrompt(clientRecord);

  let response = await runGroqChat({
    maxTokens: MAX_REPLY_TOKENS,
    system: systemPrompt,
    tools: TOOLS,
    messages,
  });

  let totalInput  = response.usage?.input_tokens  || 0;
  let totalOutput = response.usage?.output_tokens || 0;
  let isProvider  = false; // se activa si el LLM llamó marcar_proveedor
  let isPaymentEscalation = false; // se activa si el LLM llamó escalar_pago
  let cappedOut   = false;

  const ranSideEffects = new Set(); // side-effect tools ya ejecutadas este turno

  // Agentic loop — con tope duro de iteraciones (anti-spam / anti-quema de cuota)
  for (let iter = 0; response.stop_reason === 'tool_use'; iter++) {
    if (iter >= MAX_TOOL_ITERATIONS) {
      cappedOut = true;
      bump('loopCapHits');
      console.warn('[conversation] tope de iteraciones de tools alcanzado', { telefono: clientRecord.telefono });
      break;
    }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const { toRun, blocked } = filterRepeatedSideEffects(toolUseBlocks, ranSideEffects);
    const toolResults = blocked.map(b => ({ type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content }));

    const vehiculoCtx = [clientRecord.marca, clientRecord.modelo, clientRecord.anio].filter(Boolean).join(' ') || null;
    for (const block of toRun) {
      if (block.name === 'marcar_proveedor') isProvider = true;
      if (block.name === 'escalar_pago') isPaymentEscalation = true;
      if (SIDE_EFFECT_TOOLS.has(block.name)) ranSideEffects.add(block.name);
      const result = await executeTool(block.name, block.input, {
        telefono: clientRecord.telefono,
        nombre:   clientRecord.nombre,
        vehiculo: vehiculoCtx,
        placa:    clientRecord.placa || null,
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: result,
      });
    }

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });

    response = await runGroqChat({
      maxTokens: MAX_REPLY_TOKENS,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    });

    totalInput  += response.usage?.input_tokens  || 0;
    totalOutput += response.usage?.output_tokens || 0;
  }

  const textBlock = response.content.find(b => b.type === 'text');
  const raw = textBlock ? textBlock.text
    : (cappedOut
        ? 'Dame un momento, lo confirmo con el equipo y te escribo por aquí.'
        : 'Lo siento, no pude procesar tu mensaje.');
  return {
    reply: stripMarkdown(raw),
    usage: { input: totalInput, output: totalOutput },
    isProvider,
    isPaymentEscalation,
  };
}

module.exports = { runTurn, stripMarkdown };
