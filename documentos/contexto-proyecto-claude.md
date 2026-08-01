# Contexto del Proyecto — Monterito / ERP para talleres (para Proyecto de Claude · Marketing)

> **Cómo usar este archivo:** pégalo completo como "Instrucciones del proyecto" (o como documento de
> conocimiento) en un Proyecto de Claude. Le da a Claude el contexto exacto de qué es el producto, cómo
> está construido y cómo opera el negocio, para que genere estrategia y materiales de marketing
> fundamentados en la realidad del sistema. Para el pedido concreto de estrategia, combínalo con
> `master-prompt-marketing-erp.md`.

---

## Propósito y contexto

Emilio es el fundador de **DRIVEMEDIA S.A.S.**, una agencia de automatización con IA basada en Quito,
Ecuador, especializada en sistemas de automatización por WhatsApp potenciados con IA para PYMES. Su
modelo de negocio combina un **fee de implementación único (setup)** con una **mensualidad recurrente de
mantenimiento por cliente**. Su foco actual es construir, desplegar y escalar estos sistemas — con
**TG Motors** como su primer cliente activo.

**TG Motors** es un taller automotriz multimarca en Quito, gestionado por **Diego** y un equipo pequeño.
El sistema construido para ellos se llama **"Monterito"** y funciona como el **producto insignia** que
demuestra las capacidades de DRIVEMEDIA: un asistente de WhatsApp con IA **más** un panel ERP de gestión
del taller (órdenes de trabajo, clientes, finanzas, agenda, prefacturas, etc.).

Monterito está diseñado como producto **multi-cliente por configuración**: el mismo código sirve a
cualquier taller, parametrizando nombre, ciudad, servicios, técnicos y credenciales mediante variables
de entorno. Esto es clave para la tesis de marketing: **es replicable y escalable a otros talleres**.

Emilio prefiere guía paso a paso con instrucciones completas y detalladas — no resúmenes de alto nivel
ni referencias a pasos previos. Marca y corrige configuraciones incompletas. El objetivo de **este**
proyecto de Claude es **elevar el marketing y las ventas** del producto a más talleres.

---

## Qué es el producto (descripción funcional completa)

Monterito tiene dos grandes mitades que trabajan juntas:

### A) Asistente de WhatsApp con IA (cara al cliente final del taller)
- Atiende a los clientes del taller por WhatsApp en español, con tono amigable y profesional.
- **Agenda citas**: muestra horarios disponibles reales y confirma la reserva.
- **Consulta el estado** del vehículo/orden de trabajo y lo explica en lenguaje sencillo.
- **Cancela y reagenda** citas.
- **Detecta emergencias** (wincha, grúa, accidente, varado en carretera) y **alerta de inmediato al
  dueño** del taller.
- Nunca inventa precios ni datos técnicos: si no sabe algo, dice que lo confirmará con el equipo.

### B) Panel ERP de gestión del taller (cara al dueño/administrador)
Panel web responsive (`/admin`) protegido por login. Módulos:
- **Órdenes de trabajo** digitales: cliente, vehículo, kilometraje, diagnóstico, trabajos (mano de obra)
  y repuestos. Los trabajos y repuestos se eligen desde un **desplegable del catálogo** con **precio
  sugerido autocompletado y editable** por orden (permite descuentos o recargos según el cliente).
- **Diagrama de daños al ingreso**: por tipo de carrocería (sedán, hatchback, SUV, camioneta, camión,
  clásico, 4x4, furgoneta) se marcan los golpes/daños con puntos sobre un blueprint del vehículo.
- **Documentos PDF**: genera **Orden de Trabajo** y **Prefactura** descargables y enviables. La
  **Prefactura incluye IVA 15% (Ecuador)**; la Orden de Trabajo no incluye IVA.
- **Gestión de clientes y vehículos**: alta, búsqueda, edición (cédula/RUC, dirección, contacto,
  vehículo) e historial de servicios.
- **Agenda/citas** con asignación de técnicos y bloqueo de disponibilidad.
- **Técnico y estado editables** directamente en la tabla de órdenes (Borrador → Enviada → Aprobada →
  En proceso → Completada).
