/**
 * Production hardening guards for Monterito.
 *
 * All checks run BEFORE calling the LLM. If any guard triggers, a fixed
 * response is returned immediately and Claude is never consulted.
 *
 * Exports:
 *   checkGuards(phone, text)  → { blocked, type, response } | { blocked: false }
 *   getStaticResponse(text)   → string | null  (cache hit for common static questions)
 *   isRepeatedMessage(phone, text) → boolean
 *   trimHistory(history)      → last N messages
 *   recordTokenUsage(phone, inputTokens, outputTokens)
 *   getGuardStats()           → stats for /health endpoint
 */

// ─── Fixed response messages ─────────────────────────────────────────────────

const MSG_OFFTOPIC    = 'Soy el asistente virtual de TG Motors y únicamente puedo ayudarte con consultas relacionadas con nuestros servicios automotrices. 🚗';
const MSG_RATE_LIMIT  = 'Has enviado demasiados mensajes. Inténtalo nuevamente en unos minutos.';
const MSG_TOO_LONG    = 'Tu mensaje es demasiado largo. Por favor resume tu consulta.';
const MSG_INJECTION   = 'Solo puedo ayudarte con consultas relacionadas con TG Motors y nuestros servicios automotrices.';

// ─── Limits ──────────────────────────────────────────────────────────────────

const MAX_MSG_CHARS    = 1000;
const RATE_PER_MIN     = 10;
const RATE_PER_HOUR    = 100;
const RATE_PER_DAY     = 500;
const HISTORY_MAX_MSGS = 15;
const REPEAT_BLOCK_AT  = 3;   // block when the same message is sent this many times

// ─── Topic filter ─────────────────────────────────────────────────────────────
//
// Logic:
//   isAutomotiveQuery(text)  → true  → always pass to LLM (override off-topic)
//   isOffTopicQuery(text)    → true  → block with fixed response
//   neither                  → pass  (greetings, short replies, ambiguous)

const AUTOMOTIVE_RE = [
  /\b(carro?|coche|veh[íi]culo|auto|moto(?:cicleta)?|camioneta|furg[oó]n|cami[oó]n|sed[aá]n|suv|4x4|pick[- ]?up)\b/i,
  /\b(motor|frenos?|aceite|filtro|buj[íi]a|llanta|neum[aá]tico|bater[íi]a|alternador|radiador|transmisi[oó]n|embrague|diferencial|suspensi[oó]n|alineaci[oó]n|balanceo|escape|catalizador|correa|distribuci[oó]n|amortiguador|carburador|turbo|inyecci[oó]n)\b/i,
  /\b(taller|mec[aá]ni[co]a?|servicios?|reparaci[oó]n|mantenimiento|diagn[oó]stico|cita|presupuesto|cotizaci[oó]n|garant[íi]a|repuesto|pieza|aceite|lavado|revisi[oó]n)\b/i,
  /\b(tg motors|monterito|tgmotors)\b/i,
  /\b(horario|direcci[oó]n|ubicaci[oó]n|tel[eé]fono|whatsapp|contacto)\b/i,
  /\bplaca\b/i,
  /\bkil[oó]metros?\b/i,
  // Price/cost questions — always treat as automotive so they reach the price flow
  /\b(precio|cuesta|cu[aá]nto|cobran|cobras|valor|cotizaci[oó]n|tarifa|presupuesto)\b/i,
];

