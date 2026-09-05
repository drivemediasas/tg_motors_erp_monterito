const GROQ_API_KEY = (process.env.GROQ_API_KEY || '').replace(/\s/g, '');
const GROQ_MODEL = process.env.GROQ_MODEL || 'moonshotai/kimi-k2-instruct';
const GROQ_BASE_URL = process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1';

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
      const assistantMessage = {};
      assistantMessage.role = 'assistant';
      if (textParts.length) assistantMessage.content = textParts.join('\n');
      if (toolCalls.length) assistantMessage.tool_calls = toolCalls;
      if (!assistantMessage.content && !assistantMessage.tool_calls) assistantMessage.content = '';
      converted.push(assistantMessage);
      continue;
    }

    if (message.role === 'user') {
      if (textParts.length && !toolCalls.length && !converted.some((m) => m.role === 'tool' && m.tool_call_id)) {
        converted.push({ role: 'user', content: textParts.join('\n') });
        continue;
      }
      if (textParts.length) {
        converted.push({ role: 'user', content: textParts.join('\n') });
      }
      continue;
    }

    converted.push({ role: message.role || 'user', content: textParts.join('\n') || '' });
  }

  return converted;
}

async function runGroqChat({ system, tools, messages, maxTokens, temperature = 0.3 }) {
  if (!GROQ_API_KEY) {
    throw new Error('GROQ_API_KEY no está configurada');
  }

  const payload = {
    model: GROQ_MODEL,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...toOpenAiMessages(messages),
    ],
    tools: toOpenAiTools(tools),
    tool_choice: 'auto',
    temperature,
    max_completion_tokens: maxTokens,
  };

  const res = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Groq API error ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0]?.message || {};
  const content = [];
  const text = choice.content || '';
  if (text) {
    content.push({ type: 'text', text });
  }
  for (const call of choice.tool_calls || []) {
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function?.name,
      input: safeJsonParse(call.function?.arguments),
    });
  }

  return {
    content,
    stop_reason: (choice.tool_calls && choice.tool_calls.length) ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: data.usage?.prompt_tokens || 0,
      output_tokens: data.usage?.completion_tokens || 0,
    },
  };
}

module.exports = { runGroqChat, GROQ_MODEL };
