/**
 * El bot NUNCA manda un mensaje que no pasó por el control.
 *   - Diego (OWNER_PHONE) no recibe NADA, nunca.
 *   - Los mensajes que no son texto (foto/audio/...) no generan ninguna respuesta.
 *   - Los envíos proactivos (cron) no van a Diego ni a proveedores.
 *   node tools/test/no-rogue-sends.test.js
 */
process.env.OWNER_PHONE = '593987189276';

const assert = require('assert');
const d360 = require('../../tools/whatsapp/360dialog-service');
const { canMessageProactively } = require('../../src/handlers/outbound');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); pass++; }
  catch (e) { console.log(`❌ ${name} — ${e.message}`); fail++; }
}

(async () => {
  await test('isBlockedRecipient reconoce OWNER_PHONE en cualquier formato', () => {
    assert.strictEqual(d360.isBlockedRecipient('593987189276'), true);
    assert.strictEqual(d360.isBlockedRecipient('+593 98 718 9276'), true);
    assert.strictEqual(d360.isBlockedRecipient('593-987-189-276'), true);
    assert.strictEqual(d360.isBlockedRecipient('593999648041'), false);
  });

  await test('d360.sendMessage a OWNER_PHONE → null, sin llamar a la API', async () => {
    const r = await d360.sendMessage('+593987189276', 'hola diego');
    assert.strictEqual(r, null);
  });

  await test('d360.sendTemplate a OWNER_PHONE → null', async () => {
    const r = await d360.sendTemplate('593987189276', 'tpl', []);
    assert.strictEqual(r, null);
  });

  await test('handleD360Inbound con una FOTO → nunca llama a sendMessage', async () => {
    const orig = d360.sendMessage;
    let calls = 0;
    d360.sendMessage = async () => { calls++; return {}; };
    try {
      const { handleD360Inbound } = require('../../src/handlers/360dialog');
      await handleD360Inbound({ entry: [{ changes: [{ value: {
        metadata: { display_phone_number: '593999999999' },
        contacts: [{ wa_id: '593900555111', profile: { name: 'Cliente' } }],
        messages: [{ from: '593900555111', id: 'wamid.PHOTO', type: 'image', image: { id: 'x' } }],
      } }] }] });
      assert.strictEqual(calls, 0, 'el bot NO debe responder a una foto');
    } finally { d360.sendMessage = orig; }
  });

  await test('canMessageProactively(OWNER_PHONE) → false', async () => {
    const g = await canMessageProactively('593987189276');
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.why, 'owner_phone');
  });

  console.log(`\n— Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail} —`);
  console.log(fail === 0 ? 'VEREDICTO: ✅ TODOS LOS TESTS PASARON' : 'VEREDICTO: ❌ HAY FALLOS');
  process.exit(fail === 0 ? 0 : 1);
})();
