#!/usr/bin/env node
/**
 * new-client.js
 * Interactive CLI to generate a .env file for a new client deployment.
 * Run: node scripts/new-client.js
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const template = require('../config/client.template.json');
const ROOT = path.join(__dirname, '..');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, defaultValue = '') {
  return new Promise(resolve => {
    const hint = defaultValue ? ` (default: ${defaultValue})` : '';
    rl.question(`${question}${hint}: `, answer => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

async function main() {
  console.log('\n=== Monterito — New Client Setup ===\n');

  const values = {};

  values.SHOP_NAME             = await ask('Shop name');
  values.SHOP_CITY             = await ask('City');
  values.SHOP_ADDRESS          = await ask('Address (optional)');
  values.SHOP_HOURS            = await ask('Business hours', template.SHOP_HOURS);
  values.SHOP_SERVICES         = await ask('Services (comma-separated)', template.SHOP_SERVICES);
  values.GOOGLE_REVIEW_URL     = await ask('Google Review URL (optional)');

  console.log('\n--- Airtable ---');
  values.AIRTABLE_API_KEY      = await ask('Airtable API key');
  values.AIRTABLE_BASE_ID      = await ask('Airtable Base ID');

  console.log('\n--- Claude ---');
  values.ANTHROPIC_API_KEY     = await ask('Anthropic API key');

  console.log('\n--- WhatsApp ---');
  values.WHATSAPP_PROVIDER     = await ask('Provider (wati/twilio)', 'wati');
  values.WHATSAPP_API_URL      = await ask('WhatsApp API URL');
  values.WHATSAPP_API_KEY      = await ask('WhatsApp API key');
  values.WHATSAPP_PHONE_NUMBER_ID = await ask('WhatsApp phone number (digits only, no +)');
  values.WEBHOOK_VERIFY_TOKEN  = await ask('Webhook verify token', crypto.randomBytes(12).toString('hex'));
  values.REMINDER_TEMPLATE_NAME = await ask('Reminder template name (leave blank if not approved yet)');

  values.PORT = '3000';

  // Write .env
  const envLines = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const envPath = path.join(ROOT, '.env');
  fs.writeFileSync(envPath, envLines + '\n', 'utf8');

  console.log(`\n✅ .env written to ${envPath}`);
  console.log('\nNext steps:');
  console.log('  1. Deploy to Railway: railway up');
  console.log('  2. Set Railway env vars from the .env file');
  console.log('  3. Register the webhook URL in your WhatsApp provider');
  console.log(`     Webhook URL: https://<your-railway-domain>/webhook`);
  console.log(`     Verify token: ${values.WEBHOOK_VERIFY_TOKEN}`);
  console.log('  4. Test by sending a WhatsApp message to the client number\n');

  rl.close();
}

main().catch(err => {
  console.error(err);
  rl.close();
  process.exit(1);
});
