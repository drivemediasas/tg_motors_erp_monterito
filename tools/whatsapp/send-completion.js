const { sendMessage } = require('./send-message');

/**
 * Avisa al cliente por WhatsApp que su vehículo está listo para retirar.
 * Se dispara cuando una orden pasa a estado_orden = 'Completada'.
 */
async function sendCompletion(orden) {
  const shopName  = process.env.SHOP_NAME || 'TG Motors';
  const reviewUrl = process.env.GOOGLE_REVIEW_URL || '';

  const vehiculo = [orden.marca, orden.modelo].filter(Boolean).join(' ');
  const placa    = orden.placa ? ` (placa ${orden.placa})` : '';

  const lines = [
    `Hola ${orden.nombreCliente || ''} 👋`.trim(),
    ``,
    `¡Buenas noticias! Tu vehículo${vehiculo ? ` ${vehiculo}` : ''}${placa} ya está listo para retirar en ${shopName}. ✅`,
    ``,
    `Te esperamos en nuestro horario de atención. Si necesitas coordinar la entrega, escríbenos por aquí.`,
    reviewUrl ? `\nSi quedaste conforme, nos ayudaría mucho tu reseña 🌟\n${reviewUrl}` : null,
  ].filter(l => l !== null).join('\n');

  await sendMessage(orden.telefono, lines);
}

module.exports = { sendCompletion };
