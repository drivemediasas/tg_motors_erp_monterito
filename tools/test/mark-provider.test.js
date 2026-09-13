/**
 * Tests de tools/db/mark-provider.js y del seed de proveedores.
 * No toca la BD real: se inyecta un pool falso vía require.cache.
 *   node tools/test/mark-provider.test.js
 */
const assert = require('assert');
const path = require('path');

// ── Pool falso ────────────────────────────────────────────────────────────────
const calls = [];
let updateRowCount = 0;
const fakePool = {
  query: async (sql, params) => {
    calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
    if (/^UPDATE clientes/.test(sql.trim())) return { rowCount: updateRowCount, rows: [] };
    return { rowCount: 1, rows: [] };
  },
};
const clientPath = require.resolve(path.join(__dirname, '../db/client.js'));
require.cache[clientPath] = { id: clientPath, filename: clientPath, loaded: true, exports: fakePool };

const { setProvider, setProvidersBulk, normalizeEcPhone } = require('../db/mark-provider');
const { PROVEEDORES, SEED_VERSION } = require('../db/seed-proveedores');

(async () => {
  // normalizeEcPhone
  assert.strictEqual(normalizeEcPhone('0987868018'), '593987868018');
  assert.strictEqual(normalizeEcPhone('+593 98 786 8018'), '593987868018');
  assert.strictEqual(normalizeEcPhone('593987868018'), '593987868018');
  assert.strictEqual(normalizeEcPhone('987868018'), '593987868018');
  assert.strictEqual(normalizeEcPhone('‪0986169056‬'), '593986169056'); // chars invisibles del CSV
  assert.strictEqual(normalizeEcPhone(''), '');
  assert.strictEqual(normalizeEcPhone(null), '');

  // setProvider: fila existente (otro formato) → UPDATE, sin INSERT duplicado
  calls.length = 0; updateRowCount = 1;
  let r = await setProvider('0987868018', true, 'Andrés');
  assert.deepStrictEqual(r, { ok: true, telefono: '593987868018', esProveedor: true, updated: 1 });
  assert.strictEqual(calls.length, 1);
  assert.ok(/^UPDATE clientes/.test(calls[0].sql));
  assert.deepStrictEqual(calls[0].params, ['987868018', true]);

  // setProvider: no existe → INSERT en formato canónico 593...
  calls.length = 0; updateRowCount = 0;
  r = await setProvider('0987868018', true, 'Andrés');
  assert.deepStrictEqual(r, { ok: true, telefono: '593987868018', esProveedor: true, created: true });
  assert.strictEqual(calls.length, 2);
  assert.ok(/^INSERT INTO clientes/.test(calls[1].sql));
  assert.deepStrictEqual(calls[1].params, ['Andrés', '593987868018', true]);

  // setProvider: desmarcar (#cliente)
  calls.length = 0; updateRowCount = 1;
  r = await setProvider('593987868018', false);
  assert.strictEqual(r.esProveedor, false);
  assert.deepStrictEqual(calls[0].params, ['987868018', false]);

  // setProvider: teléfono vacío → no toca la BD
  calls.length = 0;
  r = await setProvider('', true);
  assert.deepStrictEqual(r, { ok: false });
  assert.strictEqual(calls.length, 0);

  // setProvidersBulk: un fallo no frena el resto
  calls.length = 0; updateRowCount = 1;
  const origQuery = fakePool.query;
  let n = 0;
  fakePool.query = async (sql, params) => { n++; if (n === 2) throw new Error('boom'); return origQuery(sql, params); };
  const marked = await setProvidersBulk([{ telefono: '0991' + '000001' }, { telefono: '0991000002' }, { telefono: '0991000003' }]);
  fakePool.query = origQuery;
  assert.strictEqual(marked, 2);

  // Seed: lista cargada, sin duplicados, formato canónico, versión subida
  assert.strictEqual(SEED_VERSION, 'v1');
  assert.strictEqual(PROVEEDORES.length, 89);
  assert.strictEqual(new Set(PROVEEDORES.map((p) => p.telefono)).size, 89);
  for (const p of PROVEEDORES) {
    assert.ok(/^593\d{9}$/.test(p.telefono), 'formato inválido: ' + p.telefono);
    assert.ok(p.nombre && p.nombre.trim().length > 0, 'sin nombre: ' + p.telefono);
  }
  const owner = (process.env.OWNER_PHONE || '593987189276').replace(/\D/g, '');
  assert.ok(!PROVEEDORES.some((p) => p.telefono === owner), 'OWNER_PHONE no puede estar en la lista de proveedores');

  console.log('✅ mark-provider.test.js OK');
})().catch((e) => { console.error('❌', e); process.exit(1); });
