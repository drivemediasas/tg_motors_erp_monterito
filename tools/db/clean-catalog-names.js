/**
 * Limpia precios incrustados en los NOMBRES del catálogo (no en la columna precio).
 *
 * Ej: "LIMPIEZA CUERPO ACELERACIÓN (Spray limpiacarburador 6,50)" → "...limpiacarburador)"
 *     "REEMPLAZO MESAS SUSPENSIÓN $15 c/u"                        → "REEMPLAZO MESAS SUSPENSIÓN"
 *
 * Conservador: solo quita cuando hay señal clara de precio ($, decimal de 2 cifras, c/u).
 * NO toca números como "1.6" (motor) porque exige 2 decimales o el símbolo $.
 */

function cleanName(nombre) {
  if (!nombre) return nombre;
  let s = nombre;

  s = s.replace(/\$\s?\d+(?:[.,]\d+)?/g, ' ');   // "$15", "$ 6,50"
  s = s.replace(/\b\d+[.,]\d{2}\b/g, ' ');        // "6,50", "15.00" (no "1.6")
  s = s.replace(/\bc\/u\b/gi, ' ');               // "c/u"

  // Limpieza de residuos: paréntesis vacíos, espacios dobles, separadores colgantes
  s = s.replace(/\(\s*\)/g, ' ');
  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/\s+([)\]])/g, '$1');
  s = s.replace(/[\s\-–—,:;]+$/g, '');
  s = s.replace(/^[\s\-–—,:;]+/g, '');
  s = s.trim();

  return s;
}

/**
 * Recorre el catálogo y limpia los nombres. Loguea cada cambio before → after.
 * @param {object} pool - pg pool
 * @param {object} opts - { apply: boolean } (false = dry-run, solo loguea)
 * @returns {number} cantidad de filas cambiadas
 */
async function cleanCatalogNames(pool, { apply = false } = {}) {
  const { rows } = await pool.query('SELECT id, nombre FROM catalogo ORDER BY id');
  let changed = 0;

  for (const r of rows) {
    const limpio = cleanName(r.nombre);
    if (limpio && limpio !== r.nombre) {
      console.log(`[clean-catalog] #${r.id}: "${r.nombre}" → "${limpio}"`);
      if (apply) {
        await pool.query('UPDATE catalogo SET nombre = $2 WHERE id = $1', [r.id, limpio]);
      }
      changed++;
    }
  }

  console.log(`[clean-catalog] ${changed} nombre(s) ${apply ? 'actualizados' : 'a actualizar (dry-run)'} de ${rows.length} revisados`);
  return changed;
}

module.exports = { cleanCatalogNames, cleanName };