const OFFTOPIC_RE = [
  // Math / science
  /\b(matem[aá]tic[ao]s?|ecuaci[oó]n|[aá]lgebra|c[aá]lculo|geometr[íi]a|f[íi]sica|qu[íi]mica)\b/i,
  // History / social science
  /\b(histori[ao]|guerra mundial|revoluci[oó]n|civilizaci[oó]n|cultura general|filosof[íi]a|sociolog[íi]a)\b/i,
  // Coding / tech
  /\b(program[ao]|c[oó]dig[oa]|javascript|typescript|python|java\b|html|css|sql|algoritmo|software|app\b|backend|frontend|framework|react|angular|vue|node\.?js|api\b|github|docker|kubernetes)\b/i,
  // Politics
  /\b(pol[íi]tic[ao]|gobierno|presidente|partido pol[íi]tico|elecci[oó]n|congreso|democraci[ao]|dictadura)\b/i,
  // Medicine
  /\b(medicina|doctor|enfermedad|s[íi]ntoma|diagn[oó]stico m[eé]dico|f[aá]rmaco|pastilla|gripe|covid|vacuna|tumor|cirugía)\b/i,
  // Religion
  /\b(religi[oó]n|dios\b|biblia|cor[aá]n|iglesia|orar|rezo|jes[uú]s|al[aá]|buda|templo|misa)\b/i,
  // Philosophy
  /\b(filosof[íi]a|kant|nietzsche|plat[oó]n|arist[oó]teles|existencial|ontolog[íi]a)\b/i,
  // Writing tasks
  /\b(escr[íi]be(me)?|redacta|hazme (un|una)|escrib(ir|e) (un|una) (libro|novela|cuento|ensayo|email|carta|art[íi]culo|informe|tesis))\b/i,
  /\b(tarea|deber|trabajo escolar|resumir (este|el) (texto|documento|libro)|hacer mi tarea)\b/i,
  // Poetry / creative writing
  /\b(poema|canci[oó]n|soneto|haiku|rima|verso|s[íi]laba)\b/i,
  // Cooking
  /\b(receta|ingredientes|cocinar|comida|platillo|gastronom[íi]a|sabor)\b/i,
  // Gaming
  /\b(videojuego|minecraft|fortnite|roblox|gaming|gamer|nivel del juego)\b/i,
  // AI / competing products
  /\b(chatgpt|gpt-?[34]|openai|gemini|llama\b|antropic|anthropic|inteligencia artificial|qu[eé] modelo|qu[eé] ia usas)\b/i,
  // Entertainment
  /\b(ch[íi]ste|cuéntame (un|algo) (divertido|gracioso)|hazme reír|entretén(me)?)\b/i,
  // Weather
  /\b(clima|pron[oó]stico del tiempo|temperatura (de|en) (hoy|mañana|esta semana))\b/i,
  // Translation
  /\btraducir?\b.*\b(al|a|en) (espa[nñ]ol|ingl[eé]s|franc[eé]s|alem[aá]n|portugu[eé]s)\b/i,
];

function isAutomotiveQuery(text) {
  return AUTOMOTIVE_RE.some(re => re.test(text));
}

function isOffTopicQuery(text) {
  return OFFTOPIC_RE.some(re => re.test(text));
}

// ─── Prompt injection detection ───────────────────────────────────────────────

const INJECTION_RE = [
  /ignora (todas? )?(las )?(instrucciones|reglas|restricciones)/i,
  /olvida (las? )?(tus? )?(instrucciones|reglas|restricciones|todo)/i,
  /act[uú]a como/i,
  /eres (ahora )?(chatgpt|gpt|una? (ia|inteligencia artificial)|un modelo|asistente diferente)/i,
  /mu[eé]strame (tu )?(prompt|system prompt|instrucciones internas|configuraci[oó]n)/i,
  /dame (tu )?(prompt|system prompt|instrucciones|configuraci[oó]n|c[oó]digo|api[- ]?key)/i,
  /cu[aá]l (es )?(tu )?(prompt|system prompt|instrucciones|configuraci[oó]n)/i,
  /qu[eé] modelo (usas|eres|corres)/i,
  /developer mode/i,
  /jailbreak/i,
  /modo desarrollador/i,
  /sin restricciones/i,
  /bypass (all )?(restrictions|rules|filters)/i,
  /do anything now/i,
  /dan mode/i,
  /\[system\]/i,
  /<\|im_start\|>/i,
  /reveal (your )?(prompt|instructions|system)/i,
  /print (your )?(prompt|instructions|system)/i,
];

function isPromptInjection(text) {
  return INJECTION_RE.some(re => re.test(text));
}

// ─── Rate limiter ─────────────────────────────────────────────────────────────
// Per-phone sliding counters: 10/min, 100/hour, 500/day

const _rateBuckets = new Map(); // phone → { min, hour, day }

function _bucket(phone) {
  if (!_rateBuckets.has(phone)) {
    const now = Date.now();
    _rateBuckets.set(phone, {
      min:  { count: 0, reset: now + 60_000 },
      hour: { count: 0, reset: now + 3_600_000 },
      day:  { count: 0, reset: now + 86_400_000 },
    });
  }
  return _rateBuckets.get(phone);
}

function checkRateLimit(phone) {
  const now = Date.now();
  const e = _bucket(phone);

  if (now > e.min.reset)  { e.min.count  = 0; e.min.reset  = now + 60_000; }
  if (now > e.hour.reset) { e.hour.count = 0; e.hour.reset = now + 3_600_000; }
  if (now > e.day.reset)  { e.day.count  = 0; e.day.reset  = now + 86_400_000; }

  e.min.count++;
  e.hour.count++;
  e.day.count++;

  if (e.min.count  > RATE_PER_MIN)  return 'rate_limit_min';
  if (e.hour.count > RATE_PER_HOUR) return 'rate_limit_hour';
  if (e.day.count  > RATE_PER_DAY)  return 'rate_limit_day';
  return null;
}

