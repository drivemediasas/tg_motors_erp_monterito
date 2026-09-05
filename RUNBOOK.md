# Runbook operativo — Monterito (TG Motors)

Actualizado: 2026-07-01

## Servicio
- **Hosting:** Railway, proyecto `tg-motors-monterito`, entorno `production`, servicio `tg-motors-monterito`.
- **URL:** https://tg-motors-monterito-production.up.railway.app
- **Arranque:** `node src/server.js` (railway.toml, nixpacks, restart on_failure ×3).
- **DB:** PostgreSQL gestionada por Railway (`DATABASE_URL` interno).
- **WhatsApp:** 360dialog Cloud API (`WHATSAPP_PROVIDER=360dialog`).

## Comandos
```bash
railway status                 # proyecto/entorno/servicio
railway logs                   # logs en vivo
railway up --detach            # desplegar (NO usar redeploy --from-source)
railway variables              # ver variables
curl -s <URL>/health           # estado (provider, guards, stats, metrics)
npm test                       # corre las 5 suites (control, isolation, agent-limits, owner-notify, quick-reply)
```
Nota: el directorio del proyecto termina en espacio: `Workflow TG Motors ` (usar comillas).

## Variables de entorno
Críticas: `DATABASE_URL`, `LLM_API_KEY`, `WHATSAPP_PROVIDER=360dialog`, `D360_API_KEY`, `D360_WEBHOOK_SECRET`, `OWNER_PHONE` (número de Diego: `593987189276`), `DASHBOARD_EMAIL`, `DASHBOARD_PASSWORD`.
LLM (default = Gemini free tier, 1M tokens/min): `LLM_API_KEY` (key gratis: https://aistudio.google.com/apikey), `LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai`, `LLM_MODEL=gemini-3.6-flash`, `LLM_FALLBACK_MODEL=gemini-3.6-flash`. Para Groq: `LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_MODEL=openai/gpt-oss-120b`. Los nombres viejos `GROQ_*` siguen funcionando.
Config taller: `SHOP_NAME/CITY/ADDRESS/HOURS/SERVICES`, `SHOP_TECHNICIANS`, `SHOP_CAPACITY`, `GOOGLE_REVIEW_URL`, `OWNER_NAME`.
Resiliencia (default): `HUMAN_TIMEOUT_MIN=20`, `LOCK_TIMEOUT_MS=45000`, `OWNER_NOTIFY_COOLDOWN_MS=600000`, `DB_POOL_MAX=10`, `BATCH_MS=1200`, `COEXISTENCE_ECHO_DETECT=on`, `REMINDER_TEMPLATE_NAME`.

## Quién habla con quién
- El bot **solo** conversa con **clientes** del taller.
- **`OWNER_PHONE` (Diego)**: el bot lo IGNORA. Diego usa ese chat para hablar con la administradora
  (su hermana). El bot solo reacciona a comandos: `#humano <tel>`, `#bot <tel>`, `#proveedor <tel>`,
  `#cliente <tel>` — o a una respuesta CITANDO la notificación 📋 de una consulta de precio.
- **La administradora** atiende el número desde la app de WhatsApp. Para que el bot calle mientras
  ella responde a un cliente: hoy, `#humano <tel del cliente>` desde el chat de Diego. La detección
  automática (`COEXISTENCE_ECHO_DETECT=on`) está **apagada** hasta verificar el payload real —
  ver "Activar detección de respuesta humana" abajo.
- **No hay número de QA con permisos especiales**: para probar, se usa cualquier número que NO sea
  `OWNER_PHONE` y se comporta 100% como cliente.

## Activar detección de respuesta humana (coexistence)
1. Con `COEXISTENCE_ECHO_DETECT=on` (default), pedir a alguien que responda a un cliente desde la
   app de WhatsApp del taller y capturar en `railway logs` la línea `[360dialog] webhook received`
   y el evento asociado (necesitamos ver `metadata.display_phone_number`, `messages[0].from`,
   `messages[0].id` y a quién iba dirigido).
2. Confirmar que el `id` del eco de un mensaje que mandó el bot coincide con el que devolvió la API
   (si no coincide, hay que ajustar `wasSentByBot`).
3. Recién ahí: `railway variables --set COEXISTENCE_ECHO_DETECT=on` y subir `HUMAN_TIMEOUT_MIN=60`.

## Rotar el modelo LLM
1. Ver modelos vigentes en Groq: https://console.groq.com/docs/models (o `curl https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"`).
2. `railway variables --set GROQ_MODEL=<nuevo-modelo>` y `railway up --detach`.
3. El `GROQ_FALLBACK_MODEL` cubre automáticamente si el primario devuelve `model_decommissioned`/5xx/timeout — no hay downtime por una deprecación.
4. Verificar en `/health` que `metrics.groqFallbackUsed` no suba de forma sostenida.

## Señales de número WhatsApp en riesgo (Meta quality rating)
- En el panel de 360dialog, revisar el "quality rating" del número. Si baja a amarillo/rojo:
  - Mirar `/health` → `metrics.ownerNotifications` (alertas al dueño) y `metrics.loopCapHits` (loops de tools cortados). Si suben rápido, hay algo generando spam.
  - `metrics.ownerNotificationsSuppressed` alto = el rate-limit está conteniendo una ráfaga (bien, pero investigar el origen en `railway logs`).

## Diagnóstico rápido
- **Bot no responde** → `railway logs`; buscar `[CONTROL]` (decision/owner). Si `owner=HUMAN`, está en modo humano: `#bot <telefono>` para devolver, o espera timeout (20 min). Si `[SAFE_MODE]`, hubo un error: revisar y devolver con `#bot`.
- **Cliente recibió precio equivocado** → ver `[CONTROL] relay` (routed_by). Regla: Diego debe **citar** la notificación 📋. Consultas viejas (>48h) no se emparejan.
- **Respuestas duplicadas** → revisar `duplicate_webhook_ignored`; el dedup es durable (`mensajes_procesados`). `/webhook` y `/webhook/360dialog` comparten el mismo handler deduplicado — el webhook de 360dialog debe apuntar a **una sola** de las dos URLs.
- **Bot spammea al dueño / quema cuota** → `railway logs` buscar `[conversation] tope de iteraciones` y `[owner-notify] suprimido`. El loop de tools está topado a 4 iteraciones y las alertas al dueño tienen cooldown de 10 min (`OWNER_NOTIFY_COOLDOWN_MS`).
- **Turno colgado** → `[lock] watchdog_timeout` en logs: un turno tardó >45s y se cortó; el cliente recibió un fallback y la cola se liberó (no se congela el número).
- **Webhook** → 403 = falta/no coincide `D360_WEBHOOK_SECRET`. 200 y sin respuesta = revisar logs de procesamiento.
- **DB caída** → `ensureSchema falló` en logs; Railway reintenta; el server no crashea.

## Operación del asesor (WhatsApp del dueño)
- Responder cotización: **CITAR** la notificación 📋 y escribir el precio → el bot lo reenvía al cliente y cierra la consulta.
- Tomar un chat: `#humano <telefono>` (el bot calla para ese cliente).
- Devolver al bot: `#bot <telefono>`.

## Rollback
1. `git log --oneline` → identificar commit estable previo.
2. `git checkout <commit> -- <archivos>` o `git revert`.
3. `railway up --detach`.
4. Verificar `/health` y `railway logs`.
Las tablas/columnas nuevas son aditivas e idempotentes; no requieren migración inversa.
