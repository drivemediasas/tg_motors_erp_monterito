# Workflow: Appointment Reminders (~2h before)

## Objective
Automatically remind customers of their upcoming appointment **~2 hours before the appointment time**, via WhatsApp. (Antes era 24h antes; se cambió porque caía justo después de la confirmación y se sentía como doble confirmación.)

## Tools Used
- `tools/db/update-appointment.js` → `getAppointmentsNeedingReminder()`
- `tools/whatsapp/send-template.js` (si `REMINDER_TEMPLATE_NAME` está seteado) o `send-message.js` (texto libre, por defecto)
- `tools/db/update-appointment.js` → `updateAppointment()` para marcar `seguimiento = 'reminder_sent'`

## Trigger
Cron job — corre **cada 15 min** vía `src/scheduler.js` (`*/15 * * * *`).

## Logic

```
Cada 15 min:
  Query `citas` donde:
    (fecha + hora) AT TIME ZONE 'America/Guayaquil'  ∈  [NOW(), NOW() + 2h]
    AND seguimiento IS NULL OR seguimiento != 'reminder_sent'
    AND estado = 'Pendiente'

  Para cada cita:
    Si REMINDER_TEMPLATE_NAME está seteado:
      Enviar plantilla con params: [nombre, servicio, fecha, hora, shop_name]
    Si no:
      Enviar recordatorio de texto libre (sencillo, "cita de hoy")

    Marcar la cita: seguimiento = 'reminder_sent'
```

`fecha + hora` es la hora local (Ecuador) tal como se agendó. `AT TIME ZONE 'America/Guayaquil'` la convierte al instante UTC real, así la comparación con `NOW()` es correcta **sin depender de la TZ del servidor** (Railway corre en UTC — no hace falta setear `TZ`). Con el dedupe por `seguimiento='reminder_sent'`, el recordatorio se envía una sola vez, en el primer tick del cron en que la cita entra a la ventana de ≤2h.

## Campos de `citas` usados
- `nombre_cliente` — se muestra en el mensaje
- `telefono` — destinatario
- `servicio_solicitado` — se muestra en el mensaje
- `fecha` (DATE) + `hora` (TIME) — usados para el filtro de la ventana de 2h
- `estado` — debe ser 'Pendiente' para incluirse
- `seguimiento` — se pone en 'reminder_sent' tras enviar

## Edge Cases

| Situación | Comportamiento |
|---|---|
| Plantilla no aprobada aún | Cae a texto libre. Setear `REMINDER_TEMPLATE_NAME` solo tras aprobación (nota: la plantilla actual aún incluye `fecha`; crear una nueva de 2h si se migra a plantilla). |
| Cliente bloqueó WhatsApp | El proveedor retorna error; se loguea, no se reintenta |
| Query retorna 0 filas | No hay acción, el job termina en silencio |
| Cita cancelada tras el recordatorio | Sin impacto — el recordatorio ya se envió |
| Misma cita en dos ticks seguidos del cron | `seguimiento = 'reminder_sent'` evita doble envío |
| Reserva hecha con <2h de anticipación | Entra a la ventana de inmediato → recibe el recordatorio casi al confirmar (poco frecuente; aceptado) |
| Cron se salta ticks (reinicio de Railway) | La ventana `[NOW(), NOW()+2h]` recupera cualquier cita futura no recordada aún → se envía apenas se reanuda el cron |

## Notes
- La conversión con `AT TIME ZONE 'America/Guayaquil'` hace el filtro independiente de la TZ del servidor. Los otros crons (encuestas, mantenimiento) sí dependen de UTC en `src/scheduler.js`; no se tocaron.