// Clean up stale buckets once per hour
setInterval(() => {
  const now = Date.now();
  for (const [phone, e] of _rateBuckets) {
    if (now > e.day.reset) _rateBuckets.delete(phone);
  }
}, 3_600_000);

// ─── Repeated message detection ───────────────────────────────────────────────
// Block after the same exact message is sent REPEAT_BLOCK_AT times in a row.

const _repeatTracker = new Map(); // phone → { text: string, count: number }

function isRepeatedMessage(phone, text) {
  const norm = text.trim().toLowerCase();
  const entry = _repeatTracker.get(phone);
  if (entry && entry.text === norm) {
    entry.count++;
    if (entry.count >= REPEAT_BLOCK_AT) {
      return true; // still blocked
    }
    return false;
  }
  // Different message — reset counter
  _repeatTracker.set(phone, { text: norm, count: 1 });
  return false;
}

// ─── Static response cache ────────────────────────────────────────────────────
// Returns a pre-built response for common static questions without calling Claude.

const STATIC_PATTERNS = [
  {
    key: 'horario',
    re:  /\b(horario|qu[eé] hora|abren|cierran|atienden|est[aá]n abiertos|cu[aá]ndo abren)\b/i,
  },
  {
    key: 'direccion',
    re:  /\b(direcci[oó]n|d[oó]nde (est[aá]n|quedan|queda)|ubicaci[oó]n|c[oó]mo llego)\b/i,
  },
  {
    key: 'servicios',
    re:  /\b(servicios?|qu[eé] servicios|cu[aá]les servicios|qu[eé] tipo(s)? de servicio|ver (los )?servicios)\b/i,
  },
];

const _staticCache = new Map();

function _buildStaticCache() {
  const shopName    = process.env.SHOP_NAME    || 'TG Motors';
  const shopHours   = process.env.SHOP_HOURS   || 'Lunes a Viernes 8:30–17:30, Sábados 9:00–16:00';
  const shopAddress = process.env.SHOP_ADDRESS || '';
  const shopCity    = process.env.SHOP_CITY    || '';
  const services    = process.env.SHOP_SERVICES || '';

  _staticCache.set('horario',
    `Nuestro horario de atención es: ${shopHours}. ¿Deseas agendar una cita? 😊`);

  _staticCache.set('direccion',
    shopAddress
      ? `Nos encuentras en ${shopAddress}${shopCity ? `, ${shopCity}` : ''}. ¿Necesitas algo más?`
      : `Escríbenos y te damos indicaciones para llegar a ${shopName}. ¿Te puedo ayudar con algo más?`);

  _staticCache.set('servicios',
    services
      ? `En ${shopName} ofrecemos:\n${services.split(',').map((s, i) => `${i + 1}) ${s.trim()}`).join('\n')}\n\n¿Con cuál te puedo ayudar?`
      : `En ${shopName} ofrecemos mantenimiento, diagnóstico y reparación de vehículos. Escríbeme qué necesitas.`);
}

let _cacheBuilt = false;

const MENU_NUMBER_KEYS = { '1': 'horario', '2': 'direccion', '3': 'servicios' };

function getStaticResponse(text) {
  if (!_cacheBuilt) { _buildStaticCache(); _cacheBuilt = true; }
  const direct = String(text || '').trim().toLowerCase();
  if (_staticCache.has(direct)) return _staticCache.get(direct) || null;
  if (MENU_NUMBER_KEYS[direct]) return _staticCache.get(MENU_NUMBER_KEYS[direct]) || null;
  for (const { key, re } of STATIC_PATTERNS) {
    if (re.test(text)) return _staticCache.get(key) || null;
  }
  return null;
}

// ─── Media acknowledgments (non-text inbound, no LLM) ─────────────────────────
// 360dialog/WhatsApp delivers audio, image, sticker, etc. The bot can't read
// them, so it sends a fixed acknowledgment instead of silently ignoring them.

const MEDIA_ACKS = {
  audio:    '🎧 Recibí tu audio. En un momento lo escuchamos y te respondemos. 🙌',
  voice:    '🎧 Recibí tu nota de voz. En un momento la escuchamos y te respondemos. 🙌',
  image:    '📸 Recibí tu foto. Enseguida la revisamos y te respondemos. 🔧',
  video:    '🎥 Recibí tu video. Enseguida lo revisamos y te respondemos. 🔧',
  document: '📄 Recibí tu documento. Enseguida lo revisamos y te respondemos.',
  sticker:  '🚗❤️',
};

const MEDIA_ACK_DEFAULT = 'Recibí tu mensaje 🙌 Para ayudarte mejor, ¿puedes escribirme tu consulta en texto?';

function getMediaAck(type) {
  return MEDIA_ACKS[type] || MEDIA_ACK_DEFAULT;
}