- **Envío por WhatsApp** de órdenes y prefacturas; aviso automático de "vehículo listo".
- **Finanzas**: ingresos por período, mano de obra vs repuestos, top técnicos y marcas.
- **Categorías de servicio** con tendencias e ingresos por categoría.
- **Reincidencias**: detecta clientes que regresan dentro de 30 días (control de calidad).
- **Catálogo de precios** editable (servicios y materiales), importable desde Excel.
- **Autoguardado de borrador** de la orden en curso (recuperación si se interrumpe el trabajo).

---

## Cómo está construido (descripción técnica completa)

### Arquitectura — framework WAT (Workflows, Agents, Tools)
Separa la IA (razonamiento) del código determinista (ejecución): la IA orquesta, y scripts/herramientas
deterministas hacen el trabajo (API, BD, PDFs, WhatsApp). Esto da fiabilidad.

### Stack
- **Node.js ≥18** + **Express 4** (servidor y API REST).
- **PostgreSQL** (vía librería `pg`), alojado en **Railway**.
- **Claude API** vía `@anthropic-ai/sdk` (motor del asistente, tool-calling).
- **WhatsApp** vía **Twilio** (proveedor actual); soporta **Meta WhatsApp API** y WATI por configuración.
- **node-cron** (tareas programadas), **Helmet** + **express-rate-limit** (seguridad), **xlsx**
  (importación de catálogos), **axios** (HTTP), **dotenv** (configuración).
- **Frontend**: un único archivo `public/admin.html` (HTML + JS vanilla, responsive). Sin framework.

### Archivos clave por capa
- `src/server.js` — Express: Helmet, rate-limit, archivos estáticos, webhook de WhatsApp, API REST,
  **gate de `/admin`** por cookie de sesión (redirige a `/login` si no hay sesión), `/login`, `/health`.
  Arranca el scheduler.
- `src/routes/api.js` — API REST protegida por **token de sesión (8h)** en cabecera `X-Session-Token`
  más **cookie httpOnly**, con **anti-fuerza-bruta por IP** (5 intentos → bloqueo 15 min). Endpoints:
  login/logout, clientes (crear/buscar/listar/editar/historial), órdenes (crear/editar/enviar/eliminar,
  con flag `silent` para no enviar WhatsApp en edición rápida), citas, disponibilidad, catálogo
  (servicios/materiales), stats de finanzas, stats por categoría, reincidencias, técnicos. Todas las
  consultas usan parámetros (sin inyección SQL).
- `src/conversation.js` y `src/conversation-admin.js` — motor del bot con Claude (manejo de turnos y
  llamadas a herramientas).
- `src/handlers/message.js` — entrada del webhook (mensajes WhatsApp entrantes).
- `src/handlers/outbound.js` — envíos salientes: recordatorios, encuestas post-servicio, recordatorios
  de mantenimiento.
- `src/scheduler.js` — **4 cron jobs**: (1) recordatorios de cita 24h — cada hora; (2) encuestas
  post-servicio — 18:00; (3) recordatorios de mantenimiento — 09:00; (4) generación de disponibilidad de
  las próximas 2 semanas — domingos 08:00 (hora Ecuador, UTC-5).
- `prompts/monterito.js` — system prompt del asistente "Monterito": español, no inventa precios,
  **parametrizado por variables de entorno** (sirve a cualquier taller). Herramientas que expone al
  modelo: `check_availability`, `book_appointment`, `check_order_status`, `cancel_appointment`,
  `alert_owner` (emergencias).
- `tools/db/*` — capa de datos PostgreSQL: crear/obtener/buscar cliente, crear orden de trabajo, citas,
  disponibilidad, reincidencias, estado de orden, agenda de técnicos, **seed del catálogo desde Excel**
  (`seed-catalog.js`, UPSERT de precios), migraciones (`run-migration.js`), init de esquema.
- `tools/whatsapp/*` — `send-message`, `send-order`, `send-completion`, `send-template`, `alert-owner`
  (capa de envío; proveedor Twilio, con soporte Meta por env).
- `tools/airtable/*` — capa de datos alternativa/legado en Airtable (de una iteración previa antes de
  migrar a PostgreSQL).
