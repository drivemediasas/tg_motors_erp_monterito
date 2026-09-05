/**
 * Lock async por clave (sin dependencias).
 * Serializa las ejecuciones que comparten la misma `key` (ej. el mismo wa_id),
 * mientras que claves distintas corren en paralelo. Evita race read-modify-write
 * sobre el historial del mismo número.
 *
 * Watchdog: si `fn()` cuelga más de `timeoutMs`, se corta con error y se libera
 * la cola. Sin esto, un turno colgado (LLM/DB) congelaría para siempre todos los
 * mensajes siguientes de ese cliente.
 */

const LOCK_TIMEOUT_MS = parseInt(process.env.LOCK_TIMEOUT_MS || '45000', 10);

const _chains = new Map(); // key → Promise (cola)

/**
 * Ejecuta `fn` en exclusión mutua para `key`, con watchdog.
 * @param {string} key
 * @param {() => Promise<any>} fn
 * @param {{ timeoutMs?: number }} [opts]
 */
async function withLock(key, fn, opts = {}) {
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : LOCK_TIMEOUT_MS;
  const prev = _chains.get(key) || Promise.resolve();

  let release;
  const gate = new Promise((res) => { release = res; });
  const mine = prev.then(() => gate);
  _chains.set(key, mine); // el siguiente esperará a que liberemos `gate`

  await prev;             // esperar el turno
  console.log('[lock] lock_acquired', { key });

  let timer;
  const watchdog = new Promise((_, reject) => {
    timer = setTimeout(() => {
      console.error('[lock] watchdog_timeout', { key, timeoutMs });
      reject(new Error('turn watchdog timeout'));
    }, timeoutMs);
  });

  const work = Promise.resolve().then(fn);
  work.catch(() => {}); // evita unhandledRejection si el watchdog gana la carrera

  try {
    return await Promise.race([work, watchdog]);
  } catch (err) {
    console.error('[lock] lock_error', { key, error: err.message });
    throw err;
  } finally {
    clearTimeout(timer);
    release();            // libera al siguiente en la cola
    console.log('[lock] lock_released', { key });
    if (_chains.get(key) === mine) _chains.delete(key); // limpieza si nadie más encoló
  }
}

module.exports = { withLock, LOCK_TIMEOUT_MS };
