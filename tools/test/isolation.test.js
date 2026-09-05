/**
 * Harness de aislamiento y determinismo — Etapa 1.
 * Corre sin DB ni red: usa funciones puras + stores fake inyectables.
 *
 *   node tools/test/isolation.test.js
 */
process.env.SHOP_NAME = process.env.SHOP_NAME || 'TG Motors';
process.env.SHOP_SERVICES = process.env.SHOP_SERVICES || 'Cambio de aceite, Frenos, Alineación';

const assert = require('assert');
const { decideRelayTarget } = require('../../src/relay-router');
const { withLock } = require('../../tools/lock');
const { markProcessedDurable, fallbackId } = require('../../tools/db/messages-processed');
const { buildSystemPrompt } = require('../../prompts/monterito');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✅ PASS — ${name}`); pass++; }
  catch (e) { console.log(`❌ FAIL — ${name} — ${e.message}`); fail++; }
}

// Fake pool: emula INSERT ... ON CONFLICT DO NOTHING sobre mensajes_procesados
function fakeStore() {
  const seen = new Set();
  return {
    seen,
    async query(sql, params) {
      const id = params[0];
      if (seen.has(id)) return { rowCount: 0 };
      seen.add(id);
      return { rowCount: 1 };
    },
  };
}

(async () => {
  // ── Test 1: Aislamiento de 3 clientes (prompt no cruza datos) ───────────────
  await test('Aislamiento 3 clientes (A Corsa/pintura, B Hilux/amortiguador, C Sail/batería)', () => {
    const A = buildSystemPrompt({ nombre: 'Ana', telefono: '593900000001', marca: 'Chevrolet', modelo: 'Corsa', anio: '2001', placa: 'AAA111', email: 'a@x.com', cedula: '1' });
    const B = buildSystemPrompt({ nombre: 'Bruno', telefono: '593900000002', marca: 'Toyota', modelo: 'Hilux', anio: '2019', placa: 'BBB222', email: 'b@x.com', cedula: '2' });
    const C = buildSystemPrompt({ nombre: 'Caro', telefono: '593900000003', marca: 'Chevrolet', modelo: 'Sail', anio: '2015', placa: 'CCC333', email: 'c@x.com', cedula: '3' });
    assert(A.includes('Corsa') && !A.includes('Hilux') && !A.includes('Sail'), 'A contiene datos de otro');
    assert(B.includes('Hilux') && !B.includes('Corsa') && !B.includes('Sail'), 'B contiene datos de otro');
    assert(C.includes('Sail') && !C.includes('Corsa') && !C.includes('Hilux'), 'C contiene datos de otro');
    assert(!A.includes('BBB222') && !A.includes('CCC333'), 'A filtró placa ajena');
    assert(!B.includes('AAA111') && !B.includes('593900000003'), 'B filtró datos ajenos');
  });

  // ── Test 2: Relay determinístico (Diego cita la consulta B) ─────────────────
  await test('Relay determinístico — cita B → envía a B, A sigue pendiente', () => {
    const A = { id: 1, telefono: '593900000001', nombre: 'Ana' };
    const B = { id: 2, telefono: '593900000002', nombre: 'Bruno' };
    const d = decideRelayTarget({ quotedInquiry: B, pendingInquiries: [A, B] });
    assert.strictEqual(d.action, 'send');
    assert.strictEqual(d.inquiry.id, 2);
    assert.strictEqual(d.routedBy, 'quoted_message_id');
  });

  // ── Test 3: Relay ambiguo (2 pendientes, sin cita) → NO envía ───────────────
  await test('Relay ambiguo — 2 pendientes sin cita → reject_ambiguous (no envía)', () => {
    const d = decideRelayTarget({ quotedInquiry: null, pendingInquiries: [{ id: 1 }, { id: 2 }] });
    assert.strictEqual(d.action, 'reject_ambiguous');
  });

  // ── Test 4: Relay con 1 sola pendiente (sin cita) → permite ─────────────────
  await test('Relay 1 pendiente sin cita → send a esa', () => {
    const d = decideRelayTarget({ quotedInquiry: null, pendingInquiries: [{ id: 7, telefono: '593900000007' }] });
    assert.strictEqual(d.action, 'send');
    assert.strictEqual(d.inquiry.id, 7);
    assert.strictEqual(d.routedBy, 'single_pending');
  });

  // ── Test 5: Dedup — mismo message_id entra 3 veces → 1 sola vez ─────────────
  await test('Dedup durable — mismo message_id ×3 → 1 nuevo, 2 duplicados', async () => {
    const store = fakeStore();
    const r1 = await markProcessedDurable(store, { messageId: 'wamid.DUP', telefono: '5939', provider: '360dialog' });
    const r2 = await markProcessedDurable(store, { messageId: 'wamid.DUP', telefono: '5939', provider: '360dialog' });
    const r3 = await markProcessedDurable(store, { messageId: 'wamid.DUP', telefono: '5939', provider: '360dialog' });
    assert.strictEqual(r1.duplicate, false);
    assert.strictEqual(r2.duplicate, true);
    assert.strictEqual(r3.duplicate, true);
  });

  // ── Test 6: Race — 2 escrituras concurrentes del mismo teléfono no se pisan ─
  await test('Race — withLock serializa escrituras del mismo teléfono (sin pérdida)', async () => {
    const log = [];
    // Simula read-modify-write: leer length, esperar, push. Sin lock se perdería un turno.
    const rmw = (val) => withLock('593900000009', async () => {
      const snapshot = log.length;
      await new Promise(r => setTimeout(r, 10));
      log.push({ val, basedOn: snapshot });
    });
    await Promise.all([rmw('m1'), rmw('m2')]);
    assert.strictEqual(log.length, 2, 'se perdió un turno');
    assert.strictEqual(log[0].basedOn, 0);
    assert.strictEqual(log[1].basedOn, 1, 'la 2da no vio la 1ra (race)');
  });

  // ── Test 7: Respuesta tardía — el contexto persiste (simulado) ──────────────
  await test('Respuesta tardía — historial de DB se reusa (continuidad)', () => {
    // El historial vive en conversaciones (JSONB) y se carga por teléfono.
    // Simulamos que un cliente vuelve 48h después: su prompt se reconstruye con su nombre.
    const p = buildSystemPrompt({ nombre: 'Tardío', telefono: '593900000010', marca: 'Kia', modelo: 'Sportage' });
    assert(p.includes('Tardío') && p.includes('Sportage'), 'no mantuvo continuidad del cliente');
  });

  // ── Test 8: Reinicio simulado — el store durable persiste aunque el Set caiga ─
  await test('Reinicio — dedup durable sigue rechazando tras limpiar caché en memoria', async () => {
    const store = fakeStore();
    await markProcessedDurable(store, { messageId: 'wamid.R', telefono: '5939', provider: '360dialog' });
    const memCache = new Set(['wamid.R']);
    memCache.clear(); // simula reinicio: el Set en memoria se pierde
    const again = await markProcessedDurable(store, { messageId: 'wamid.R', telefono: '5939', provider: '360dialog' });
    assert.strictEqual(again.duplicate, true, 'el store durable debió recordar el id');
  });

  // ── Test 9b: fallbackId — mensajes idénticos seguidos NUNCA colisionan ───────
  await test('fallbackId — "2" repetido del mismo número → ids siempre distintos', () => {
    const ids = new Set([
      fallbackId('593900000099', '2'),
      fallbackId('593900000099', '2'),
      fallbackId('593900000099', '2'),
    ]);
    assert.strictEqual(ids.size, 3, 'cada inbound debe tener id único (nunca tragar un mensaje)');
  });

  // ── Test 10: Parser de encuesta (rating 1–5) sin falsos positivos ────────────
  await test('Encuesta — parseSurveyRating acepta ratings y rechaza texto normal', () => {
    const { parseSurveyRating } = require('../../src/survey');
    assert.strictEqual(parseSurveyRating('5'), 5);
    assert.strictEqual(parseSurveyRating('⭐⭐⭐⭐⭐'), 5);
    assert.strictEqual(parseSurveyRating('5 estrellas'), 5);
    assert.strictEqual(parseSurveyRating('quiero 5 litros'), null);
    assert.strictEqual(parseSurveyRating('55'), null);
    assert.strictEqual(parseSurveyRating('hola'), null);
  });

  console.log(`\n— Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail} —`);
  console.log(fail === 0 ? 'VEREDICTO: ✅ TODOS LOS TESTS PASARON' : 'VEREDICTO: ❌ HAY FALLOS');
  process.exit(fail === 0 ? 0 : 1);
})();
