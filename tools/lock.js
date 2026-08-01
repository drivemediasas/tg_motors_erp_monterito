/**
 * Lock async por clave (sin dependencias).
 * Serializa las ejecuciones que comparten la misma `key` (ej. el mismo wa_id),
 * mientras que claves distintas corren en paralelo. Evita race read-modify-write
 * sobre el historial del mismo número.
 */

const _chains = new Map(); // key → Promise (cola)

/**
 * Ejecuta `fn` en exclusión mutua para `key`.
 * @param {string} key
 * @param {() => Promise<any>} fn
 */
async function withLock(key, fn) {
  const prev = _chains.get(key) || Promise.resolve();

  let release;
  const gate = new Promise((res) => { release = res; });
  const mine = prev.then(() => gate);
  _chains.set(key, mine); // el siguiente esperará a que liberemos `gate`

  await prev;             // esperar el turno
  console.log('[lock] lock_acquired', { key });
  try {
    return await fn();
  } catch (err) {
    console.error('[lock] lock_error', { key, error: err.message });
    throw err;
  } finally {
    release();            // libera al siguiente en la cola
    console.log('[lock] lock_released', { key });
    if (_chains.get(key) === mine) _chains.delete(key); // limpieza si nadie más encoló
  }
}

module.exports = { withLock };
