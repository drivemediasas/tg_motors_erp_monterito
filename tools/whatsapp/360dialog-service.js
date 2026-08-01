const axios = require('axios');

const TIMEOUT_MS = 10000;

/**
 * Send a free-form text message via 360dialog's WhatsApp Cloud API (Coexistence).
 * Docs: https://docs.360dialog.com/whatsapp-api/whatsapp-api/messages
 *
 * @param {string} phone - recipient phone number (international format, no +)
 * @param {string} text  - message text
 */
async function sendMessage(phone, text) {
  const baseUrl = process.env.D360_API_BASE_URL || 'https://waba-v2.360dialog.io';
  const apiKey  = process.env.D360_API_KEY;

  try {
    console.log('[360dialog] sending message →', { to: phone, chars: text.length });
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
