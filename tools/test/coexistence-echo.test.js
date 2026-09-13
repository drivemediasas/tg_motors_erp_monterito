/**
 * Tests de detección de respuesta humana (coexistence) en src/handlers/360dialog.js.
 * Payloads según doc oficial Meta / 360dialog (`smb_message_echoes`).
 * No toca BD ni red: se inyectan módulos falsos vía require.cache.
 *   node tools/test/coexistence-echo.test.js
 */
const assert = require('assert');
const path = require('path');

function fake(rel, exportsObj) {
  const p = require.resolve(path.join(__dirname, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports: exportsObj };
}

// ── Dobles ────────────────────────────────────────────────────────────────────
const takeovers = [];
const processed = [];
fake('../db/client.js', { query: async () => ({ rows: [], rowCount: 0 }) });
fake('../db/conversation-state.js', { takeOverByHuman: async (tel, who, mode) => { takeovers.push({ tel, who, mode }); } });
fake('../db/messages-processed.js', { markProcessedDurable: async () => ({ duplicate: false }), fallbackId: (p, t) => `fb:${p}:${t}` });
fake('../../src/handlers/message.js', { processMessage: async (args) => { processed.push(args); } });
fake('../../src/guards.js', { getMediaAck: () => 'ack' });

// Servicio real de 360dialog (sin red): usamos sus guardas de eco.
const svc = require('../whatsapp/360dialog-service');
const { handleD360Inbound, parseD360Payload } = require('../../src/handlers/360dialog');
const { getMetrics } = require('../../src/metrics');

const SHOP = '593999000111';
const CUSTOMER = '593987654321';

const echoPayload = (over = {}) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA', changes: [{
    field: 'smb_message_echoes',
    value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: SHOP, phone_number_id: 'PNID' },
      message_echoes: [{ from: SHOP, to: CUSTOMER, id: 'wamid.ECHO1', timestamp: '1', type: 'text', text: { body: 'Hola, te confirmo la cita mañana 9am' }, ...over }],
    },
  }] }],
});
const inboundPayload = () => ({
  entry: [{ changes: [{ field: 'messages', value: {
    metadata: { display_phone_number: SHOP },
    contacts: [{ wa_id: CUSTOMER, profile: { name: 'Juan' } }],
    messages: [{ from: CUSTOMER, id: 'wamid.IN1', type: 'text', text: { body: 'hola' } }],
  } }] }],
});
const statusPayload = () => ({
  entry: [{ changes: [{ field: 'messages', value: {
    metadata: { display_phone_number: SHOP },
    statuses: [{ id: 'wamid.X', status: 'delivered', recipient_id: CUSTOMER }],
  } }] }],
});

(async () => {
  // parse: eco de la app → agentOutbound con el cliente correcto
  let p = parseD360Payload(echoPayload());
  assert.strictEqual(p.agentOutbound, true);
  assert.strictEqual(p.customer, CUSTOMER);
  assert.strictEqual(p.messageId, 'wamid.ECHO1');
  assert.strictEqual(p.source, 'smb_message_echoes');

  // parse: eco con `from` que no es el taller → se ignora (no asumir)
  p = parseD360Payload(echoPayload({ from: '593911111111' }));
  assert.strictEqual(p.ignore, true);

  // parse: eco de media (sin text) también cuenta como respuesta humana
  p = parseD360Payload(echoPayload({ type: 'image', text: undefined, image: { id: 'x' } }));
  assert.strictEqual(p.agentOutbound, true);
  assert.strictEqual(p.customer, CUSTOMER);

  // parse: mensaje entrante normal y status siguen igual que antes
  p = parseD360Payload(inboundPayload());
  assert.strictEqual(p.phone, CUSTOMER); assert.strictEqual(p.text, 'hola');
  p = parseD360Payload(statusPayload());
  assert.strictEqual(p.ignore, true);

  // handler: eco humano → takeOverByHuman(cliente) y NO se procesa como mensaje
  takeovers.length = 0; processed.length = 0;
  await handleD360Inbound(echoPayload());
  assert.deepStrictEqual(takeovers, [{ tel: CUSTOMER, who: 'admin', mode: 'HUMAN' }]);
  assert.strictEqual(processed.length, 0);

  // handler: eco con el MISMO id que envió el bot → ignorado (no se calla solo)
  takeovers.length = 0;
  // simular que el bot envió ese id (misma ruta interna que sendMessage)
  await handleD360Inbound(echoPayload({ id: 'wamid.BOT1', text: { body: 'texto del bot' } }));
  assert.strictEqual(takeovers.length, 1, 'sin registro previo, se trata como humano');

  // handler: eco cuyo TEXTO fue enviado por el bot hace poco → ignorado
  takeovers.length = 0;
  svc.__recordBotSentTextForTest('Gracias por escribir a TG Motors 🚗');
  await handleD360Inbound(echoPayload({ id: 'wamid.OTRO', text: { body: 'Gracias por escribir a TG Motors 🚗' } }));
  assert.strictEqual(takeovers.length, 0, 'el bot no debe callarse por su propio eco');

  // handler: mensaje entrante del cliente sigue llegando a processMessage
  takeovers.length = 0; processed.length = 0;
  await handleD360Inbound(inboundPayload());
  assert.strictEqual(processed.length, 1);
  assert.strictEqual(takeovers.length, 0);

  // handler: statuses no hacen nada
  processed.length = 0;
  await handleD360Inbound(statusPayload());
  assert.strictEqual(processed.length, 0);

  // métricas expuestas en /health
  const m = getMetrics().metrics;
  assert.ok(m.humanEchoDetected >= 2, 'humanEchoDetected=' + m.humanEchoDetected);
  assert.ok(m.botEchoIgnored >= 1, 'botEchoIgnored=' + m.botEchoIgnored);

  console.log('✅ coexistence-echo.test.js OK');
})().catch((e) => { console.error('❌', e); process.exit(1); });
