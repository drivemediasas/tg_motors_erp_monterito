const axios = require('axios');
const respondioService = require('./respondio-service');
const d360Service = require('./360dialog-service');

/**
 * Send a free-form text message via the WhatsApp provider.
 * Supports WATI (default), Twilio, respond.io and 360dialog — set WHATSAPP_PROVIDER to switch.
 *
 * @param {string} to      - recipient phone number (international format, no +)
 * @param {string} message - text to send
 */
async function sendMessage(to, message) {
  const provider = process.env.WHATSAPP_PROVIDER || 'wati';

  if (provider === 'wati') {
    return sendWati(to, message);
  } else if (provider === 'twilio') {
    return sendTwilio(to, message);
  } else if (provider === 'respondio') {
    return sendRespondio(to, message);
  } else if (provider === '360dialog') {
    return d360Service.sendMessage(to, message);
  }

  throw new Error(`Unknown WHATSAPP_PROVIDER: ${provider}`);
}

async function sendWati(to, message) {
  const url = `${process.env.WHATSAPP_API_URL}/api/v1/sendSessionMessage/${to}`;
  const response = await axios.post(
    url,
    { messageText: message },
    { headers: { Authorization: process.env.WHATSAPP_API_KEY } }
  );
  return response.data;
}

async function sendTwilio(to, message) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const response = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    new URLSearchParams({
      From: `whatsapp:+${from}`,
      To:   `whatsapp:+${to}`,
      Body: message,
    }),
    { auth: { username: accountSid, password: authToken } }
  );
  return response.data;
}

async function sendRespondio(to, message) {
  return respondioService.sendMessage(`+${to}`, message);
}

module.exports = { sendMessage };
