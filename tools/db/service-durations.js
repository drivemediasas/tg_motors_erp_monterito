// Duración estimada (en horas) que ocupa cada tipo de servicio en la agenda del taller.
// Se usa para que el calendario y el bot de WhatsApp reserven el tiempo correcto.
// La clave se compara por palabra clave contra el texto del servicio (sin acentos, minúsculas).

const DURATION_RULES = [
  // palabra clave        horas
  ['colision',            8],   // colisión / carrocería: medio día o más
  ['carroceria',          8],
  ['pintura',             8],
  ['latoneria',           8],
  ['transmision',         5],
  ['caja',                5],
  ['motor',               5],   // diagnóstico y reparación de motor
  ['suspension',          3],
  ['direccion',           3],
  ['mantenimiento',       3],
  ['climatizacion',       3],
  ['aire',                3],
  ['electrico',           2],
  ['frenos',              2],
  ['accesorios',          2],
  ['4x4',                 3],
  ['off-road',            3],
  ['aceite',              1],
  ['lavad',               1],   // lavada / lavado
  ['detailing',           2],
  ['pulida',              2],
  ['encerado',            1],
  ['diagnostico',         1],
  ['revision',            1],
  ['robo',                2],
  ['seguro',              2],
];

const DEFAULT_HOURS = 2;

function normalize(str) {
  return String(str || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/**
 * Devuelve la duración estimada en horas para un servicio dado.
 * @param {string} servicio - texto del servicio (libre o de la lista).
 * @returns {number} horas (entero >= 1).
 */
function getServiceDuration(servicio) {
  const s = normalize(servicio);
  for (const [kw, hours] of DURATION_RULES) {
    if (s.includes(kw)) return hours;
  }
  return DEFAULT_HOURS;
}

module.exports = { getServiceDuration, DEFAULT_HOURS };
