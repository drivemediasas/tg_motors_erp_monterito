/**
 * Tests del fast-path determinístico (handleQuickReply / menuJustShown).
 * Verifica que un dígito suelto NO dispare el menú si el bot no acaba de mostrarlo.
 *   node tools/test/quick-reply.test.js
 */
process.env.SHOP_NAME     = process.env.SHOP_NAME     || 'TG Motors';
process.env.SHOP_HOURS    = process.env.SHOP_HOURS    || 'Lunes a Viernes 8:30-17:30';
process.env.SHOP_ADDRESS  = process.env.SHOP_ADDRESS  || 'Av. Siempre Viva 123';
process.env.SHOP_SERVICES = process.env.SHOP_SERVICES || 'Cambio de aceite, Frenos, Alineación';

const assert = require('assert');
const { handleQuickReply, menuJustShown } = require('../../src/handlers/message');

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

  await test('menuJustShown: último assistant con menú numerado → true', () => {
    const h = [{ role: 'assistant', content: 'Puedo ayudarte con:\n1) Horario\n2) Dirección\n3) Servicios' }];
    assert.strictEqual(menuJustShown(h), true);
  });

  await test('menuJustShown: último assistant es una pregunta normal → false', () => {
    const h = [
      { role: 'assistant', content: 'Puedo ayudarte con:\n1) Horario\n2) Dirección' },
      { role: 'user', content: 'tengo un corsa' },
      { role: 'assistant', content: '¿El vehículo tiene 1 o 2 puertas afectadas?' },
    ];
    assert.strictEqual(menuJustShown(h), false);
  });

  await test('"2" con allowMenu=false → null (no responde la dirección)', async () => {
    const r = await handleQuickReply('593900000001', '2', { allowMenu: false });
    assert.strictEqual(r, null);
  });

  await test('"2" con allowMenu=true → dirección', async () => {
    const r = await handleQuickReply('593900000001', '2', { allowMenu: true });
    assert(r && /Av\. Siempre Viva/.test(r));
  });

  await test('"horario" siempre responde el horario, con o sin allowMenu', async () => {
    const a = await handleQuickReply('593900000001', 'cuál es su horario', { allowMenu: false });
    assert(a && /horario/i.test(a));
  });

  await test('"1" con allowMenu=false → null', async () => {
    const r = await handleQuickReply('593900000001', '1', { allowMenu: false });
    assert.strictEqual(r, null);
  });

  console.log(`\n— Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail} —`);
  console.log(fail === 0 ? 'VEREDICTO: ✅ TODOS LOS TESTS PASARON' : 'VEREDICTO: ❌ HAY FALLOS');
  process.exit(fail === 0 ? 0 : 1);
})();
