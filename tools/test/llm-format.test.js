/**
 * Verifica que el historial con tool-calls se convierta a un formato OpenAI
 * coherente (ids emparejados, content:null en el assistant) — lo que Gemini exige
 * o devuelve 400 INVALID_ARGUMENT.
 *   node tools/test/llm-format.test.js
 */
const assert = require('assert');
const { toOpenAiMessages } = require('../../src/llm/groq');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`✅ ${name}`); pass++; }
  catch (e) { console.log(`❌ ${name} — ${e.message}`); fail++; }
}

// Historial tal como lo arma conversation.js tras un tool call:
const toolUseBlock = { type: 'tool_use', id: 'call_abc123', name: 'save_client_info', input: { nombre: 'Axel' } };
const history = [
  { role: 'user', content: 'me llamo Axel' },
  { role: 'assistant', content: [toolUseBlock] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_abc123', content: 'Información guardada.' }] },
  { role: 'user', content: 'y tengo un Corsa' },
];

const out = toOpenAiMessages(history);

test('el assistant con tool_calls lleva content:null (no "")', () => {
  const a = out.find(m => m.role === 'assistant');
  assert(a, 'no hay mensaje assistant');
  assert(Array.isArray(a.tool_calls) && a.tool_calls.length === 1, 'sin tool_calls');
  assert.strictEqual(a.content, null, `content debe ser null, es: ${JSON.stringify(a.content)}`);
});

test('el id del tool_call coincide con el tool_call_id del resultado', () => {
  const a = out.find(m => m.role === 'assistant');
  const t = out.find(m => m.role === 'tool');
  assert(t, 'no hay mensaje role:tool');
  assert.strictEqual(a.tool_calls[0].id, t.tool_call_id, 'ids no emparejan → Gemini 400');
});

test('el mensaje de usuario posterior se preserva', () => {
  const last = out[out.length - 1];
  assert.strictEqual(last.role, 'user');
  assert.strictEqual(last.content, 'y tengo un Corsa');
});

test('un tool_use sin id igual produce ids emparejados', () => {
  // conversation.js copia block.id al tool_result; si el provider no dio id,
  // callOnce ya lo rellenó antes de llegar acá. Simulamos el caso ya rellenado.
  const b = { type: 'tool_use', id: 'gen_x', name: 'check_availability', input: {} };
  const h = [
    { role: 'assistant', content: [b] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'gen_x', content: 'ok' }] },
  ];
  const o = toOpenAiMessages(h);
  assert.strictEqual(o.find(m => m.role === 'assistant').tool_calls[0].id, o.find(m => m.role === 'tool').tool_call_id);
});

console.log(`\n— Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail} —`);
console.log(fail === 0 ? 'VEREDICTO: ✅ TODOS LOS TESTS PASARON' : 'VEREDICTO: ❌ HAY FALLOS');
process.exit(fail === 0 ? 0 : 1);
