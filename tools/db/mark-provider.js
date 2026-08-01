const pool = require('./client');

/**
 * Marca (o desmarca) un número como proveedor. Crea el contacto si no existe.
 * @param {string} telefono
 * @param {boolean} esProveedor
 * @param {string} [nombre]
 */
async function setProvider(telefono, esProveedor, nombre) {
  const tel = String(telefono || '').replace(/\D/g, '');
  if (!tel) return { ok: false };
  await pool.query(
    `INSERT INTO clientes (nombre, telefono, es_proveedor)
     VALUES ($1, $2, $3)
     ON CONFLICT (telefono) DO UPDATE SET es_proveedor = EXCLUDED.es_proveedor`,
    [nombre || 'Proveedor', tel, !!esProveedor]
  );
  return { ok: true, telefono: tel, esProveedor: !!esProveedor };
}

/**
 * Marca en lote una lista de proveedores. Idempotente.
 * @param {Array<{telefono:string, nombre?:string}>} lista
 * @returns {number} cantidad marcada
 */
async function setProvidersBulk(lista = []) {
  let n = 0;
  for (const p of lista) {
    const r = await setProvider(p.telefono, true, p.nombre);
    if (r.ok) n++;
  }
  return n;
}

module.exports = { setProvider, setProvidersBulk };
