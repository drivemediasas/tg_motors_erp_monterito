/**
 * Importa datos históricos desde XLSX a PostgreSQL.
 *
 * Uso (un solo archivo con hojas Clientes + Citas):
 *   node tools/db/import-xlsx.js TG_MOTORS_AIRTABLE.xlsx
 *
 * Uso (dos archivos separados):
 *   node tools/db/import-xlsx.js clientes.xlsx citas.xlsx
 *
 * El script hace upsert — es seguro correrlo más de una vez.
 */
require('dotenv').config();
const XLSX = require('xlsx');
const pool = require('./client');

// Normaliza nombre de columna: minúsculas, sin tildes, sin puntos, espacios→_
function norm(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function pick(row, ...aliases) {
  const keys = Object.keys(row).reduce((m, k) => { m[norm(k)] = k; return m; }, {});
  for (const alias of aliases) {
    const real = keys[norm(alias)];
    if (real !== undefined && row[real] !== undefined && row[real] !== '') return row[real];
  }
  return null;
}

function readSheet(filePath, sheetName) {
  const wb = XLSX.readFile(filePath);
  const ws = sheetName
    ? wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames[0]]
    : wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function hasSheet(filePath, name) {
  const wb = XLSX.readFile(filePath);
  return wb.SheetNames.includes(name);
}

// Convierte serial date de Excel a YYYY-MM-DD
function excelSerialToISO(serial) {
  const msPerDay = 86400000;
  const excelEpoch = new Date(1899, 11, 30).getTime();
  return new Date(excelEpoch + serial * msPerDay).toISOString().split('T')[0];
}

function parseDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val.toISOString().split('T')[0];
  // número → serial de Excel
  if (typeof val === 'number' && val > 20000) return excelSerialToISO(val);
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const parts = s.split('/');
  if (parts.length === 3) {
    const [d, m, y] = parts;
    return `${y.padStart(4,'0')}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return null;
}

async function importClientes(filePath, sheetName) {
  console.log(`\nImportando clientes desde: ${filePath} [hoja: ${sheetName || 'primera'}]`);
  const rows = readSheet(filePath, sheetName);
  console.log(`Filas encontradas: ${rows.length}`);
  let inserted = 0, updated = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    const telefono = String(pick(row,'telefono','teléfono','tel','phone') || '').replace(/\s/g,'');
    const nombre   = String(pick(row,'nombre','cliente','name') || '').trim();
    if (!telefono || !nombre) { skipped++; continue; }

    try {
      const result = await pool.query(
        `INSERT INTO clientes (nombre, telefono, placa, marca, modelo, anio, fecha_ultimo_servicio)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (telefono) DO UPDATE SET
           nombre                = COALESCE(NULLIF(EXCLUDED.nombre,''),  clientes.nombre),
           placa                 = COALESCE(NULLIF(EXCLUDED.placa,''),   clientes.placa),
           marca                 = COALESCE(NULLIF(EXCLUDED.marca,''),   clientes.marca),
           modelo                = COALESCE(NULLIF(EXCLUDED.modelo,''),  clientes.modelo),
           anio                  = COALESCE(NULLIF(EXCLUDED.anio,''),    clientes.anio),
           fecha_ultimo_servicio = COALESCE(EXCLUDED.fecha_ultimo_servicio, clientes.fecha_ultimo_servicio)
         RETURNING (xmax = 0) AS is_insert`,
        [
          nombre, telefono,
          String(pick(row,'placa','plate') || '').trim() || null,
          String(pick(row,'marca','brand','make') || '').trim() || null,
          String(pick(row,'modelo','model') || '').trim() || null,
          String(pick(row,'año','anio','year','ano') || '').trim() || null,
          parseDate(pick(row,'fecha_ultimo_servicio','fecha ultimo servicio','last_service','fecha ultimo servicios')),
        ]
      );
      result.rows[0].is_insert ? inserted++ : updated++;
    } catch (e) { errors++; console.error(`  ! ERROR ${telefono}: ${e.message}`); }
  }

  console.log(`  Clientes — Creados: ${inserted} | Actualizados: ${updated} | Saltados: ${skipped} | Errores: ${errors}`);
}

async function importCitas(filePath, sheetName) {
  console.log(`\nImportando citas desde: ${filePath} [hoja: ${sheetName || 'primera'}]`);
  const rows = readSheet(filePath, sheetName);
  console.log(`Filas encontradas: ${rows.length}`);
  let inserted = 0, skipped = 0, errors = 0, noTelefono = 0;

  for (const row of rows) {
    const fecha = parseDate(pick(row,'fecha','date','fecha_'));
    const nombre = String(pick(row,'nombre_cliente','nombre','cliente','name') || '').trim();
    if (!fecha || !nombre) { skipped++; continue; }

    // Buscar teléfono por placa o nombre en clientes ya importados
    let telefono = String(pick(row,'telefono','teléfono','tel') || '').replace(/\s/g,'');
    if (!telefono) {
      const placa = String(pick(row,'placa','plate') || '').trim();
      if (placa) {
        const { rows: found } = await pool.query(
          'SELECT telefono FROM clientes WHERE placa ILIKE $1 LIMIT 1', [placa]
        );
        if (found.length) telefono = found[0].telefono;
      }
      if (!telefono) {
        const { rows: found } = await pool.query(
          'SELECT telefono FROM clientes WHERE nombre ILIKE $1 LIMIT 1', [nombre]
        );
        if (found.length) telefono = found[0].telefono;
        else noTelefono++;
      }
    }

    const hora = String(pick(row,'hora','hour','time') || '').trim() || null;

    try {
      await pool.query(
        `INSERT INTO citas
           (nombre_cliente, telefono, servicio_solicitado, fecha, hora, estado,
            kilometraje, descripcion_problema, trabajos, repuestos, tecnico, tiempo_estimado, estado_orden)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT DO NOTHING`,
        [
          nombre,
          telefono || null,
          String(pick(row,'servicio_solicitado','servicio','service') || '').trim() || null,
          fecha, hora,
          String(pick(row,'estado','status') || 'Completado').trim(),
          pick(row,'kilometraje','km','mileage') || null,
          String(pick(row,'descripcion_problema','descripcion','description','notas','notes') || '').trim() || null,
          // 'Mano de obra' → trabajos
          String(pick(row,'trabajos','trabajo','work','mano_de_obra','mano de obra') || '').trim() || null,
          String(pick(row,'repuestos','parts','piezas') || '').trim() || null,
          String(pick(row,'tecnico','technician','mechanic') || '').trim() || null,
          pick(row,'tiempo_estimado','tiempo','hours') || null,
          'Completada',
        ]
      );
      inserted++;
    } catch (e) { errors++; console.error(`  ! ERROR ${nombre} ${fecha}: ${e.message}`); }
  }

  console.log(`  Citas — Creadas: ${inserted} | Saltadas: ${skipped} | Sin tel: ${noTelefono} | Errores: ${errors}`);
}

async function main() {
  const [,, fileA, fileB] = process.argv;
  if (!fileA) {
    console.error('Uso: node tools/db/import-xlsx.js <archivo.xlsx> [citas.xlsx]');
    process.exit(1);
  }

  // Modo un solo archivo con dos hojas
  if (!fileB && hasSheet(fileA, 'Clientes') && hasSheet(fileA, 'Citas')) {
    console.log('Modo archivo único con hojas Clientes + Citas detectado.');
    await importClientes(fileA, 'Clientes');
    await importCitas(fileA, 'Citas');
  } else {
    // Modo dos archivos separados
    await importClientes(fileA);
    if (fileB) await importCitas(fileB);
  }

  console.log('\nImportación completada.');
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
