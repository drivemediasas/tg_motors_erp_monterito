const axios = require('axios');

/**
 * Send a pre-approved WhatsApp template message.
 * Templates must be approved by the provider before use.
 *
 * @param {string} to           - recipient phone (international, no +)
 * @param {string} templateName - approved template name
 * @param {Array}  params       - array of string values for template placeholders
 */
async function sendTemplate(to, templateName, params = []) {
  const provider = process.env.WHATSAPP_PROVIDER || 'wati';

  if (provider === 'wati') {
    return sendWatiTemplate(to, templateName, params);
  } else if (provider === 'twilio') {
    // Twilio uses Content Templates — send pre-built content SID
    return sendTwilioTemplate(to, templateName, params);
  } else if (provider === 'respondio') {
    return sendRespondioTemplate(to, templateName, params);
  } else if (provider === '360dialog') {
    return require('./360dialog-service').sendTemplate(to, templateName, params);
  }

  throw new Error(`Unknown WHATSAPP_PROVIDER: ${provider}`);
}

async function sendWatiTemplate(to, templateName, params) {
  const url = `${process.env.WHATSAPP_API_URL}/api/v1/sendTemplateMessage`;
  const body = {
    template_name: templateName,
    broadcast_name: templateName,
    receivers: [
      {
        whatsappNumber: to,
        customParams: params.map((value, i) => ({
          name: String(i + 1),
          value,
        })),
      },
    ],
  };

  const response = await axios.post(url, body, {
    headers: { Authorization: process.env.WHATSAPP_API_KEY },
  });
  return response.data;
}

async function sendTwilioTemplate(to, contentSid, params) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.WHATSAPP_PHONE_NUMBER_ID;

  const variables = {};
  params.forEach((v, i) => { variables[String(i + 1)] = v; });

  const response = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    new URLSearchParams({
      From: `whatsapp:+${from}`,
      To:   `whatsapp:+${to}`,
      ContentSid: contentSid,
      ContentVariables: JSON.stringify(variables),
    }),
    { auth: { username: accountSid, password: authToken } }
  );
  return response.data;
}

async function sendRespondioTemplate(to, templateName, params) {
  // respond.io's template-message API schema is not confirmed yet (pending docs access) —
  // fall back to free text, same as the no-template path in outbound.js. Only works
  // inside respond.io's 24h session window until this is verified against real docs.
  console.warn(`[send-template] respondio template API unverified — falling back to free text for "${templateName}"`);
  const text = params.length ? `${templateName}: ${params.join(' | ')}` : templateName;
  return require('./respondio-service').sendMessage(`+${to}`, text);
}

module.exports = { sendTemplate };
