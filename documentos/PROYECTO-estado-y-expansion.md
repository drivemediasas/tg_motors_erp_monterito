# PROYECTO TG Motors / Monterito — Estado actual y plan de expansión

> Documento vivo. Es el **mapa operativo interno** para que Emilio y Claude trabajen alineados al
> expandir TG Motors hacia un software/SaaS vendible a más talleres. Ábrelo al inicio de cada sesión de
> trabajo y actualízalo cuando algo cambie.

---

## 1. Propósito y cómo usar este documento

- **Para qué sirve:** saber en todo momento en qué fase estamos, qué está hecho, qué falta y hacia
  dónde vamos, sin re-explicar el proyecto cada vez.
- **Cómo usarlo:** al empezar una sesión, pégalo o ábrelo y dile a Claude qué fase/tarea quieres
  avanzar. Al terminar, actualiza las secciones 2, 7 y 8.
- **Relación con los otros documentos:**
  - `documentos/contexto-proyecto-claude.md` → contexto técnico/negocio completo (para marketing).
  - `documentos/master-prompt-marketing-erp.md` → prompt para generar estrategia de marketing/ventas.
  - **Este** → estado interno + hoja de ruta de producto.

---

## 2. Fase actual

**Estado:** en **producción** en Railway (`https://tg-motors-monterito-production.up.railway.app`),
TG Motors operando con clientes, órdenes, prefacturas y bot de WhatsApp reales.

**Entregado (rondas recientes):**
- Editar cliente desde la tarjeta; tarjeta con bloques separados **Cliente** vs **Vehículo**.
- Trabajos y repuestos por **desplegable del catálogo** con **precio editable**.
- Fix **Prefactura vs Orden de Trabajo** (cada PDF imprime su contenido).
- Tipo de vehículo **Hatchback** + diagrama de daños.
- **Técnico y Estado editables** en la tabla de Órdenes (sin enviar WhatsApp desde la tabla).
- **Técnicos con nombre y apellido** (desde el Excel).
- **Gate de `/admin`** (cookie de sesión + login).
- **Catálogo sembrado desde `Base Emilio.xlsx`** (UPSERT, Excel = fuente de verdad).
- **IVA 15% solo en la prefactura** (la orden no lo lleva).
- Plantillas **sin prellenado** (todo manual desde el desplegable).
- Fix de **restaurar borrador** (guarda al cambiar de pestaña/cerrar; sin banners duplicados).
- **Mano de obra desglosada por ítem en la prefactura** (editable: subir uno, dejar otro en $0).
- **Limpieza del repo:** retirado Airtable, duplicados y junk; prefacturas consolidadas en
  `documentos/prefacturas/2025|2026`.

---

## 3. Stack y arquitectura (resumen)

- **Stack:** Node.js + Express + PostgreSQL + Claude API + Twilio (WhatsApp), desplegado en Railway.
- **Arquitectura WAT** (Workflows, Agents, Tools): IA orquesta; código determinista ejecuta.
- **Frontend:** un solo `public/admin.html` (HTML + JS vanilla).
- **Multi-cliente por configuración:** todo lo del taller vive en variables de entorno.
- Detalle completo en `documentos/contexto-proyecto-claude.md`.

---

## 4. Estado por módulo y pendientes técnicos

| Módulo | Estado | Pendiente |
|--------|--------|-----------|
| Órdenes de trabajo / catálogo / prefactura | ✅ Operativo | — |
| Bot WhatsApp (Twilio) | ✅ Funcional | **Twilio en trial (≈50 msg/día)** → upgrade para escala |
| Panel `/admin` | ✅ Con login/cookie | Seguridad extra opcional: contraseña fuerte, CORS/HSTS, rate-limit ampliado |
| Finanzas / categorías / reincidencias | ✅ Operativo | — |
| Multi-cliente | ✅ Soportado por env vars | Falta onboarding repetible (Fase 2) |

**Seguridad — acción urgente:** el archivo `extractor-tgmotors/config.py` contenía una **API key de
Anthropic en texto plano**. Rotar esa clave en la consola de Anthropic y no dejar secretos en archivos
(solo en `.env`/variables de Railway).

