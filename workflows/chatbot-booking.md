# Workflow: WhatsApp Booking Conversation

## Objective
Handle inbound WhatsApp messages, understand customer intent, and book appointments in Airtable — all through Monterito.

## Tools Used
- `tools/airtable/get-client.js` — look up customer
- `tools/airtable/create-client.js` — register new customer
- `tools/airtable/get-history.js` — load conversation state
- `tools/airtable/get-availability.js` — query open slots (via Claude tool call)
- `tools/airtable/create-appointment.js` — book the appointment (via Claude tool call)
- `tools/airtable/append-message.js` — save conversation
- `src/conversation.js` — Claude API call with tool loop
- `tools/whatsapp/send-message.js` — send reply

## Conversation Flow

```
Customer sends message
        ↓
Parse webhook payload (WATI or Twilio format)
        ↓
Look up customer by phone in TABLA 1
  → Not found: create new record with phone number
        ↓
Load conversation history from TABLA 4 (Historial field)
        ↓
Call Claude API (claude-sonnet-4-6) with:
  - Monterito system prompt (shop info, services, rules)
  - Prior message history (last 20 messages)
  - Two tools: check_availability, book_appointment
        ↓
Claude responds or calls a tool:
  check_availability → query TABLA 3 → return open slots to Claude
  book_appointment   → write TABLA 2 + mark TABLA 3 slot unavailable
        ↓
Claude produces final reply text
        ↓
Send reply via WhatsApp provider
        ↓
Save both messages to TABLA 4 (Historial JSON)
```

## Expected Inputs
- Inbound webhook POST from WhatsApp provider to `/webhook`

## Expected Outputs
- WhatsApp reply sent to customer
- If booked: new record in TABLA 2 - Citas, slot marked in TABLA 3

## Edge Cases

| Situation | Behavior |
|---|---|
| No slots available | Monterito tells customer to call directly |
| Customer not found in TABLA 1 | Auto-created with phone number as placeholder name |
| Claude tool call fails | Error caught, customer receives apology message |
| Duplicate booking attempt | Claude confirms before calling book_appointment |
| Customer sends non-Spanish | Monterito responds in Spanish regardless |
| Airtable API rate limit | Retry once after 1s; log error if fails again |

## Notes
- The 24h WhatsApp session window means free-text replies work for active chats.
- For proactive outbound messages (reminders, surveys), approved templates are required.
- `Historial` field in TABLA 4 stores up to 20 messages as JSON. Older messages are trimmed automatically.
