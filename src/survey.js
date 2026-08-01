/**
 * Parseo PURO de una respuesta de encuesta de satisfacción (1–5).
 * Devuelve el número 1–5 SOLO si el mensaje es esencialmente una calificación
 * (un dígito, "N estrellas", o N emojis ⭐). Si no, devuelve null.
 * Así un "5" para elegir servicio del menú (sin encuesta pendiente) no se confunde
 * a nivel de texto — y además el caller exige que haya una encuesta pendiente.
 */
function parseSurveyRating(text) {
  const t = (text || '').trim();
  if (!t) return null;

  // "5", "5 estrellas", "5*", "5 ⭐"
  const m = t.match(/^([1-5])\s*(estrella|estrellas|⭐+|\*+)?$/i);
  if (m) return parseInt(m[1], 10);

  // Solo emojis de estrella: ⭐⭐⭐⭐⭐
  const stars = (t.match(/⭐/g) || []).length;
  if (stars >= 1 && stars <= 5 && /^[⭐\s]+$/.test(t)) return stars;

  return null;
}

module.exports = { parseSurveyRating };
