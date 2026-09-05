const axios = require('axios');
const { bump } = require('../../src/metrics');

const TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 800;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Reintentable: timeout de red o error 5xx del proveedor. Un 4xx (número inválido,
// fuera de la ventana de 24h, plantilla requerida) NO se reintenta.
function isRetriableSendError(err) {
  if (err.code === 'ECONNABORTED') return true;
  const status = err.response?.status;
  return typeof status === 'number' && status >= 500;
}

/**
 * Send a free-form text message via 360dialog's WhatsApp Cloud API (Coexistence).
 * Docs: https://docs.360dialog.com/whatsapp-api/whatsapp-api/messages
 *
 * @param {string} phone - recipient phone number (international format, no +)
 * @param {string} text  - message text
 */
async function sendMessage(phone, text, _attempt = 1) {
  const baseUrl = process.env.D360_API_BASE_URL || 'https://waba-v2.360dialog.io';
  const apiKey  = process.env.D360_API_KEY;

  try {
    console.log('[360dialog] sending message →', { to: phone, chars: text.length, attempt: _attempt });
    const response = await axios.post(
      `${baseUrl}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: phone,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          'D360-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT_MS,
      }
    );
    console.log('[360dialog] message accepted', { to: phone, messageId: response.data?.messages?.[0]?.id });
    return response.data;
  } catch (err) {
    if (err.response) {
      console.error(`[360dialog] api error ${err.response.status}:`, JSON.stringify(err.response.data));
    } else if (err.code === 'ECONNABORTED') {
      console.error('[360dialog] api error: request timed out after', TIMEOUT_MS, 'ms');
    } else {
      console.error('[360dialog] api error:', err.message);
    }
    if (_attempt === 1 && isRetriableSendError(err)) {
      bump('outboundRetries');
      console.warn('[360dialog] reintentando envío en', RETRY_DELAY_MS, 'ms');
      await sleep(RETRY_DELAY_MS);
      return sendMessage(phone, text, 2);
    }
    throw err;
  }
}

/**
 * Send an approved WhatsApp template message via 360dialog's Cloud API.
 * @param {string} phone        - recipient phone (international, no +)
 * @param {string} templateName - approved template name
 * @param {Array}  params       - array of string values for the body placeholders
 */
async function sendTemplate(phone, templateName, params = []) {
  const baseUrl  = process.env.D360_API_BASE_URL || 'https://waba-v2.360dialog.io';
  const apiKey   = process.env.D360_API_KEY;
  const langCode = process.env.D360_TEMPLATE_LANG || 'es';

  try {
    console.log('[360dialog] sending template →', { to: phone, template: templateName, params: params.length });
    const response = await axios.post(
      `${baseUrl}/messages`,
      {
        messaging_product: 'whatsapp',
        to: phone,
        type: 'template',
        template: {
          name: templateName,
          language: { code: langCode },
          components: params.length
            ? [{ type: 'body', parameters: params.map((value) => ({ type: 'text', text: value })) }]
            : [],
        },
      },
      {
        headers: {
          'D360-API-KEY': apiKey,
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT_MS,
      }
    );
    console.log('[360dialog] template accepted', { to: phone, template: templateName, messageId: response.data?.messages?.[0]?.id });
    return response.data;
  } catch (err) {
    if (err.response) {
      console.error(`[360dialog] api error ${err.response.status}:`, JSON.stringify(err.response.data));
    } else {
      console.error('[360dialog] api error:', err.message);
    }
    throw err;
  }
}

module.exports = { sendMessage, sendTemplate };
