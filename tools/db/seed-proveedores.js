/**
 * Cargador de PROVEEDORES.
 *
 * Cuando el dueño del taller mande la lista de números de sus proveedores,
 * se pegan aquí en PROVEEDORES y se sube el SEED_VERSION (ej. v1, v2...).
 * En el próximo deploy, `ensureSchema` corre este seed UNA vez por versión
 * (registrado en la tabla `_migraciones`), marcando cada número como proveedor.
 *
 * También se puede correr manual dentro de Railway:  node tools/db/seed-proveedores.js
 * (Localmente NO conecta: la BD usa host interno de Railway.)
 */
const { setProvidersBulk } = require('./mark-provider');

// ── Pegar aquí la lista del dueño (teléfono en formato 593XXXXXXXXX o 09XXXXXXXX) ──
// Ej: { telefono: '593999123456', nombre: 'Distribuidora Guaipes' }
const PROVEEDORES = [
  // (pendiente — el dueño enviará los números)
];

// Subir esta versión cada vez que se cambie la lista (dispara el re-seed en deploy).
const SEED_VERSION = 'v0';

async function seedProveedores() {
  if (!PROVEEDORES.length) {
    console.log('[seed-proveedores] lista vacía — nada que cargar (SEED_VERSION=' + SEED_VERSION + ')');
    return 0;
  }
  const n = await setProvidersBulk(PROVEEDORES);
  console.log(`[seed-proveedores] ${n} proveedor(es) marcados (SEED_VERSION=${SEED_VERSION})`);
  return n;
}

module.exports = { PROVEEDORES, SEED_VERSION, seedProveedores };

// Permite correrlo directo (dentro de Railway): node tools/db/seed-proveedores.js
if (require.main === module) {
  seedProveedores().then(() => process.exit(0)).catch((e) => { console.error(e.message); process.exit(1); });
}