// ─── Block logger ─────────────────────────────────────────────────────────────

const _blockLog  = [];
const BLOCK_LOG_MAX = 5000;

function _maskPhone(phone) {
  if (!phone) return 'unknown';
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

function logBlock(phone, type, reason) {
  const entry = { ts: new Date().toISOString(), phone: _maskPhone(phone), type, reason };
  console.warn(`[guard:${type}] ${entry.phone} — ${reason}`);
  _blockLog.push(entry);
  if (_blockLog.length > BLOCK_LOG_MAX) _blockLog.shift();
}

// ─── Token / cost tracking ────────────────────────────────────────────────────
// Prices for claude-sonnet-4-6: $3/MTok input, $15/MTok output

const COST_IN  = 3  / 1_000_000;
const COST_OUT = 15 / 1_000_000;

const _tokens = {
  totalIn: 0, totalOut: 0, totalCostUSD: 0, calls: 0,
};

function recordTokenUsage(phone, inputTokens = 0, outputTokens = 0) {
  if (!inputTokens && !outputTokens) return;
  const cost = inputTokens * COST_IN + outputTokens * COST_OUT;
  _tokens.totalIn      += inputTokens;
  _tokens.totalOut     += outputTokens;
  _tokens.totalCostUSD += cost;
  _tokens.calls++;
  console.log(`[tokens] in=${inputTokens} out=${outputTokens} cost=$${cost.toFixed(5)} cumulative=$${_tokens.totalCostUSD.toFixed(4)}`);
}

// ─── History trimmer ──────────────────────────────────────────────────────────

function trimHistory(history) {
  if (!Array.isArray(history) || history.length <= HISTORY_MAX_MSGS) return history;
  return history.slice(-HISTORY_MAX_MSGS);
}

// ─── Guard stats (for /health) ────────────────────────────────────────────────

function getGuardStats() {
  const blocksByType = {};
  for (const b of _blockLog) blocksByType[b.type] = (blocksByType[b.type] || 0) + 1;

  return {
    guards: {
      topicFilter:      true,
      rateLimiting:     `${RATE_PER_MIN}/min · ${RATE_PER_HOUR}/h · ${RATE_PER_DAY}/day`,
      lengthLimit:      MAX_MSG_CHARS,
      historyTrimming:  HISTORY_MAX_MSGS,
      promptInjection:  true,
      staticCache:      true,
      repeatedMsgBlock: `${REPEAT_BLOCK_AT}x`,
      costTracking:     true,
    },
    stats: {
      totalBlocks:   _blockLog.length,
      blocksByType,
      activePhones:  _rateBuckets.size,
      tokenUsage: {
        totalInputTokens:  _tokens.totalIn,
        totalOutputTokens: _tokens.totalOut,
        totalCostUSD:      parseFloat(_tokens.totalCostUSD.toFixed(4)),
        llmCallCount:      _tokens.calls,
      },
    },
    recentBlocks: _blockLog.slice(-10),
  };
}

// ─── Main guard check ─────────────────────────────────────────────────────────

/**
 * Run all pre-LLM guards.
 * Must be called BEFORE processMessage hits the LLM.
 *
 * @returns {{ blocked: true, type: string, response: string }
 *          |{ blocked: false }}
 */
function checkGuards(phone, text) {
  // 1. Length
  if (text.length > MAX_MSG_CHARS) {
    logBlock(phone, 'too_long', `${text.length} chars`);
    return { blocked: true, type: 'too_long', response: MSG_TOO_LONG };
  }

  // 2. Rate limit
  const rateType = checkRateLimit(phone);
  if (rateType) {
    logBlock(phone, rateType, 'rate exceeded');
    return { blocked: true, type: rateType, response: MSG_RATE_LIMIT };
  }

  // 3. Prompt injection
  if (isPromptInjection(text)) {
    logBlock(phone, 'prompt_injection', text.slice(0, 100));
    return { blocked: true, type: 'prompt_injection', response: MSG_INJECTION };
  }

  // 4. Topic filter: is this about the auto shop?
  //    Automotive keywords → pass. Off-topic keywords → block.
  //    Ambiguous (neither) → pass (greetings, short replies, etc.)
  if (!isAutomotiveQuery(text) && isOffTopicQuery(text)) {
    logBlock(phone, 'off_topic', text.slice(0, 100));
    return { blocked: true, type: 'off_topic', response: MSG_OFFTOPIC };
  }

  return { blocked: false };
}

module.exports = {
  checkGuards,
  getStaticResponse,
  getMediaAck,
  isRepeatedMessage,
  trimHistory,
  recordTokenUsage,
  getGuardStats,
  logBlock,
};
