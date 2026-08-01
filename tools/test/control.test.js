/**
 * Harness Conversation Control Layer — Etapa 2.
 * Funciones puras + fakes. Corre con: node tools/test/control.test.js
 */
const assert = require('assert');
const { shouldBotRespond, parseAdvisorCommand } = require('../../src/control');
const { combine } = require('../../src/batcher');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log(`✅ PASS — ${name}`); pass++; }
  catch (e) { console.log(`❌ FAIL — ${name} — ${e.message}`); fail++; }
}

const NOW = 1_000_000_000_000;
const base = { safeMode: false, isDuplicate: false, alreadyAnswered: false, isSpam: false,
  ownerType: 'BOT', conversationMode: 'BOT', lastHumanActivityMs: null, nowMs: NOW, targetMatches: true };

// owner=BOT → responde
test('owner=BOT → ALLOW_BOT', () => {
  assert.strictEqual(shouldBotRespond({ ...base }).decision, 'ALLOW_BOT');
});

// owner=HUMAN reciente → silent
test('owner=HUMAN activo → ALLOW_HUMAN (silent)', () => {
  const r = shouldBotRespond({ ...base, ownerType: 'HUMAN', lastHumanActivityMs: NOW - 5 * 60000 });
  assert.strictEqual(r.decision, 'ALLOW_HUMAN');
  assert.strictEqual(r.humanActive, true);
});

// owner=HUMAN pero venció timeout 20min → vuelve a permitir bot
test('owner=HUMAN vencido (>20min) → ALLOW_BOT (reactivación)', () => {
  const r = shouldBotRespond({ ...base, ownerType: 'HUMAN', lastHumanActivityMs: NOW - 21 * 60000 });
  assert.strictEqual(r.decision, 'ALLOW_BOT');
  assert.strictEqual(r.humanActive, false);
});

// duplicado / ya respondido → IGNORE (anti-loop, anti doble respuesta)
test('duplicado → IGNORE', () => {
  assert.strictEqual(shouldBotRespond({ ...base, isDuplicate: true }).decision, 'IGNORE');
});
test('alreadyAnswered (mismo messageId) → IGNORE (anti-loop)', () => {
  assert.strictEqual(shouldBotRespond({ ...base, alreadyAnswered: true }).decision, 'IGNORE');
});

// spam → IGNORE (responder una sola vez)
test('spam (hola×5) → IGNORE', () => {
  assert.strictEqual(shouldBotRespond({ ...base, isSpam: true }).decision, 'IGNORE');
});

// SAFE MODE → no responder
test('safeMode → ALLOW_HUMAN (no responder)', () => {
  assert.strictEqual(shouldBotRespond({ ...base, safeMode: true }).decision, 'ALLOW_HUMAN');
});

// destino incorrecto → ERROR
test('targetMatches=false → ERROR', () => {
  assert.strictEqual(shouldBotRespond({ ...base, targetMatches: false }).decision, 'ERROR');
});

// Comandos del asesor
test('comando #humano 593xxxx → take con target', () => {
  const c = parseAdvisorCommand('#humano 593987654321');
  assert.strictEqual(c.cmd, 'take');
  assert.strictEqual(c.target, '593987654321');
});
test('comando #bot 593xxxx → release con target', () => {
  const c = parseAdvisorCommand('#bot 0987654321');
  assert.strictEqual(c.cmd, 'release');
  assert.strictEqual(c.target, '0987654321');
});
test('"volver al bot" → release', () => {
  const c = parseAdvisorCommand('volver al bot');
  assert.strictEqual(c.cmd, 'release');
});
test('texto normal NO es comando', () => {
  assert.strictEqual(parseAdvisorCommand('cuántas órdenes hay hoy?'), null);
});

// Anti-race: agrupar 5 mensajes en uno
test('anti-race: combine(5 mensajes) → 1 texto', () => {
  const txt = combine(['hola', 'hola', 'hola', 'necesito', 'ayuda']);
  assert.strictEqual(txt.split('\n').length, 5);
  assert(txt.includes('necesito') && txt.includes('ayuda'));
});

// Aislamiento bajo carga: 100 conversaciones, decisión independiente por una
test('Aislamiento carga: 100 teléfonos, ninguno afecta la decisión de otro', () => {
  for (let i = 0; i < 100; i++) {
    const human = i % 2 === 0;
    const r = shouldBotRespond({ ...base, nowMs: NOW,
      ownerType: human ? 'HUMAN' : 'BOT',
      lastHumanActivityMs: human ? NOW - 60000 : null });
    assert.strictEqual(r.decision, human ? 'ALLOW_HUMAN' : 'ALLOW_BOT', `tel ${i} decidió mal`);
  }
});

console.log(`\n— Total: ${pass + fail} | Passed: ${pass} | Failed: ${fail} —`);
console.log(fail === 0 ? 'VEREDICTO: ✅ TODOS LOS TESTS PASARON' : 'VEREDICTO: ❌ HAY FALLOS');
process.exit(fail === 0 ? 0 : 1);
