const { sendMessage } = require('./send-message');

/**
 * Envía el resumen de una orden de trabajo al cliente por WhatsApp.
 */
async function sendOrder(orden) {
  const shopName = process.env.SHOP_NAME || 'TG Motors';

  const lines = [
    `Hola ${orden.nombreCliente} 👋`,
    ``,
    `Aquí está el resumen del trabajo para tu vehículo en ${shopName}:`,
    ``,
    `Placa: ${orden.placa || 'N/A'}`,
    `Vehículo: ${[orden.marca, orden.modelo, orden.anio].filter(Boolean).join(' ') || 'N/A'}`,
    orden.kilometraje ? `Kilometraje: ${orden.kilometraje} km` : null,
    ``,
    `Descripción del problema:`,
    orden.descripcionProblema || 'Sin descripción',
    ``,
    `Trabajos a realizar:`,
    orden.trabajos || 'Por definir',
    orden.repuestos ? `\nRepuestos necesarios:\n${orden.repuestos}` : null,
    ``,
    orden.tecnico ? `Técnico asignado: ${orden.tecnico}` : null,
    orden.tiempoEstimado ? `Tiempo estimado: ${orden.tiempoEstimado}h` : null,
    ``,
    `Para aprobar este trabajo, responde: APROBADO`,
    `Si tienes preguntas, escríbenos aquí.`,
  ].filter(l => l !== null).join('\n');

  await sendMessage(orden.telefono, lines);
}

module.exports = { sendOrder };
