const { searchClient }        = require('../tools/db/search-client');
const { getClientHistory }    = require('../tools/db/get-client-history');
const { getTechnicianSchedule }= require('../tools/db/get-technician-schedule');
const { getPendingPriceInquiries, answerPriceInquiry } = require('../tools/db/price-inquiries');
const { sendMessage }         = require('../tools/whatsapp/send-message');
const { stripMarkdown }        = require('./conversation');
const { runGroqChat }         = require('./llm/groq');
const pool                     = require('../tools/db/client');

const ADMIN_TOOLS = [
  {
    name: 'buscar_cliente',
    description: 'Busca un cliente por nombre, placa o teléfono en la base de datos.',
    input_schema: { type: 'object', properties: { q: { type: 'string', description: 'Texto de búsqueda' } }, required: ['q'] },
  },
  {
    name: 'historial_cliente',
    description: 'Devuelve el historial de servicios y órdenes de un cliente por teléfono.',
    input_schema: { type: 'object', properties: { telefono: { type: 'string' } }, required: ['telefono'] },
  },
  {
    name: 'ordenes_activas',
    description: 'Lista las órdenes de trabajo abiertas (En proceso o Pendiente) del día o de una fecha.',
    input_schema: {
      type: 'object',
      properties: { fecha: { type: 'string', description: 'Fecha YYYY-MM-DD (opcional, default hoy)' } },
    },
  },
  {
    name: 'orden_por_placa',
    description: 'Busca la orden de trabajo activa de un vehículo por placa.',
    input_schema: { type: 'object', properties: { placa: { type: 'string' } }, required: ['placa'] },
  },
  {
    name: 'agenda_tecnico',
    description: 'Muestra el horario del día de un técnico: qué trabajos tiene y cuándo.',
    input_schema: {
      type: 'object',
      properties: {
        tecnico: { type: 'string' },
        fecha:   { type: 'string', description: 'Fecha YYYY-MM-DD (opcional, default hoy)' },
      },
      required: ['tecnico'],
    },
  },
  {
    name: 'reincidencias_recientes',
    description: 'Muestra las últimas reincidencias detectadas en el taller.',
    input_schema: { type: 'object', properties: { limite: { type: 'number', description: 'Cuántas mostrar (default 10)' } } },
  },
  {
    name: 'responder_consulta_precio',
    description: 'Reenvía al cliente la respuesta de una consulta de precio pendiente. Úsala cuando el dueño dé un precio para una consulta pendiente. Escribe un mensaje completo y amable para el cliente.',
    input_schema: {
      type: 'object',
      properties: {
        telefono: { type: 'string', description: 'Teléfono del cliente que hizo la consulta (sin +)' },
        mensaje:  { type: 'string', description: 'Mensaje completo y amable para el cliente con el precio o respuesta' },
      },
      required: ['telefono', 'mensaje'],
    },
  },
];

