/**
 * Anti-race: agrupa mensajes rápidos del MISMO teléfono en una sola unidad de
 * procesamiento. Si llegan varios mensajes dentro de `BATCH_MS`, se concatenan y
 * se procesan juntos → una sola respuesta (evita 5 respuestas a "hola/hola/hola").
 *
 * Buffer por teléfono. Cuando vence la ventana, se llama a `flushFn(phone, texto, meta)`.
 */

const BATCH_MS = parseInt(process.env.BATCH_MS || '1200', 10);
const _buffers = new Map(); // phone → { parts:[], meta, timer, flushFn }

/**
 * Encola un mensaje; agenda/reinicia el flush.
 * @param {string} phone
 * @param {string} text
 * @param {object} meta   - se conserva el del PRIMER mensaje + quotedId del último
 * @param {(phone:string, text:string, meta:object)=>Promise<any>} flushFn
 */
function enqueueMessage(phone, text, meta, flushFn) {
  let buf = _buffers.get(phone);
  if (!buf) {
    buf = { parts: [], meta: { ...meta }, timer: null, flushFn };
    _buffers.set(phone, buf);
  }
  buf.parts.push(text);
  // El último quotedId gana (si el humano citó en el último mensaje del lote)
  if (meta && meta.quotedId) buf.meta.quotedId = meta.quotedId;
  buf.flushFn = flushFn;

  if (buf.timer) clearTimeout(buf.timer);
  buf.timer = setTimeout(() => flushPhone(phone), BATCH_MS);
}

async function flushPhone(phone) {
  const buf = _buffers.get(phone);
  if (!buf) return;
  _buffers.delete(phone);
  const text = buf.parts.join('\n').trim();
  if (buf.parts.length > 1) console.log('[batcher] grouped', { phone, count: buf.parts.length });
  try {
    await buf.flushFn(phone, text, buf.meta);
  } catch (e) {
    console.error('[batcher] flush error:', e.message);
  }
}

/** Combina N mensajes en uno (utilidad pura para tests). */
function combine(parts) {
  return parts.join('\n').trim();
}

module.exports = { enqueueMessage, combine, BATCH_MS };
