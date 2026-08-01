/**
 * Seed de precios estándar (servicios básicos que el bot responde directo).
 *
 * PENDIENTE: el dueño del taller enviará la lista oficial de precios.
 * Llena el array PRECIOS y corre:  node tools/db/seed-precios-estandar.js
 *
 * Es idempotente: reemplaza todo el set activo cada vez que se corre.
 */
const pool = require('./client');

// ── Llenar con la lista del dueño ──────────────────────────────────────────────
// { servicio: 'Cambio de aceite', precio: 25.00, nota: 'incluye filtro' }
const PRECIOS = [
  // { servicio: '', precio: 0, nota: '' },
];

async function seed() {
  if (!PRECIOS.length) {
    console.log('[seed-precios] No hay precios cargados todavía. Edita PRECIOS en este archivo.');
    process.exit(0);
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Desactivar los actuales y reinsertar los nuevos (set limpio).
    await client.query('UPDATE precios_estandar SET activo = false');
    for (const p of PRECIOS) {
      await client.query(
        `INSERT INTO precios_estandar (servicio, precio, nota, activo)
         VALUES ($1, $2, $3, true)`,
        [p.servicio, p.precio, p.nota || null]
      );
    }
    await client.query('COMMIT');
    console.log(`[seed-precios] ${PRECIOS.length} precio(s) estándar cargados.`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('[seed-precios] error:', e.message);
  } finally {
    client.release();
    process.exit(0);
  }
}

seed();
