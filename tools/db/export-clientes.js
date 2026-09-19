/**
 * Exporta el listado de clientes (excluyendo proveedores) a un .xlsx, para la
 * campaña de reactivación manual por WhatsApp.
 *
 * Uso:
 *   node tools/db/export-clientes.js [salida.xlsx]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const pool = require('./client');
const { normalizeEcPhone } = require('./mark-provider');

async function exportClientes(outPath) {
  const { rows } = await pool.query(
    `SELECT nombre, telefono, placa, marca, modelo, fecha_ultimo_servicio
       FROM clientes
      WHERE es_proveedor IS NOT TRUE
      ORDER BY fecha_ultimo_servicio DESC NULLS LAST`
  );

  // Celular ecuatoriano válido para WhatsApp: 593 + 9 dígitos (empieza en 9).
  const VALID_MOBILE = /^5939\d{8}$/;
  // Nombre corrupto: quedó el encabezado del import ("Datos Del Vehiculo") o el
  // parseo de marca/modelo se coló en el campo nombre ("... Marca-Modelo...").
  const BAD_NAME = /^datos del veh[ií]culo$/i;
  const CORRUPT_NAME = /marca[\s_-]*modelo/i;

  const seen = new Set();
  const data = [];
  const revisar = [];
  let sinHistorial = 0;
  for (const r of rows) {
    const tel = normalizeEcPhone(r.telefono);
    if (!tel || seen.has(tel)) continue;
    seen.add(tel);

    // Sin ninguna visita registrada = nunca fue cliente real (solo escribió al bot
    // alguna vez, o es un contacto de prueba). No es un caso de "reactivación" —
    // se excluye del todo en vez de ensuciar la lista o la pestaña de revisión.
    if (!r.fecha_ultimo_servicio) { sinHistorial++; continue; }

    const nombre = (r.nombre || '').trim();
    const row = {
      Nombre: nombre,
      Telefono: tel,
      Placa: r.placa || '',
      Marca: r.marca || '',
      Modelo: r.modelo || '',
      'Ultimo servicio': new Date(r.fecha_ultimo_servicio).toISOString().split('T')[0],
      Contactado: '',
    };

    const motivos = [];
    if (!VALID_MOBILE.test(tel)) motivos.push('teléfono inválido (no es celular EC)');
    if (BAD_NAME.test(nombre) || CORRUPT_NAME.test(nombre)) motivos.push('nombre no utilizable');

    if (motivos.length) revisar.push({ ...row, Motivo: motivos.join('; ') });
    else data.push(row);
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Clientes');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(revisar), 'Revisar');
  XLSX.writeFile(wb, outPath);

  console.log(`Clientes exportados: ${data.length} listos para difusión + ${revisar.length} en "Revisar" + ${sinHistorial} excluidos (sin visita registrada) — de ${rows.length} filas no-proveedor → ${outPath}`);
}

async function main() {
  const outPath = process.argv[2] || '.tmp/clientes-reactivacion.xlsx';
  await exportClientes(outPath);
  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
