/**
 * Importa el catálogo de servicios y repuestos desde Base Emilio.xlsx
 * a la tabla `catalogo` de PostgreSQL.
 *
 * Uso:
 *   node tools/db/seed-catalog.js "datos-cliente/Base Emilio.xlsx"
 *
 * Estrategia X4/X6:
 *   - Si el precio X4 === X6 (o X6 es nulo): una sola entrada.
 *   - Si X4 ≠ X6: crea dos entradas —
 *       "SERVICIO"          → precio X4 (vehículos 4 cilindros)
 *       "SERVICIO (4x4/SUV)" → precio X6 (vehículos 6 cilindros / 4x4)
 *
 * Es seguro correrlo más de una vez: hace UPSERT (ON CONFLICT DO UPDATE) y deja
 * los precios idénticos al Excel (fuente de verdad).
 */
require('dotenv').config();
const XLSX = require('xlsx');
const pool = require('./client');

function clean(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === '' ? null : s;
}

function toNum(val) {
  if (val === null || val === undefined || val === '') return null;
  const n = parseFloat(String(val).replace(',', '.'));
  return isNaN(n) ? null : n;
}

async function insertItem(nombre, tipo, precio) {
  if (!nombre || precio === null) return false;
  // El Excel es la fuente de verdad: si el ítem ya existe, se ACTUALIZA su precio/tipo
  // y se reactiva. Así el catálogo queda 100% alineado con "Base Emilio.xlsx".
  const { rowCount } = await pool.query(
    `INSERT INTO catalogo (nombre, tipo, precio, activo)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (nombre) DO UPDATE SET
       tipo   = EXCLUDED.tipo,
       precio = EXCLUDED.precio,
       activo = true`,
    [nombre, tipo, precio]
  );
  return rowCount > 0;
}

async function seedMDO(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  let inserted = 0, skipped = 0;

  for (const row of rows) {
    const nombre = clean(row[1]);
    const precioX4 = toNum(row[2]);
    const precioX6 = toNum(row[3]);

    // Saltar encabezado y filas vacías
    if (!nombre || nombre.toLowerCase().includes('mano de obra') || precioX4 === null) {
      skipped++;
      continue;
    }

    // Entrada base (X4 o precio único)
    const ok = await insertItem(nombre, 'servicio', precioX4);
    if (ok) inserted++; else skipped++;

    // Entrada adicional para X6 si el precio difiere
    if (precioX6 !== null && precioX6 !== precioX4) {
      const nombreX6 = `${nombre} (4x4/SUV)`;
      const ok2 = await insertItem(nombreX6, 'servicio', precioX6);
      if (ok2) inserted++; else skipped++;
    }
  }

  return { inserted, skipped };
}

async function seedRepuestos(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

  let inserted = 0, skipped = 0;

  for (const row of rows) {
    const nombre = clean(row[0]);
    const precio = toNum(row[5]);

    // Saltar encabezado y filas vacías
    if (!nombre || nombre.toLowerCase().includes('repuestos') || precio === null) {
      skipped++;
      continue;
    }

    const ok = await insertItem(nombre, 'material', precio);
    if (ok) inserted++; else skipped++;
  }

  return { inserted, skipped };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Uso: node tools/db/seed-catalog.js <ruta/Base Emilio.xlsx>');
    process.exit(1);
  }

  console.log(`\nLeyendo: ${filePath}`);
  const wb = XLSX.readFile(filePath);

  const sheetMDO = wb.Sheets['PRECIOS MDO'];
  const sheetRep = wb.Sheets['PRECIOS REPUESTOS'];

  if (!sheetMDO || !sheetRep) {
    console.error('Error: El archivo debe contener las hojas "PRECIOS MDO" y "PRECIOS REPUESTOS".');
    process.exit(1);
  }

  console.log('\nImportando MANO DE OBRA...');
  const mdo = await seedMDO(sheetMDO);
  console.log(`  Insertados: ${mdo.inserted} | Saltados/duplicados: ${mdo.skipped}`);

  console.log('\nImportando REPUESTOS...');
  const rep = await seedRepuestos(sheetRep);
  console.log(`  Insertados: ${rep.inserted} | Saltados/duplicados: ${rep.skipped}`);

  console.log(`\n✓ Total insertados: ${mdo.inserted + rep.inserted}`);
  console.log('  Catálogo listo para producción.\n');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
