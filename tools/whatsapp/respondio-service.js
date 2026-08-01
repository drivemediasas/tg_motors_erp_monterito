const axios = require('axios');

const TIMEOUT_MS = 10000;

/**
 * Send a free-form text message via respond.io's REST API.
 * Docs: https://developers.respond.io/docs/api/a748f5bfb1bb5-send-a-message
 *
 * @param {string} contactId - respond.io contact identifier (phone with leading "+", or contact id)
 * @param {string} text      - message text
 */
async function sendMessage(contactId, text) {
  const baseUrl = process.env.RESPOND_IO_API_BASE_URL || 'https://api.respond.io';
  const token   = process.env.RESPOND_IO_API_TOKEN;

  try {
    const response = await axios.post(
      `${baseUrl}/message`,
      {
        contactId,
        message: { type: 'text', text },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: TIMEOUT_MS,
      }
    );
    return response.data;
  } catch (err) {
    if (err.response) {
      console.error(`[respondio-service] API error ${err.response.status}:`, JSON.stringify(err.response.data));
    } else if (err.code === 'ECONNABORTED') {
      console.error('[respondio-service] Request timed out after', TIMEOUT_MS, 'ms');
    } else {
      console.error('[respondio-service] Network/unknown error:', err.message);
    }
    throw err;
  }
}

module.exports = { sendMessage };
