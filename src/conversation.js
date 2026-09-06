const { buildSystemPrompt } = require('../prompts/monterito');
const { getAvailability } = require('../tools/db/get-availability');
const { createAppointment } = require('../tools/db/create-appointment');
const { alertOwner } = require('../tools/whatsapp/alert-owner');
const { getServiceDuration } = require('../tools/db/service-durations');
const { getOrderStatus } = require('../tools/db/get-order-status');
const { cancelAppointment } = require('../tools/db/cancel-appointment');
const { getActiveOrder } = require('../tools/db/active-order');
const { getPrecioEstandar } = require('../tools/db/precios-estandar');
const pool = require('../tools/db/client');
const { trimHistory } = require('./guards');
const { runGroqChat } = require('./llm/groq');
const { MAX_TOOL_ITERATIONS, SIDE_EFFECT_TOOLS, filterRepeatedSideEffects } = require('./agent-limits');
const { bump } = require('./metrics');

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
    description: 'Alerta al equipo por una emergencia REAL fuera del taller (grúa, varado, accidente). NO usar para consultas normales.',
    input_schema: {
      type: 'object',
      properties: {
        clientName:       { type: 'string', description: 'Nombre del cliente' },
        emergencyMessage: { type: 'string', description: 'Mensaje de emergencia' },
      },
      required: ['emergencyMessage'],
    },
  },
  {
    name: 'check_order_status',
    description: 'Estado de la orden de trabajo del cliente.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'cancel_appointment',
    description: 'Cancela la próxima cita del cliente.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'save_client_info',
    description: 'Guarda datos que el cliente ESCRIBIÓ (nombre, correo, vehículo). No inventes nada.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: { type: 'string' },
        correo: { type: 'string' },
        cedula: { type: 'string' },
        marca:  { type: 'string' },
        modelo: { type: 'string' },
        anio:   { type: 'string' },
        placa:  { type: 'string' },
      },
      required: ['nombre'],
    },
  },
  {
    name: 'precio_servicio',
    description: 'Precio estándar de un servicio básico.',
    input_schema: {
      type: 'object',
      properties: {
        servicio: { type: 'string', description: 'Nombre del servicio' },
      },
      required: ['servicio'],
    },
  },
];

async function executeTool(name, input, context = {}) {
  if (name === 'check_availability') {
    const slots = await getAvailability(input.dias || 7);
    if (!slots.length) return 'No hay horarios disponibles. Comunícate directamente con el taller.';
    const formatted = slots.slice(0, 8)
      .map(s => `- ${s.fecha} a las ${s.hora} (ID: ${s.recordId})`)
      .join('\n');
    return `Horarios disponibles:\n${formatted}`;
  }

  if (name === 'book_appointment') {
    try {
      const activa = await getActiveOrder(context.telefono);
      if (activa && activa.es_de_hoy) {
        return `El cliente ya tiene una orden activa hoy (#${activa.id}). No crees otra.`;
      }
    } catch (e) { console.warn('[book_appointment] check orden activa:', e.message); }

    const horas = getServiceDuration(input.servicio);
    const cita = await createAppointment(input);
    try {
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
      console.warn('[book_appointment] bloquear duración:', e.message);
    }
    return `Cita confirmada:\n- Cliente: ${cita.nombreCliente}\n- Servicio: ${cita.servicio}\n- Fecha: ${cita.fecha}\n- Hora: ${cita.hora}\n- Duración estimada: ${horas}h`;
  }

  if (name === 'alert_owner') {
    const result = await alertOwner({
      clientName:       input.clientName || context.nombre,
      clientPhone:      context.telefono,
      emergencyMessage: input.emergencyMessage,
    });
    if (!result.success) return 'Alerta enviada internamente. El equipo contactará al cliente pronto.';
    return `Alerta enviada al dueño del taller. Ya está notificado.`;
  }

  if (name === 'check_order_status') {
    const orden = await getOrderStatus(context.telefono);
    if (!orden) return 'No encuentro una orden activa a tu nombre.';
    const vehiculo = [orden.marca, orden.modelo].filter(Boolean).join(' ');
    const placa = orden.placa ? ` (placa ${orden.placa})` : '';
    const estados = {
      'Enviada':    'Te enviamos la proforma y esperamos tu aprobación. Responde APROBADO para comenzar.',
      'Aprobada':   'Tu trabajo fue aprobado y estamos trabajando en tu vehículo.',
      'En proceso': 'Estamos trabajando en tu vehículo.',
      'Completada': 'Tu vehículo ya está listo para retirar.',
    };
    const msg = estados[orden.estado_orden] || `Estado: ${orden.estado_orden}.`;
    return `Orden${vehiculo ? ` ${vehiculo}` : ''}${placa}:\n${msg}`;
  }

  if (name === 'cancel_appointment') {
    const result = await cancelAppointment(context.telefono);
    if (!result) return 'No encontré una cita próxima para cancelar.';
    return 'Cita cancelada y cupo liberado.';
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
    return 'Información guardada.';
  }

  if (name === 'precio_servicio') {
    const hit = await getPrecioEstandar(input.servicio);
    if (!hit) return `No hay precio estándar para "${input.servicio}". Dile al cliente que lo confirmas con el equipo.`;
    return `Precio de ${hit.servicio}: $${parseFloat(hit.precio).toFixed(2)}${hit.nota ? ` (${hit.nota})` : ''}.`;
  }

  return 'Herramienta no reconocida.';
}

function stripMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/gs, '$1')
    .replace(/\*(.*?)\*/gs, '$1')
    .replace(/_(.*?)_/gs, '$1')
    .replace(/`([^`\n]*)`/g, '$1');
}

const MAX_REPLY_TOKENS = 400;

async function runTurn(clientRecord, history, userMessage) {
  const trimmed = trimHistory(history);
  const messages = [...trimmed, { role: 'user', content: userMessage }];
  const systemPrompt = buildSystemPrompt(clientRecord);

  let response = await runGroqChat({
    maxTokens: MAX_REPLY_TOKENS,
    system: systemPrompt,
    tools: TOOLS,
    messages,
  });

  let totalInput  = response.usage?.input_tokens  || 0;
  let totalOutput = response.usage?.output_tokens || 0;
  let cappedOut   = false;

  const ranSideEffects = new Set();

  for (let iter = 0; response.stop_reason === 'tool_use'; iter++) {
    if (iter >= MAX_TOOL_ITERATIONS) {
      cappedOut = true;
      bump('loopCapHits');
      console.warn('[conversation] tope de iteraciones alcanzado', { telefono: clientRecord.telefono });
      break;
    }

    const toolUseBlocks = response.content.filter(b => b.type === 'tool_use');
    const { toRun, blocked } = filterRepeatedSideEffects(toolUseBlocks, ranSideEffects);
    const toolResults = blocked.map(b => ({ type: 'tool_result', tool_use_id: b.tool_use_id, content: b.content }));

    for (const block of toRun) {
      if (SIDE_EFFECT_TOOLS.has(block.name)) ranSideEffects.add(block.name);
      const result = await executeTool(block.name, block.input, {
        telefono: clientRecord.telefono,
        nombre:   clientRecord.nombre,
      });
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
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
  };
}

module.exports = { runTurn, stripMarkdown };
