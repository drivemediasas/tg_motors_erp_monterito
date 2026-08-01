const pool = require('./client');

/**
 * Bloquea N slots consecutivos para un técnico a partir del primer hueco disponible.
 * @returns {string|null} hora de inicio asignada
 */
async function blockTechnicianSlots({ tecnico, fecha, horasEstimadas, citaId }) {
  // Obtener todos los slots disponibles del técnico ese día, en orden
  const { rows } = await pool.query(
    `SELECT id, TO_CHAR(hora,'HH24:MI') AS hora
     FROM disponibilidad
     WHERE fecha = $1 AND tecnico = $2 AND disponible = true
     ORDER BY hora`,
    [fecha, tecnico]
  );

  if (!rows.length) return null;

  // Buscar primer bloque de N horas consecutivas
  const n = Math.ceil(horasEstimadas);
  let startIdx = -1;
  outer: for (let i = 0; i <= rows.length - n; i++) {
    for (let j = 1; j < n; j++) {
      const [h1, m1] = rows[i+j-1].hora.split(':').map(Number);
      const [h2, m2] = rows[i+j].hora.split(':').map(Number);
      if ((h2*60+m2) - (h1*60+m1) !== 60) continue outer;
    }
    startIdx = i;
    break;
  }

  if (startIdx === -1) {
    console.warn(`[slots] No hay ${n}h consecutivas disponibles para ${tecnico} el ${fecha}`);
    return null;
  }

  const toBlock = rows.slice(startIdx, startIdx + n).map(r => r.id);
  await pool.query(
    `UPDATE disponibilidad SET disponible = false, cita_id = $1 WHERE id = ANY($2::int[])`,
    [citaId, toBlock]
  );

  console.log(`[slots] Bloqueados ${toBlock.length} slots para ${tecnico} el ${fecha} desde ${rows[startIdx].hora}`);
  return rows[startIdx].hora;
}

module.exports = { blockTechnicianSlots };
