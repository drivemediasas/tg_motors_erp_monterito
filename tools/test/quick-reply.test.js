/**
 * Tests del fast-path determinístico (handleQuickReply / menuJustShown).
 * Un dígito suelto solo dispara el menú si el menú sigue "activo" (el cliente
 * solo mandó dígitos desde que se mostró).
 *   node tools/test/quick-reply.test.js
 */
process.env.SHOP_NAME     = process.env.SHOP_NAME     || 'TG Motors';
process.env.SHOP_HOURS    = process.env.SHOP_HOURS    || 'Lunes a Viernes 8:30-17:30';
process.env.SHOP_ADDRESS  = process.env.SHOP_ADDRESS  || 'Av. Siempre Viva 123';
process.env.SHOP_SERVICES = process.env.SHOP_SERVICES || 'Cambio de aceite, Frenos, Alineación';

const assert = require('assert');
const { handleQuickReply, menuJustShown } = require('../../src/handlers/message');

const MENU = 'Hola 👋 Soy Monterito, asistente de TG Motors.\n\nPuedo ayudarte con:\n1) Horario\n2) Dirección\n3) Servicios\n4) Precio\n5) Agendar\n\nResponde con el número o con tu pregunta directa.';
const HORARIO = 'Nuestro horario de atención es: Lunes a Viernes 8:30-17:30. ¿Deseas agendar una cita? 😊';

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✅ PASS — ${name}`); pass++; }
  catch (e) { console.log(`❌ FAIL — ${name} — ${e.message}`); fail++; }
}

(async () => {
  await test('menuJustShown: sin historial → true (primer contacto)', () => {
    assert.strictEqual(menuJustShown([]), true);
    assert.strictEqual(menuJustShown(null), true);
  });

  await test('menuJustShown: menú recién mostrado → true', () => {
    assert.strictEqual(menuJustShown([{ role: 'user', content: 'hola' }, { role: 'assistant', content: MENU }]), true);
  });

  await test('menuJustShown: picks en secuencia (menú, "1", horario) → sigue true', () => {
    const h = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: MENU },
      { role: 'user', content: '1' },
      { role: 'assistant', content: HORARIO },
    ];
    assert.strictEqual(menuJustShown(h), true);
  });

  await test('menuJustShown: texto libre después del menú → false', () => {
    const h = [
      { role: 'assistant', content: MENU },
      { role: 'user', content: 'tengo un corsa 2001' },
      { role: 'assistant', content: '¿El vehículo tiene 1 o 2 puertas afectadas?' },
    ];
    assert.strictEqual(menuJustShown(h), false);
  });

  await test('menuJustShown: nunca se mostró el menú → false', () => {
    assert.strictEqual(menuJustShown([{ role: 'assistant', content: 'Hola, ¿en qué te ayudo?' }]), false);
  });

  await test('"2" tras (menú, "1", horario) → dirección (flujo en secuencia)', async () => {
    const h = [
      { role: 'assistant', content: MENU },
      { role: 'user', content: '1' },
      { role: 'assistant', content: HORARIO },
    ];
    const r = await handleQuickReply('593900000001', '2', { allowMenu: menuJustShown(h) });
    assert(r && /Av\. Siempre Viva/.test(r), `esperaba dirección, dio: ${r}`);
  });

  await test('"2" respondiendo a "¿1 o 2 puertas?" → null (lo maneja el LLM)', async () => {
    const h = [
      { role: 'assistant', content: MENU },
      { role: 'user', content: 'tengo un corsa' },
      { role: 'assistant', content: '¿1 o 2 puertas?' },
    ];
    const r = await handleQuickReply('593900000001', '2', { allowMenu: menuJustShown(h) });
    assert.strictEqual(r, null);
  });

  await test('"horario" siempre responde el horario', async () => {
    const r = await handleQuickReply('593900000001', 'cuál es su horario', { allowMenu: false });
    assert(r && /horario/i.test(r));
  });

  console.log(`\n— Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail} —`);
  console.log(fail === 0 ? 'VEREDICTO: ✅ TODOS LOS TESTS PASARON' : 'VEREDICTO: ❌ HAY FALLOS');
  process.exit(fail === 0 ? 0 : 1);
})();
