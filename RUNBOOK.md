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
curl -s <URL>/health           # estado (provider, guards, stats)
node tools/test/isolation.test.js   # tests de aislamiento (8)
node tools/test/control.test.js     # tests de control (14)
```
Nota: el directorio del proyecto termina en espacio: `Workflow TG Motors ` (usar comillas).

## Variables de entorno
Críticas: `DATABASE_URL`, `ANTHROPIC_API_KEY`, `WHATSAPP_PROVIDER=360dialog`, `D360_API_KEY`, `D360_WEBHOOK_SECRET`, `OWNER_PHONE`, `DASHBOARD_EMAIL`, `DASHBOARD_PASSWORD`.
Config taller: `SHOP_NAME/CITY/ADDRESS/HOURS/SERVICES`, `SHOP_TECHNICIANS`, `SHOP_CAPACITY`, `GOOGLE_REVIEW_URL`, `OWNER_NAME`.
Opcionales (con default): `HUMAN_TIMEOUT_MIN=20`, `BATCH_MS=1200`, `REMINDER_TEMPLATE_NAME`.

## Diagnóstico rápido
- **Bot no responde** → `railway logs`; buscar `[CONTROL]` (decision/owner). Si `owner=HUMAN`, está en modo humano: `#bot <telefono>` para devolver, o espera timeout (20 min). Si `[SAFE_MODE]`, hubo un error: revisar y devolver con `#bot`.
- **Cliente recibió precio equivocado** → ver `[CONTROL] relay` (routed_by). Regla: Diego debe **citar** la notificación 📋. Consultas viejas (>48h) no se emparejan.
- **Respuestas duplicadas** → revisar `duplicate_webhook_ignored`; el dedup es durable (`mensajes_procesados`).
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
