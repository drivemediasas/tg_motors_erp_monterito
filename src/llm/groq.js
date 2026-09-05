const { bump } = require('../metrics');

/**
 * Cliente LLM genérico sobre la API estilo OpenAI (/chat/completions).
 * Funciona con cualquier proveedor compatible; se elige por variables de entorno:
 *
 *   LLM_API_KEY / LLM_BASE_URL / LLM_MODEL / LLM_FALLBACK_MODEL / LLM_TIMEOUT_MS
 *   (con fallback a los nombres viejos GROQ_* para no romper despliegues previos)
 *
 * DEFAULT: Groq — free tier sin tarjeta (~30 req/min, 8k tokens/min), tool-use
 * sólido por OpenAI-compat. openai/gpt-oss-20b verificado funcionando en la cuenta.
 *   LLM_API_KEY  = key de https://console.groq.com
 *   LLM_BASE_URL = https://api.groq.com/openai/v1
 *   LLM_MODEL    = openai/gpt-oss-20b
 *   LLM_FALLBACK_MODEL = openai/gpt-oss-120b
 *
 * Alternativas (cambiar LLM_BASE_URL + LLM_MODEL + LLM_API_KEY):
 *   Cerebras (pay-as-you-go, sin tope de req/min): https://api.cerebras.ai/v1 + gpt-oss-120b
 *   NO usar Gemini con herramientas (2.5 y 3.x exigen thought_signature → 400).
 */

const API_KEY = (process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '').replace(/\s/g, '');
const BASE_URL = (process.env.LLM_BASE_URL || process.env.GROQ_BASE_URL
  || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
const MODEL = process.env.LLM_MODEL || process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
const FALLBACK_MODEL = process.env.LLM_FALLBACK_MODEL || process.env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-120b';
const TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || process.env.GROQ_TIMEOUT_MS || '25000', 10);

function toOpenAiTools(tools) {
  return (tools || []).map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema || { type: 'object', properties: {} },
    },
  }));
}

function safeJsonParse(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); }
  catch { return {}; }
}

function toOpenAiMessages(messages) {
  const converted = [];

  for (const message of messages || []) {
    if (typeof message.content === 'string') {
      converted.push({ role: message.role, content: message.content });
      continue;
    }

    const blocks = Array.isArray(message.content) ? message.content : [];
    const textParts = [];
    const toolCalls = [];

    for (const block of blocks) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
        continue;
      }
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || `call_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
          },
        });
        continue;
      }
      if (block.type === 'tool_result') {
        converted.push({
          role: 'tool',
          tool_call_id: block.tool_use_id,
          content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? {}),
        });
      }
    }

    if (message.role === 'assistant') {
      const assistantMessage = { role: 'assistant' };
      if (toolCalls.length) {
        assistantMessage.tool_calls = toolCalls;
        assistantMessage.content = textParts.length ? textParts.join('\n') : null; // Gemini exige content:null, no ""
      } else {
        assistantMessage.content = textParts.join('\n');
      }
      converted.push(assistantMessage);
      continue;
    }

    if (message.role === 'user') {
      if (textParts.length) converted.push({ role: 'user', content: textParts.join('\n') });
      continue;
    }

    converted.push({ role: message.role || 'user', content: textParts.join('\n') || '' });
  }

  return converted;
}

function isTransientError(err) {
  const msg = String(err?.message || err || '');
  return /timeout|aborted|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|API error (429|5\d\d)|model_decommissioned|model_not_found|rate.?limit|RESOURCE_EXHAUSTED|overloaded|UNAVAILABLE/i.test(msg);
}

async function callOnce({ model, payloadBase }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payloadBase, model }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      bump('groqTimeouts');
      throw new Error(`LLM timeout tras ${TIMEOUT_MS}ms (model ${model})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LLM API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message || {};
  const content = [];
  if (choice.content) content.push({ type: 'text', text: choice.content });
  (choice.tool_calls || []).forEach((call, i) => {
    content.push({
      type: 'tool_use',
      // Gemini (compat OpenAI) a veces NO devuelve `id` en los tool calls.
      // Si falta, generamos uno estable: se usa igual en el mensaje del assistant
      // y en el tool_result, así el proveedor puede emparejarlos (si no, 400).
      id: call.id || `call_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`,
      name: call.function?.name,
      input: safeJsonParse(call.function?.arguments),
    });
  });

  return {
    content,
    stop_reason: (choice.tool_calls && choice.tool_calls.length) ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

/**
 * Llama al LLM con timeout duro. Ante error transitorio:
 *  - si el rate limit dice "try again in Xs" y X<=8, espera y reintenta el mismo modelo
 *  - si no, reintenta una vez con el modelo de respaldo
 * Si todo falla → propaga (el caller tiene su propio fallback determinístico).
 */
async function runGroqChat({ system, tools, messages, maxTokens, temperature = 0.2 }) {
  if (!API_KEY) throw new Error('LLM_API_KEY (o GROQ_API_KEY) no está configurada');

  const payloadBase = {
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...toOpenAiMessages(messages),
    ],
    tools: toOpenAiTools(tools),
    tool_choice: 'auto',
    temperature,
    max_tokens: maxTokens,
  };

  try {
    return await callOnce({ model: MODEL, payloadBase });
  } catch (err) {
    if (!isTransientError(err)) throw err;

    const m = /try again in ([\d.]+)s/i.exec(err.message || '');
    const waitS = m ? parseFloat(m[1]) : 0;
    if (waitS > 0 && waitS <= 8) {
      console.warn(`[llm] rate limit; espero ${waitS}s y reintento ${MODEL}`);
      await new Promise(r => setTimeout(r, waitS * 1000 + 300));
      try { return await callOnce({ model: MODEL, payloadBase }); }
      catch (e2) { if (!isTransientError(e2)) throw e2; }
    }

    if (FALLBACK_MODEL === MODEL) throw err;
    console.warn(`[llm] modelo primario falló (${err.message}); reintento con ${FALLBACK_MODEL}`);
    bump('groqFallbackUsed');
    return await callOnce({ model: FALLBACK_MODEL, payloadBase });
  }
}

module.exports = { runGroqChat, GROQ_MODEL: MODEL, GROQ_FALLBACK_MODEL: FALLBACK_MODEL, isTransientGroqError: isTransientError, LLM_MODEL: MODEL, toOpenAiMessages, toOpenAiTools };
