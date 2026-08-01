# Workflow: Choose & Connect WhatsApp Provider

## Objective
Select and configure the WhatsApp API provider that routes messages to/from Monterito.

## Provider Comparison

| | WATI | Twilio | 360dialog | respond.io |
|---|---|---|---|---|
| Monthly base | $49 | $10 | $5 | desde $99 (Advanced+) |
| Per message | Included (tier) | $0.005 | Usage-based | Incluido en plan |
| Setup time | ~30 min | ~60 min | ~90 min | ~45 min (si el canal de WhatsApp ya existe) |
| Agent inbox (human takeover) | ✅ | ❌ | ❌ | ✅ (es su producto principal) |
| Template approval UI | Built-in | Manual via Meta | Manual via Meta | Built-in |
| Best for | Agencias, fast deploy | Dev flexibility | High volume scale | Equipos que ya usan respond.io como inbox/CRM |

**Recommendation: WATI** para clientes nuevos. Twilio o 360dialog solo si el volumen excede el tier de WATI o el cliente necesita integraciones custom. **respond.io** tiene sentido cuando el cliente ya usa respond.io como bandeja de entrada/CRM y quiere que Monterito responda ahí mismo.

## Inputs Required
- Client's existing WhatsApp Business number (or provision a new one)
- Chosen provider account credentials
- Meta Business Manager access (needed to link the number)

## Setup Steps (WATI)

1. Create WATI account at wati.io
2. Connect the WhatsApp Business number:
   - Go to Settings → WhatsApp API → Connect Number
   - Follow the Meta Business Manager linking flow
   - Verify the number with OTP
3. Copy API credentials from Settings → API:
   - API URL → `WHATSAPP_API_URL` in `.env`
   - API Key → `WHATSAPP_API_KEY` in `.env`
4. Set `WHATSAPP_PROVIDER=wati` in `.env`
5. Set `WEBHOOK_VERIFY_TOKEN` to a secret string and register the webhook URL:
   - URL: `https://<your-railway-domain>/webhook`
   - Token: value from `WEBHOOK_VERIFY_TOKEN`

## Setup Steps (Twilio)

1. Create Twilio account, enable WhatsApp Sandbox or production number
2. Copy Account SID → `TWILIO_ACCOUNT_SID`
3. Copy Auth Token → `TWILIO_AUTH_TOKEN`
4. Copy the WhatsApp number (digits only, no +) → `WHATSAPP_PHONE_NUMBER_ID`
5. Set `WHATSAPP_PROVIDER=twilio` in `.env`
6. In Twilio Console → Messaging → WhatsApp, set webhook URL to `https://<railway-domain>/webhook`

## Setup Steps (respond.io)

1. El número de WhatsApp debe estar conectado como canal dentro de respond.io (Settings → Channels) **antes** de este paso — respond.io no recibe nada si el canal no está enlazado.
2. Token de Developer API (requiere plan Growth o superior):
   - Settings → Integrations → Developer API → Add Access Token
   - Copiar el token → `RESPOND_IO_API_TOKEN` en `.env`
3. Set `RESPOND_IO_API_BASE_URL=https://api.respond.io` y un secreto propio en `RESPOND_IO_WEBHOOK_SECRET` (cualquier string random).
4. Registrar el webhook (requiere plan Advanced o superior):
   - Workspace Settings → Integrations → Webhooks → Add Webhook
   - Endpoint URL: `https://<railway-domain>/webhook/respondio?secret=<RESPOND_IO_WEBHOOK_SECRET>`
   - Evento: seleccionar **solo** "New Incoming Message" (así respond.io ya filtra los mensajes salientes/eco antes de llegar al bot)
5. Set `WHATSAPP_PROVIDER=respondio` en `.env`/Railway recién después de probar el webhook con un mensaje real (ver `tools/whatsapp/respondio-service.js` y `src/handlers/respondio.js`).

## Templates Required (for reminders)

These must be submitted to WhatsApp for approval before use:

| Template name | Use | Placeholders |
|---|---|---|
| `recordatorio_cita` | 24h appointment reminder | {{1}} nombre, {{2}} servicio, {{3}} fecha, {{4}} hora, {{5}} taller |
| `encuesta_satisfaccion` | Post-service survey | {{1}} nombre, {{2}} taller |
| `recordatorio_mantenimiento` | 4-month maintenance | {{1}} nombre, {{2}} vehiculo, {{3}} taller |

Set `REMINDER_TEMPLATE_NAME=recordatorio_cita` in `.env` after template is approved.
If no template is set, Monterito falls back to free-text messages (only works within 24h session window).

## Edge Cases
- **Number migration**: WhatsApp only allows a number to be linked to one API at a time. Remove it from WhatsApp Business App first.
- **Approval time**: Template approval takes 24-48h. Plan accordingly before go-live.
- **Session window**: Free-text replies are only allowed within 24h of the customer's last message. Outbound proactive messages (reminders, surveys) MUST use approved templates.
- **respond.io — esquema de webhook no confirmado**: el payload exacto de "New Incoming Message" no se pudo verificar contra la doc oficial (sitio SPA). El handler (`src/handlers/respondio.js`) loggea siempre el payload crudo (`[respondio] raw payload:`) — usar el primer mensaje real para ajustar `parseRespondioPayload` si hace falta.
- **respond.io — límite de reintentos**: el webhook se autodesactiva tras 30 fallos en 30 minutos, y el endpoint debe responder 200 en menos de 5s (ya cumplido: `res.status(200).end()` se envía antes de procesar).
- **respond.io — plantillas sin confirmar**: `sendTemplate` con `WHATSAPP_PROVIDER=respondio` cae a texto libre (no a una plantilla real de respond.io) hasta confirmar el endpoint de plantillas contra la doc oficial.
