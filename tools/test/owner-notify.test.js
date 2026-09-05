/**
 * Tests del rate-limit / dedup de notificaciones al dueño.
 *   node tools/test/owner-notify.test.js
 */
const assert = require('assert');
const { registerAndCheck, _resetForTest, COOLDOWN_MS, DEDUP_MS } = require('../../src/owner-notify');

let pass = 0, fail = 0;
function test(name, fn) {
  try { _resetForTest(); fn(); console.log(`✅ PASS — ${name}`); pass++; }
  catch (e) { console.log(`❌ FAIL — ${name} — ${e.message}`); fail++; }
}

test('1ª notificación de una key → pasa', () => {
  const r = registerAndCheck('593999', 'EMERGENCIA A', 0);
  assert.strictEqual(r.suppress, false);
});

test('2ª notificación misma key dentro del cooldown → suprimida', () => {
  registerAndCheck('593999', 'EMERGENCIA A', 0);
  const r = registerAndCheck('593999', 'EMERGENCIA B (texto distinto)', 60_000);
  assert.strictEqual(r.suppress, true);
  assert.strictEqual(r.reason, 'cooldown_key');
});

test('misma key pasado el cooldown → pasa de nuevo', () => {
  registerAndCheck('593999', 'EMERGENCIA A', 0);
  const r = registerAndCheck('593999', 'EMERGENCIA C', COOLDOWN_MS + 1);
  assert.strictEqual(r.suppress, false);
});

test('otra key distinta → pasa aunque sea al mismo tiempo', () => {
  registerAndCheck('593999', 'EMERGENCIA A', 0);
  const r = registerAndCheck('593888', 'EMERGENCIA A', 1000);
  assert.strictEqual(r.suppress, true); // mismo texto → dedup_text
  assert.strictEqual(r.reason, 'dedup_text');
  const r2 = registerAndCheck('593777', 'OTRA COSA DISTINTA', 1000);
  assert.strictEqual(r2.suppress, false);
});

test('texto idéntico desde otra key dentro de DEDUP_MS → suprimido', () => {
  registerAndCheck('AAA', 'mismo mensaje exacto', 0);
  const r = registerAndCheck('BBB', 'mismo mensaje exacto', DEDUP_MS - 1);
  assert.strictEqual(r.suppress, true);
  assert.strictEqual(r.reason, 'dedup_text');
});

console.log(`\n— Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail} —`);
console.log(fail === 0 ? 'VEREDICTO: ✅ TODOS LOS TESTS PASARON' : 'VEREDICTO: ❌ HAY FALLOS');
process.exit(fail === 0 ? 0 : 1);