---

## 5. Plan de expansión por fases

### Fase 1 — Estabilizar TG Motors (ahora)
- Objetivo: que el taller use el sistema a diario sin fricción ni errores.
- Incluye: pulido funcional (hecho), confiabilidad, **upgrade de Twilio** para no toparse con el límite.
- Listo cuando: una semana de operación real sin incidencias y WhatsApp sin límite de trial.

### Fase 2 — Productizar (multi-taller por configuración)
- Objetivo: poder dar de alta un nuevo taller en horas, no días.
- Incluye: onboarding repetible usando `config/client.template.json` + `scripts/new-client.js`;
  checklist de implementación; aislamiento de datos por cliente; manual de usuario por taller.
- Listo cuando: un segundo taller (piloto) queda operativo siguiendo el proceso documentado.

### Fase 3 — SaaS premium
- Objetivo: cobrar por suscripción de forma escalable.
- Incluye: planes (Básico/Pro/Multi-sucursal), panel de gestión de cuentas, cobros recurrentes,
  seguridad reforzada, y (opcional) facturación electrónica SRI Ecuador.
- Listo cuando: ≥3 talleres pagando mensualidad con alta/baja autoservicio.

### Fase 4 — Escala y marketing
- Objetivo: adquisición sistemática.
- Incluye: usar `master-prompt-marketing-erp.md` + `contexto-proyecto-claude.md` para estrategia;
  referidos, alianzas (distribuidoras/repuestos), contenido y casos de éxito de TG Motors.
- Listo cuando: pipeline con flujo constante de talleres interesados y un canal que convierte.

---

## 6. Cómo trabajamos juntos (Emilio + Claude)

- **Roles:** Emilio = builder + account manager (decide producto y cliente). Claude = copiloto técnico
  y de operaciones (implementa, documenta, despliega, audita).
- **Estilo de trabajo:** instrucciones completas y paso a paso; marcar configuraciones incompletas;
  preguntar cuando una decisión es del negocio.
- **Convenciones de despliegue y datos (de la memoria del proyecto):**
  - La carpeta del proyecto tiene un **espacio final** en el nombre (`Workflow TG Motors /`); usar
    siempre esa ruta.
  - Desplegar con **`railway up`** desde la carpeta (no `redeploy --from-source`).
  - Para scripts/seed contra la BD de producción, usar la **URL pública del Postgres**
    (`DATABASE_PUBLIC_URL` del servicio Postgres), no la interna.
  - Variables de prod en Railway (`railway variables`); el `.env` local no las trae.
  - Blueprints de vehículos usan `viewBox="0 0 638.25 236.249991"`; no sobrescribir los SVG reales.
  - Tono del bot/contenido al cliente: profesional, **sin jerga ni modismos**.

---

## 7. Backlog / próximos pasos inmediatos

- [ ] **Rotar la API key de Anthropic** expuesta y eliminar/limpiar `extractor-tgmotors/`.
- [ ] **Upgrade de Twilio** (salir del trial) para volumen real de WhatsApp.
- [ ] Redeploy limpio para reflejar `package.json` sin `airtable`.
- [ ] (Fase 2) Documentar el proceso de alta de un taller nuevo (onboarding).
- [ ] (Opcional) Endurecer seguridad: contraseña fuerte, CORS/HSTS, rate-limit en endpoints sensibles.

---

## 8. Bitácora de decisiones y aprendizajes

- **Stack final:** Node + Railway + Twilio + Claude (tras iterar N8N+Wassenger → Twilio sandbox → Meta
  API). El código propio da más control que las plataformas no-code.
- **IVA 15% solo en la prefactura**; la orden de trabajo no lo incluye.
- **Prefactura = documento independiente** de la orden, con **mano de obra desglosada por ítem** y
  override propio (`prefactura_servicios`/`prefactura_items`) que no altera la orden.
- **Catálogo = `Base Emilio.xlsx` como fuente de verdad** (seed con UPSERT).
- **Airtable retirado** del proyecto (todo en PostgreSQL).
- **Plantillas sin prellenado**: el dueño arma trabajos/repuestos desde el desplegable.