async function executeAdminTool(name, input) {
  if (name === 'buscar_cliente') {
    const results = await searchClient(input.q);
    if (!results.length) return 'No se encontró ningún cliente con ese criterio.';
    return results.map(c =>
      `• ${c.nombre} | Tel: ${c.telefono} | Placa: ${c.placa || '-'} | ${c.marca || ''} ${c.modelo || ''} ${c.anio || ''}`
    ).join('\n');
  }

  if (name === 'historial_cliente') {
    const hist = await getClientHistory(input.telefono);
    if (!hist.length) return 'Este cliente no tiene servicios registrados.';
    return hist.map(h =>
      `• ${h.fecha} — ${h.servicio_solicitado || 'Servicio'} | Estado: ${h.estado_orden || h.estado} | Técnico: ${h.tecnico || '-'}`
    ).join('\n');
  }

  if (name === 'ordenes_activas') {
    const fecha = input.fecha || new Date().toISOString().split('T')[0];
    const { rows } = await pool.query(
      `SELECT c.nombre_cliente, c.telefono, c.servicio_solicitado,
              c.fecha::text, c.estado_orden, c.tecnico, c.trabajos,
              cl.placa, cl.marca, cl.modelo
       FROM citas c LEFT JOIN clientes cl ON cl.telefono = c.telefono
       WHERE c.fecha = $1 AND c.estado IN ('Pendiente','En proceso')
       ORDER BY c.created_at`,
      [fecha]
    );
    if (!rows.length) return `No hay órdenes activas el ${fecha}.`;
    return rows.map(r =>
      `• ${r.nombre_cliente} | Placa: ${r.placa || '-'} | ${r.marca || ''} ${r.modelo || ''}\n  Servicio: ${r.servicio_solicitado || '-'} | Técnico: ${r.tecnico || 'Sin asignar'} | Estado: ${r.estado_orden}`
    ).join('\n\n');
  }

  if (name === 'orden_por_placa') {
    const { rows } = await pool.query(
      `SELECT c.id, c.nombre_cliente, c.fecha::text, c.estado_orden,
              c.descripcion_problema, c.trabajos, c.repuestos, c.tecnico,
              c.kilometraje, cl.marca, cl.modelo, cl.anio
       FROM citas c LEFT JOIN clientes cl ON cl.telefono = c.telefono
       WHERE cl.placa ILIKE $1 AND c.estado IN ('Pendiente','En proceso')
       ORDER BY c.fecha DESC LIMIT 1`,
      [input.placa]
    );
    if (!rows.length) return `No hay orden activa para la placa ${input.placa}.`;
    const r = rows[0];
    return [
      `Orden #${r.id} — ${r.nombre_cliente}`,
      `Vehículo: ${r.marca || ''} ${r.modelo || ''} ${r.anio || ''} | KM: ${r.kilometraje || 'N/A'}`,
      `Fecha: ${r.fecha} | Técnico: ${r.tecnico || 'Sin asignar'} | Estado: ${r.estado_orden}`,
      r.descripcion_problema ? `Problema: ${r.descripcion_problema}` : null,
      r.trabajos ? `Trabajos: ${r.trabajos}` : null,
      r.repuestos ? `Repuestos: ${r.repuestos}` : null,
    ].filter(Boolean).join('\n');
  }

  if (name === 'agenda_tecnico') {
    const fecha = input.fecha || new Date().toISOString().split('T')[0];
    const agenda = await getTechnicianSchedule(input.tecnico, fecha);
    if (!agenda.length) return `No hay slots registrados para ${input.tecnico} el ${fecha}.`;
    return agenda.map(s =>
      `${s.hora} — ${s.disponible ? 'Libre' : `Ocupado: ${s.nombre_cliente || ''} (${s.servicio_solicitado || '-'})`}`
    ).join('\n');
  }

  if (name === 'reincidencias_recientes') {
    const limit = input.limite || 10;
    const { rows } = await pool.query(
      `SELECT cliente_nombre, placa, tecnico, trabajo_original, fecha_original::text,
              fecha_regreso::text, misma_falla, estado
       FROM reincidencias ORDER BY created_at DESC LIMIT $1`,
      [limit]
    );
    if (!rows.length) return 'No hay reincidencias registradas.';
    return rows.map(r =>
      `• ${r.cliente_nombre} | Placa: ${r.placa || '-'} | Técnico: ${r.tecnico || '-'}\n  Trabajo: ${r.trabajo_original || '-'} (${r.fecha_original}) → Regreso: ${r.fecha_regreso} | ${r.misma_falla ? 'MISMA FALLA' : 'Falla a confirmar'} | ${r.estado}`
    ).join('\n\n');
  }

  if (name === 'responder_consulta_precio') {
    const inquiry = await answerPriceInquiry(input.telefono, input.mensaje);
    await sendMessage(input.telefono, input.mensaje);
    console.log(`[responder_consulta_precio] respuesta enviada a ${input.telefono} (inquiry ${inquiry ? inquiry.id : 'no encontrada'})`);
    return inquiry
      ? `Respuesta enviada al cliente ${inquiry.nombre || ''} (${input.telefono}). Consulta marcada como respondida.`
      : `Mensaje enviado a ${input.telefono}. (No había una consulta pendiente registrada para ese número, pero el mensaje se envió igual.)`;
  }

  return 'Herramienta no reconocida.';
}

