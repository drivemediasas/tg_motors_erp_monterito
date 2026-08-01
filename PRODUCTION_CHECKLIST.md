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
- [x] `node tools/test/isolation.test.js` → 8/8
- [x] `node tools/test/control.test.js` → 14/14
- [x] `node --check` en todos los .js
- [ ] `npm test` / `npm run lint` — NO DISPONIBLE (no configurados)

## Pendiente manual antes de cobrar
- [ ] Prueba en vivo por WhatsApp: cliente nuevo, cotización, relay citado por Diego, `#humano`/`#bot`.
- [ ] (Opcional) Cargar `precios_estandar` con la lista del dueño.
- [ ] (Opcional) Configurar `REMINDER_TEMPLATE_NAME` para recordatorios fuera de 24h.
