const pool = require('./client');

/**
 * Normaliza un teléfono ecuatoriano al formato en que WhatsApp lo envía: 593XXXXXXXXX.
 *  - '0987868018'   → '593987868018'
 *  - '+593 98 786 8018' → '593987868018'
 *  - '987868018'    → '593987868018'
 * Devuelve '' si no quedan dígitos.
 */
function normalizeEcPhone(telefono) {
  let tel = String(telefono || '').replace(/\D/g, '');
  if (!tel) return '';
  if (tel.startsWith('593')) return tel;
  if (tel.startsWith('0')) tel = tel.slice(1);
  if (tel.length === 9) return '593' + tel;
  return tel;
}

/**
 * Marca (o desmarca) un número como proveedor. Crea el contacto si no existe.
 *
 * Importante: si el número YA existe en `clientes` con otro formato (ej. guardado
 * como 0987... o +593... porque escribió antes al bot), se actualiza ESA fila en vez
 * de crear una duplicada. Si no, `getClient` (que prefiere la coincidencia exacta)
 * podría devolver la fila vieja con es_proveedor=false y el bot le seguiría respondiendo.
 *
 * @param {string} telefono
 * @param {boolean} esProveedor
 * @param {string} [nombre]
 */
async function setProvider(telefono, esProveedor, nombre) {
  const tel = normalizeEcPhone(telefono);
  if (!tel) return { ok: false };
  const last9 = tel.slice(-9);

  // 1) Actualizar cualquier fila existente que sea el mismo celular (últimos 9 dígitos).
  const upd = await pool.query(
    `UPDATE clientes SET es_proveedor = $2
      WHERE RIGHT(regexp_replace(telefono,'\\D','','g'), 9) = $1`,
    [last9, !!esProveedor]
  );
  if (upd.rowCount > 0) return { ok: true, telefono: tel, esProveedor: !!esProveedor, updated: upd.rowCount };

  // 2) No existía → crear el contacto en formato canónico 593...
  await pool.query(
    `INSERT INTO clientes (nombre, telefono, es_proveedor)
     VALUES ($1, $2, $3)
     ON CONFLICT (telefono) DO UPDATE SET es_proveedor = EXCLUDED.es_proveedor`,
    [nombre || 'Proveedor', tel, !!esProveedor]
  );
  return { ok: true, telefono: tel, esProveedor: !!esProveedor, created: true };
}

/**
 * Marca en lote una lista de proveedores. Idempotente.
 * @param {Array<{telefono:string, nombre?:string}>} lista
 * @returns {number} cantidad marcada
 */
async function setProvidersBulk(lista = []) {
  let n = 0;
  for (const p of lista) {
    try {
      const r = await setProvider(p.telefono, true, p.nombre);
      if (r.ok) n++;
    } catch (e) {
      // Un número malo no debe frenar el resto de la lista.
      console.error('[mark-provider] fallo con', p.telefono, e.message);
    }
  }
  return n;
}

module.exports = { setProvider, setProvidersBulk, normalizeEcPhone };