function buildAdminPrompt(pendingInquiries = [], replyContext = null) {
  const shopName = process.env.SHOP_NAME || 'TG Motors';
  const ownerName = process.env.OWNER_NAME || 'Dueño';

  let pendingBlock = '';
  if (pendingInquiries.length) {
    const list = pendingInquiries
      .map(q => `- ${q.nombre || 'Cliente'} (${q.telefono}): "${q.pregunta}"`)
      .join('\n');
    pendingBlock = `\n\nCONSULTAS PENDIENTES (clientes esperando tu respuesta):
${list}

CÓMO RESPONDER (IMPORTANTE — el cliente está esperando, no lo dejes sin respuesta):
1. Cuando Diego dé un precio o información, usa responder_consulta_precio DE UNA VEZ con el teléfono del cliente y un mensaje completo y amable. NO esperes una confirmación extra de Diego.
2. Si hay UNA sola consulta pendiente, o Diego citó/respondió la notificación de un cliente puntual, ESA es la destinataria: envíasela directo.
3. Después de enviar, avísale a Diego a quién se lo reenviaste (ej: "✅ Listo, le reenvié a Mauricio.").
4. SOLO si hay VARIAS consultas pendientes y de verdad no está claro a cuál corresponde, pregúntale a Diego a cuál antes de enviar. Nunca adivines en ese caso.`;
  }

  const replyBlock = replyContext ? `\n\nCONTEXTO DE ESTE MENSAJE: ${replyContext}` : '';

  return `Eres el asistente ERP de ${shopName}. Respondes SOLO al dueño del taller (${ownerName}).
Tienes acceso a toda la base de datos del taller: clientes, órdenes de trabajo, agenda de técnicos y reincidencias.

Cuando el dueño pregunte por un carro, cliente o trabajo, usa las herramientas disponibles para traer la información exacta.
Responde de forma concisa, directa y en español. Sin formalismos — es el dueño del taller.${pendingBlock}${replyBlock}

FORMATO: Solo texto plano. Sin asteriscos, sin markdown.`;
}

async function runAdminTurn(history, userMessage, replyContext = null) {
  const messages = [...history, { role: 'user', content: userMessage }];
  let pendingInquiries = [];
  try {
    pendingInquiries = await getPendingPriceInquiries();
  } catch (e) {
    console.error('[runAdminTurn] no se pudieron cargar consultas pendientes:', e.message);
  }
  const prompt = buildAdminPrompt(pendingInquiries, replyContext);

  let response = await runGroqChat({
    maxTokens: 1024,
    system: prompt,
    tools: ADMIN_TOOLS, messages,
  });

  let totalInput  = response.usage?.input_tokens  || 0;
  let totalOutput = response.usage?.output_tokens || 0;

  while (response.stop_reason === 'tool_use') {
    const toolResults = [];
    for (const block of response.content.filter(b => b.type === 'tool_use')) {
      const result = await executeAdminTool(block.name, block.input);
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: toolResults });
    response = await runGroqChat({
      maxTokens: 1024,
      system: prompt,
      tools: ADMIN_TOOLS, messages,
    });
    totalInput  += response.usage?.input_tokens  || 0;
    totalOutput += response.usage?.output_tokens || 0;
  }

  const textBlock = response.content.find(b => b.type === 'text');
  const raw = textBlock ? textBlock.text : 'No pude procesar tu consulta.';
  return {
    reply: stripMarkdown(raw),
    usage: { input: totalInput, output: totalOutput },
  };
}

module.exports = { runAdminTurn };