- `scripts/new-client.js` — alta de nuevo cliente a partir de `config/client.template.json`.
- `scripts/generar-manual.py` — genera el manual del sistema (Python + Claude).

### Modelo de datos (PostgreSQL)
- `clientes` — nombre, teléfono (único), placa, marca, modelo, año, cédula/RUC, dirección, fecha último
  servicio, recordatorio de mantenimiento.
- `citas` — funciona como **órdenes de trabajo**: servicio, fecha/hora, estado, kilometraje, diagnóstico,
  trabajos, repuestos, técnico, tiempo estimado, estado de la orden, y campos JSONB
  `servicios_detalle` / `repuestos_detalle` / `prefactura_items`, además de `tipo_vehiculo`,
  `clave_codigo`, `mano_de_obra` y notas de prefactura. (El IVA 15% se aplica solo en la prefactura, a
  nivel de presentación.)
- `disponibilidad` — slots por fecha/hora/técnico.
- `conversaciones` — estado del bot por teléfono, con `historial` en JSONB.
- `reincidencias` — clientes que regresan ≤30 días (placa, técnico, trabajo original, motivo, misma
  falla, estado).
- `catalogo` — ítems `servicio` o `material` con precio y bandera de activo.

### Seguridad y cumplimiento
- Login con credenciales por variable de entorno; sesión con expiración (8h); anti-fuerza-bruta por IP.
- `/admin` cerrado tras la cookie de sesión; cabeceras de seguridad con Helmet; límite de tamaño de
  payload; consultas parametrizadas.
- Cumplimiento de **WhatsApp Business / Twilio** (documentación de opt-in, modelo de agencia) y de la
  **Ley Orgánica de Protección de Datos Personales (LOPDP) de Ecuador**.

### Multi-cliente por configuración
Todo lo específico del taller (nombre, ciudad, dirección, horario, servicios, técnicos, contacto del
dueño, credenciales de WhatsApp, etc.) vive en **variables de entorno**, de modo que el mismo código
atiende a cualquier taller sin cambios.

---

## Estado actual (Current state)

- **En producción** en Railway: `https://tg-motors-monterito-production.up.railway.app` (panel en
  `/admin`).
- **TG Motors operando**: clientes reales, órdenes de trabajo, prefacturas con IVA, técnicos con nombre
  y apellido, catálogo de precios real sembrado desde el Excel del taller (`Base Emilio.xlsx`).
- **Bot de WhatsApp funcional** vía Twilio. La cuenta Twilio está en **modo trial (límite ~50
  mensajes/día)** — para producción a escala se requiere **upgrade de la cuenta**.
- Despliegue mediante `railway up`. Base de datos PostgreSQL gestionada en Railway.

---

## En el horizonte (roadmap)

- Evolución a **SaaS premium multi-taller** (la base ya es multi-cliente por configuración): onboarding
  self-service, panel de gestión de cuentas, planes por suscripción.
- **Endurecimiento de seguridad** opcional: contraseña fuerte por defecto, CORS/HSTS, rate-limit ampliado
  en endpoints sensibles, rotación de credenciales/tokens.
- Upgrade de la cuenta de WhatsApp/Twilio para volumen de producción.
- Posibles módulos: panel de onboarding de clientes, reportes/exportes adicionales, integraciones con
  facturación electrónica del SRI (Ecuador).

---

## Aprendizajes y principios clave (Key learnings & principles)

- **La elección de proveedor/infra requirió iteración**: se pasó de **N8N + Wassenger** → **Twilio
  sandbox** → **Meta API directa** → **stack final: Node.js + Railway + Twilio + Claude API**. Lección:
  el stack propio (código + Railway) da más control y fiabilidad que las plataformas no-code.
- **Cumplimiento de WhatsApp Business en Ecuador** requiere documentar claramente el proceso de opt-in,
  el modelo de agencia y el cumplimiento de la LOPDP.
- **El valor percibido es estratégico**: dashboards de analítica, documentación profesional, PDFs y
  entregables estructurados se usan para justificar el pricing de agencia.
- **La validación de esquemas de herramientas en Airtable** (en la etapa N8N) fue un punto de fricción
  recurrente → otra razón para migrar a PostgreSQL + código propio.
