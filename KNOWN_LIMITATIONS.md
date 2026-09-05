# Limitaciones conocidas — Monterito (TG Motors)

Actualizado: 2026-07-01

## Por diseño (acordado con el cliente)
- **Mono-taller.** No es multi-tenant. Un despliegue = un taller (config por variables de entorno). Soportar cientos de talleres requiere rearquitectura (`tenant_id` en todas las tablas).
- **Adjuntar PDF en WhatsApp = paso manual.** Los links `wa.me` (los que abre "Abrir WhatsApp") **solo pre-cargan texto, no archivos**. Al enviar orden/prefactura: se abre el chat con el resumen y **se descarga el PDF automáticamente**; el asesor lo **adjunta manualmente** (arrastrar al chat). No es posible pre-adjuntar un archivo vía `wa.me`.

## Detección de intervención humana
- **Auto-detección de "Diego respondió manual desde la app de WhatsApp": NO implementada** (quedó gated OFF). Depende de que 360dialog reenvíe al webhook los mensajes salientes del humano (Coexistence) — **NO VERIFICADO** en producción.
- Mecanismos que SÍ funcionan hoy para pasar a modo humano:
  - El bot escala solo (cotización/precio) → `WAITING_HUMAN` → queda en silencio.
  - Comandos del asesor desde el WhatsApp del dueño: `#humano <telefono>` (tomar), `#bot <telefono>` (devolver).
  - Reactivación automática por timeout (`HUMAN_TIMEOUT_MIN`, default 20 min).

## Batching de mensajes rápidos (anti-race)
- El **lock por teléfono** serializa los mensajes del mismo número (no se corrompe el historial). El **agrupamiento** de varios mensajes en una sola respuesta (`src/batcher.js`) está implementado y probado a nivel unitario, pero **NO cableado** al flujo en vivo (para no añadir latencia). Hoy cada mensaje recibe su respuesta, en orden.

## Silent AI Mode
- Mientras un humano atiende (`owner=HUMAN`), el bot **guarda el historial** pero NO responde. El análisis profundo adicional (clasificación de intención/emoción/venta) **no** se ejecuta en silencio todavía; es una mejora futura.

## Relay de cotizaciones
- Ruteo determinístico: el asesor debe **CITAR** (deslizar a responder) la notificación 📋 para reenvío exacto. Si responde **sin citar** y hay **más de una** consulta pendiente, el bot **no adivina**: pide que cite. Con **una sola** pendiente sin citar, el agente admin puede reenviarla.
- Las consultas pendientes **expiran a las 48h** para no contaminar el emparejamiento.

## Plantillas de WhatsApp (ventana 24h)
- Los envíos de texto libre (recordatorios, respuestas) solo llegan si el cliente escribió en las últimas 24h. `REMINDER_TEMPLATE_NAME` no está configurado → los recordatorios caen a texto libre. Para envíos fuera de 24h se requiere plantilla aprobada.

## Fallback de dedup sin message_id
- Si el proveedor no envía `message_id`, se usa un hash `telefono+ventana10s+body`. Riesgo mínimo: dos mensajes idénticos del mismo número en la misma ventana de 10s podrían tratarse como duplicado.

## Límites del loop agéntico (anti-spam)
- El loop LLM ↔ herramientas está topado a **4 iteraciones** por turno (`src/agent-limits.js`). Si el modelo no llega a una respuesta final, el bot manda un mensaje neutro ("lo confirmo con el equipo") y corta. Se cuenta en `/health` → `metrics.loopCapHits`.
- Cada herramienta con efecto externo (`alert_owner`, `consultar_precio`, `escalar_pago`, `book_appointment`, etc.) se ejecuta **máximo 1 vez por turno**.
- Notificaciones al dueño vía `src/owner-notify.js`: misma causa → 1 sola cada `OWNER_NOTIFY_COOLDOWN_MS` (10 min); texto idéntico → 1 sola cada 60 min.

## Watchdog de turno
- `withLock` (`tools/lock.js`) corta cualquier turno que tarde más de `LOCK_TIMEOUT_MS` (45s): el cliente recibe un fallback y la cola de ese teléfono se libera. Un turno colgado no congela los mensajes siguientes.

## LLM (Groq)
- Primario `GROQ_MODEL`, respaldo automático `GROQ_FALLBACK_MODEL` ante timeout/429/5xx/`model_decommissioned`. Timeout duro `GROQ_TIMEOUT_MS` (20s). Rotar modelo = 1 variable (ver RUNBOOK).

## Fast-path determinístico
- Un dígito suelto ("1".."5") solo se interpreta como opción de menú si el bot **acaba de mostrar** el menú numerado (o es el primer contacto). En medio de otra conversación, el dígito lo maneja el LLM.
- El bot **no** agenda citas por regex; agendar siempre pasa por el LLM + `book_appointment` con confirmación.

## Integraciones no conectadas
- **Airtable**: variables presentes, sin uso en código.
- **Google Calendar**: no implementado; el calendario es interno (tabla `disponibilidad`).
- **Twilio / respond.io**: código presente pero inactivo (provider activo = 360dialog).
