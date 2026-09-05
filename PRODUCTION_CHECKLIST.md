# Production Checklist — Monterito (TG Motors)

Actualizado: 2026-07-01 · Entorno: Railway `tg-motors-monterito` / production

## Infra / arranque
- [x] App arranca sin errores (`[server] ... corriendo en puerto 3000`)
- [x] Railway deploy exitoso (nixpacks, `node src/server.js`, restart on_failure)
- [x] PostgreSQL conecta (`[db] ensureSchema OK ...`)
- [x] `ensureSchema` idempotente (tablas/columnas con IF NOT EXISTS)
- [x] Scheduler activo (4 cron jobs)
- [x] `/health` responde 200 con `provider: 360dialog` + `guards` + stats

## WhatsApp (360dialog)
- [x] Webhook `POST /webhook/360dialog` operativo
- [x] Webhook protegido (403 sin `D360_WEBHOOK_SECRET`)
- [x] Responde 200 de inmediato y procesa async
- [x] Dedup durable de webhooks (`mensajes_procesados`) — sobrevive reinicios
- [x] Acuse de audio/imagen/sticker sin LLM

## Aislamiento y control de conversación
- [x] Historial por `telefono` (wa_id); sin historial global compartido
- [x] `shouldBotRespond` = único punto de decisión (el LLM no decide si responde)
- [x] Lock por teléfono (serializa mismo número; paralelo entre números)
- [x] Relay de Diego determinístico (cita → cliente exacto; >1 sin cita → no adivina)
- [x] Consultas cierran por id + expiran a 48h
- [x] Modo humano: `#humano`/`#bot` + `WAITING_HUMAN` + timeout 20 min
- [x] Bot en silencio mientras `owner=HUMAN` (guarda historial)
- [x] SAFE MODE ante error (→ HUMAN, no responde, avisa admin)
- [x] Anti-loop (dedup + last_answered_message_id) / anti-spam (repetidos)

## Negocio (ERP)
- [x] Dashboard admin operativo (login por sesión)
- [x] Órdenes de trabajo (crear/editar/estado)
- [x] Prefactura con IVA 15% + PDF imprimible
- [x] "Abrir WhatsApp" abre chat + descarga PDF + recordatorio de adjuntar
- [x] Catálogo (buscador nativo por `<select>`; precios curados)
- [x] Finanzas / Categorías / Calendario / Reincidencias

## Seguridad
- [x] Sin credenciales hardcodeadas (todo `process.env`)
- [x] SQL parametrizado / columnas en whitelist (sin inyección)
- [x] Guards: rate limit, longitud, prompt-injection, filtro de tema

## Tests
- [x] `npm test` → 5 suites verdes (control, isolation, agent-limits, owner-notify, quick-reply)
- [x] CI en GitHub Actions (`.github/workflows/ci.yml`) corre `npm test` + boot en cada push/PR

## Resiliencia (anti-bloqueo / anti-spam)
- [x] Loop de tools topado a 4 iteraciones (`src/agent-limits.js`)
- [x] Herramientas con efecto externo: máx. 1 vez por turno
- [x] Alertas al dueño con rate-limit + dedup (`src/owner-notify.js`, cooldown 10 min)
- [x] Timeout duro a Groq (20s) + fallback automático de modelo
- [x] Watchdog de 45s por turno (`tools/lock.js`) — un turno colgado no congela el número
- [x] Timeouts de DB (connection 5s, statement 8s)
- [x] Reintento de envío 360dialog ante 5xx/timeout
- [x] `uncaughtException` logueado sin tumbar el proceso
- [x] `/health` expone `metrics` (loopCapHits, ownerNotifications, groqTimeouts, turnTimeouts, ...)

## Pre-deploy (cada vez)
- [ ] `npm test` local en verde
- [ ] Variables Railway: `OWNER_PHONE=593987189276`, `ADMIN_PHONE=593999648041` (QA), `GROQ_API_KEY` seteada
- [ ] 360dialog: el webhook apunta a **una sola** URL (`/webhook/360dialog`)
- [ ] Tras `railway up`: `curl /health` 200 + `railway logs` sin `[SAFE_MODE]` en el arranque

## Pendiente manual antes de cobrar
- [ ] Plan de prueba funcional por WhatsApp (secciones A–H del plan) 100% en verde
- [ ] (Opcional) Cargar `precios_estandar` con la lista del dueño.
- [ ] (Opcional) Configurar `REMINDER_TEMPLATE_NAME` para recordatorios fuera de 24h.