- **El catálogo con desplegable y precios editables** fue clave para la adopción real del taller (rapidez
  al tipear órdenes, precios consistentes, flexibilidad para descuentos).
- **Separar la prefactura de la orden de trabajo** (dos documentos distintos, IVA solo en la prefactura)
  respondió a una necesidad operativa concreta del taller.

---

## Enfoque y patrones (Approach & patterns)

- **Emilio actúa como builder técnico y account manager a la vez**, produciendo entregables pulidos
  (contratos, manuales, reportes, formularios de onboarding) junto a los sistemas técnicos.
- **Proceso documentado de incorporación de clientes**: formulario de onboarding (22 preguntas en seis
  bloques), documento de bienvenida/alcance, contrato de servicio con política de privacidad LOPDP, y
  plantilla de propuesta de valor.
- **Operaciones de DRIVEMEDIA en un libro de Excel** con pestañas para dashboard, clientes, credenciales,
  finanzas, pipeline, suscripciones, soporte y disponibilidad.
- **Python + Claude** para tareas de extracción y migración de datos (p. ej. importar el catálogo y el
  histórico de clientes desde Excel a PostgreSQL).
- **Entregables que comunican valor**: cada función del producto se traduce en un beneficio de
  negocio (ahorro de tiempo, imagen profesional, control financiero, retención de clientes).

---

## Herramientas y recursos (Tools & resources)

Herramientas usadas en el proyecto (etiquetadas):

- `#Node.js` — runtime del servidor y de todos los scripts/herramientas.
- `#Express` — servidor HTTP, API REST y enrutado del panel/webhook.
- `#PostgreSQL` — base de datos principal (clientes, órdenes, citas, catálogo, reincidencias, bot).
- `#pg` — cliente PostgreSQL para Node (consultas parametrizadas).
- `#Railway` — hosting de la app y de PostgreSQL; despliegue con `railway up`; variables de entorno.
- `#ClaudeAPI` / `#Anthropic-SDK` (`@anthropic-ai/sdk`) — motor del asistente Monterito (tool-calling) y
  scripts de extracción/generación (manual).
- `#Twilio` — proveedor actual de WhatsApp Business (envío/recepción de mensajes). Cuenta en trial.
- `#MetaWhatsAppAPI` — proveedor alternativo de WhatsApp (soportado por configuración).
- `#Airtable` — capa de datos alternativa/legado de una iteración previa (migrada a PostgreSQL).
- `#node-cron` — tareas programadas (recordatorios, encuestas, mantenimiento, disponibilidad).
- `#Helmet` — cabeceras de seguridad HTTP.
- `#express-rate-limit` — límite de peticiones / anti-abuso.
- `#xlsx` — importación de catálogos y datos desde Excel (`Base Emilio.xlsx`).
- `#axios` — llamadas HTTP salientes (APIs externas).
- `#dotenv` — carga de variables de entorno/configuración por cliente.
- `#Python` — scripts auxiliares (p. ej. `scripts/generar-manual.py`) y extracción/migración con Claude.
- `#Git` / `#GitHub` — control de versiones del proyecto.
- `#Excel` — operación interna de DRIVEMEDIA (dashboard, clientes, credenciales, finanzas, pipeline,
  suscripciones, soporte, disponibilidad).
- `#HTML/JS-vanilla` — panel `public/admin.html` (sin framework, responsive).

> **Nota de seguridad:** este documento describe la arquitectura pero **no contiene secretos**. Las
> credenciales (claves de API, contraseñas, tokens) viven solo en variables de entorno en Railway y en
> el `.env` local, nunca en el código ni en documentos.

---

## Cómo usar este contexto para marketing

Con este documento como base, en el Proyecto de Claude puedes pedir, por ejemplo: estrategia de ventas a
talleres, definición del cliente ideal (ICP), propuesta de valor por segmento, modelo de precios
(setup + mensualidad), guiones de demo y outreach, plan de contenido, y materiales (one-pager, secuencia
de WhatsApp, casos de éxito de TG Motors). Para el pedido estructurado y accionable, usa el prompt de
`master-prompt-marketing-erp.md` junto con este contexto.
