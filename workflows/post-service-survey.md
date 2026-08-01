# Workflow: Post-Service Survey & Google Review Request

## Objective
After a service is marked complete, send a satisfaction survey. If the customer rates 4-5 stars, automatically request a Google Review.

## Tools Used
- `tools/airtable/update-appointment.js` → `getAppointmentsNeedingSurvey()`
- `tools/whatsapp/send-message.js` — send survey
- `tools/airtable/update-appointment.js` → `updateAppointment()` — mark survey sent
- `src/handlers/outbound.js` → `sendReviewRequest()` — triggered inline when reply arrives

## Trigger
- **Survey send**: Cron job daily at 18:00 Ecuador (23:00 UTC)
- **Review request**: Triggered inside `src/handlers/message.js` when a customer replies with a star rating

## Logic

### Part 1 — Send Survey (cron)
```
Daily at 18:00:
  Query TABLA 2 where:
    Estado = "Completado"
    AND Seguimiento ≠ "survey_sent"
  
  For each appointment:
    Send message asking for 1-5 star rating
    Update TABLA 2: Seguimiento = "survey_sent"
```

### Part 2 — Handle Survey Reply (inbound)
Survey replies are regular WhatsApp messages, processed by Monterito.
The Claude prompt is not configured to handle star ratings — add the following detection logic to `src/handlers/message.js`:

```js
// After parsing the inbound message text:
const starRating = parseInt(text.trim(), 10);
if (starRating >= 1 && starRating <= 5) {
  if (starRating >= 4) {
    await sendReviewRequest(from, clientRecord.nombre);
  } else {
    await sendMessage(from, `Lamentamos que tu experiencia no haya sido perfecta, ${clientRecord.nombre}. Tu opinión es muy importante para nosotros. ¿Nos puedes contar qué podríamos mejorar?`);
  }
  return; // Don't pass rating to Claude
}
```

> This logic is not yet wired in `message.js`. Add it as the next improvement once core flow is tested.

## Required Airtable Fields (TABLA 2)
- `Estado` — must be "Completado" to trigger survey
- `Seguimiento` — set to "survey_sent" after sending
- `Nombre_Cliente` — displayed in message
- `Tel_fono` — recipient

## Required Env Vars
- `GOOGLE_REVIEW_URL` — Google Maps review link for the shop

## Edge Cases

| Situation | Behavior |
|---|---|
| `GOOGLE_REVIEW_URL` not set | Review request skipped, warning logged |
| Customer ignores survey | No follow-up (don't spam) |
| Customer replies with text instead of number | Monterito handles it as a normal conversation |
| Service marked complete same day as appointment | Survey fires that evening (same-day cron run) |
