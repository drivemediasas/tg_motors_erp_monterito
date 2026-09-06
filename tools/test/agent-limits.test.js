/**
 * Tests del tope del loop agéntico y del bloqueo de side-effects repetidos.
 *   node tools/test/agent-limits.test.js
 */
const assert = require('assert');
const {
  MAX_TOOL_ITERATIONS,
  SIDE_EFFECT_TOOLS,
  filterRepeatedSideEffects,
} = require('../../src/agent-limits');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`✅ PASS — ${name}`); pass++; }
  catch (e) { console.log(`❌ FAIL — ${name} — ${e.message}`); fail++; }
}

test('MAX_TOOL_ITERATIONS es un tope chico y positivo', () => {
  assert(MAX_TOOL_ITERATIONS >= 2 && MAX_TOOL_ITERATIONS <= 8);
});

test('alert_owner y responder_consulta_precio son side-effect', () => {
  assert(SIDE_EFFECT_TOOLS.has('alert_owner'));
  assert(SIDE_EFFECT_TOOLS.has('responder_consulta_precio'));
  assert(SIDE_EFFECT_TOOLS.has('book_appointment'));
});

test('2º alert_owner en el mismo turno → bloqueado', () => {
  const ran = new Set(['alert_owner']);
  const blocks = [{ id: 'b1', name: 'alert_owner', input: {} }];
  const { toRun, blocked } = filterRepeatedSideEffects(blocks, ran);
  assert.strictEqual(toRun.length, 0);
  assert.strictEqual(blocked.length, 1);
  assert.strictEqual(blocked[0].tool_use_id, 'b1');
  assert(/ya se ejecutó/i.test(blocked[0].content));
});

test('check_availability (read-only) repetido → permitido', () => {
  const ran = new Set(['check_availability']);
  const blocks = [{ id: 'b2', name: 'check_availability', input: {} }];
  const { toRun, blocked } = filterRepeatedSideEffects(blocks, ran);
  assert.strictEqual(toRun.length, 1);
  assert.strictEqual(blocked.length, 0);
});

test('primer uso de un side-effect → permitido', () => {
  const ran = new Set();
  const blocks = [{ id: 'b3', name: 'book_appointment', input: {} }];
  const { toRun, blocked } = filterRepeatedSideEffects(blocks, ran);
  assert.strictEqual(toRun.length, 1);
  assert.strictEqual(blocked.length, 0);
});

test('mezcla: uno nuevo permitido + uno repetido bloqueado', () => {
  const ran = new Set(['alert_owner']);
  const blocks = [
    { id: 'a', name: 'alert_owner', input: {} },
    { id: 'b', name: 'precio_servicio', input: {} },
  ];
  const { toRun, blocked } = filterRepeatedSideEffects(blocks, ran);
  assert.deepStrictEqual(toRun.map(b => b.id), ['b']);
  assert.deepStrictEqual(blocked.map(b => b.tool_use_id), ['a']);
});

console.log(`\n— Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail} —`);
console.log(fail === 0 ? 'VEREDICTO: ✅ TODOS LOS TESTS PASARON' : 'VEREDICTO: ❌ HAY FALLOS');
process.exit(fail === 0 ? 0 : 1);
