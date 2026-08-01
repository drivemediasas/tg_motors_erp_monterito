# Workflow: 4-Month Maintenance Reminder

## Objective
Proactively re-engage customers who haven't visited in ~4 months by sending a personalized maintenance reminder via WhatsApp.

## Tools Used
- `tools/airtable/get-maintenance-due.js` → `getMaintenanceDue()`
- `tools/whatsapp/send-message.js` — send reminder
- `tools/airtable/get-maintenance-due.js` → `markMaintenanceReminded()` — prevent duplicates

## Trigger
Cron job — runs **daily at 09:00 Ecuador time** (14:00 UTC) via `src/scheduler.js`.

## Logic

```
Daily at 09:00:
  Query TABLA 1 where:
    Fecha último servicio is between 110 and 130 days ago
    AND Notas ≠ "maintenance_reminded"
  
  For each client:
    Send personalized message mentioning their vehicle (if available)
    Update TABLA 1: Notas = "maintenance_reminded"
```

## Window Rationale
- 110-130 days = ~3.7 to 4.3 months
- The 20-day window ensures the cron job catches each client exactly once even with timezone drift or missed runs

## Required Airtable Fields (TABLA 1)
- `Fecha último servicio` — used to calculate elapsed time
- `Nombre` — displayed in message
- `Teléfono` — recipient
- `Marca`, `Modelo` — personalize the message ("tu Toyota Fortuner")
- `Notas` — set to "maintenance_reminded" to prevent duplicate sends

## Edge Cases

| Situation | Behavior |
|---|---|
| `Notas` already has other content | Current logic overwrites Notas with "maintenance_reminded". **If you store other data in Notas, add a dedicated `Mantenimiento_Recordado` checkbox field instead.** |
| Client has no phone number | Record skipped, error logged |
| Client has already booked a new appointment | Reminder still sends (no appointment check). Add a filter by `TABLA 2` if this becomes an issue. |
| Client books after receiving reminder | Happy path — they'll go through the normal booking flow |

## Upgrade Path
When volume grows, replace the `Notas` flag with a dedicated `Mantenimiento_Recordado` (checkbox) field in TABLA 1 to avoid conflicts with other note content.
