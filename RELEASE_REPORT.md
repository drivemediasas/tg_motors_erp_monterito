# Release Report — Monterito (TG Motors)

- **Fecha:** 2026-07-01
- **Release:** Producción — Etapa 1 (estabilidad) + Etapa 2 (Conversation Control Layer) + PDF-en-WhatsApp
- **Entorno:** Railway `tg-motors-monterito` / production
- **Provider WhatsApp:** 360dialog

## Archivos modificados / nuevos
| Archivo | Cambio |
|---|---|
| `src/relay-router.js` (nuevo) | `decideRelayTarget` puro (ruteo determinístico) |
| `tools/db/price-inquiries.js` | `answerPriceInquiryById`, filtro pendiente/48h, columnas vehiculo/placa/concepto |
| `src/handlers/message.js` | relay determinístico server-side, control gate, lock, SAFE MODE, comandos #humano/#bot |
| `tools/db/messages-processed.js` (nuevo) | dedup durable (`markProcessedDurable`) |
| `src/handlers/360dialog.js` | dedup durable + memoria, `quotedId`, `messageId` |
| `tools/lock.js` (nuevo) | `withLock` por teléfono |
| `src/control.js` (nuevo) | `shouldBotRespond`, `parseAdvisorCommand` |
| `tools/db/conversation-state.js` (nuevo) | ownership/mode (get/set/takeOver/release) |
| `src/safe-mode.js` (nuevo) | Emergency Switch → HUMAN + notifica admin |
| `src/batcher.js` (nuevo) | agrupamiento (probado, NO cableado) |
| `src/conversation.js` | escala a WAITING_HUMAN en `consultar_precio`, pasa vehículo/placa |
| `src/server.js` | ensureSchema: `mensajes_procesados` + columnas control; safe-net global |
| `tools/whatsapp/notify-owner-price.js` | pide CITAR el mensaje |
| `public/admin.html` | "Abrir WhatsApp" abre chat + descarga PDF + recordatorio de adjuntar |
| `tools/test/isolation.test.js`, `tools/test/control.test.js` (nuevos) | harness |
| Docs (nuevos) | PRODUCTION_CHECKLIST, RUNBOOK, KNOWN_LIMITATIONS, este reporte |

## Pruebas ejecutadas
| Comando | Resultado |
|---|---|
| `node --check` (todos los .js de src/ y tools/) | ✅ PASS |
| `node tools/test/isolation.test.js` | ✅ 8/8 |
| `node tools/test/control.test.js` | ✅ 14/14 |
| Compilación JS inline de admin.html | ✅ PASS |
| Scan SQL injection / credenciales | ✅ Limpio |
| `npm test` / `npm run lint` | ⚪ NO DISPONIBLE (no configurados) |

## Validación de flujos (FASE 3)
| # | Caso | Resultado |
|---|---|---|
| 3,6 | Relay: Diego cita la consulta → cliente correcto | ✅ PASS (lógica) |
| 7 | Diego sin citar con >1 pendiente → no adivina | ✅ PASS (lógica) |
| 10,11 | Aislamiento entre clientes | ✅ PASS |
| 12,13 | Webhook duplicado / dedup | ✅ PASS |
| 8,9 | Respuesta 30min/48h (persistencia) | ✅ PASS (lógica) |
| 14,15,16 | Humano toma / bot calla / #bot devuelve | ✅ PASS (lógica) |
| 1,2,4,17,18,19,20 | Cliente real, cita, repuesto, PDF, orden, dashboard, scheduler | 🟡 NO VERIFICADO (requiere prueba en vivo por WhatsApp) |

## Errores encontrados y corregidos (durante la sesión)
- Relay cruzaba cotizaciones (adivinaba destinatario) → ahora determinístico por mensaje citado + cierre por id + expiración 48h.
- Dedup solo en memoria → dedup durable en PostgreSQL.
- Posible race del historial del mismo número → lock por teléfono.
- Cliente registrado en otro formato de número no se reconocía → lookup normalizado (últimos 9 dígitos).
- "Abrir WhatsApp" no adjuntaba PDF → ahora descarga el PDF + recordatorio (wa.me no permite adjuntar archivos).

## Estado
- **Railway:** ✅ redeploy exitoso, sin crash.
- **DB:** ✅ conecta, ensureSchema OK, idempotente.
- **WhatsApp:** ✅ webhook 200/403 correcto, dedup durable.
- **Dashboard:** ✅ operativo (JS compila, sin cambios de lógica comercial).
- **Bot:** ✅ responde con guards + control layer.
- **Relay humano:** ✅ determinístico + modo humano + SAFE MODE.

## Riesgos restantes
- Adjuntar PDF = manual (limitación de wa.me). — Bajo
- Auto-detección de mensajes manuales de Diego: no implementada (gated). — Bajo (mitigado con #humano/#bot + WAITING_HUMAN)
- Batcher no cableado (lock cubre la seguridad de race). — Bajo
- Envíos fuera de ventana 24h requieren plantilla. — Medio (operativo)
- Flujos end-to-end no verificados en vivo. — Medio → requiere 1 prueba real

## Veredicto
**LISTO CON MONITOREO** para el taller único TG Motors: el núcleo (aislamiento, relay determinístico, dedup, lock, modo humano, SAFE MODE, dashboard, prefacturas) está estable, testeado y desplegado. Falta **una prueba en vivo por WhatsApp** (flujos 1–20 marcados NO VERIFICADO) antes de declararlo 100%.
