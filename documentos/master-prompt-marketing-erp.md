# Master Prompt — Estrategia de Marketing y Ventas para vender el ERP a talleres

> **Cómo usar este documento:** copia TODO el bloque que está dentro de "PROMPT PARA PEGAR EN
> CLAUDE" y pégalo en una conversación nueva con Claude. Rellena lo que esté entre `[corchetes]`
> con tus datos reales. Claude te devolverá un plan de marketing y ventas completo, accionable y
> por fases. Si algo te queda corto, pídele que profundice en esa sección.

---

## Contexto del producto (resumen para ti)

El producto es un **ERP web para talleres automotrices** ya funcionando en producción (taller TG
Motors, Quito, Ecuador). Sus módulos actuales:

- **Órdenes de trabajo** digitales: cliente, vehículo, diagnóstico, trabajos, repuestos, técnico,
  tiempo estimado, estado (Borrador → Enviada → Aprobada → En proceso → Completada).
- **Diagrama de daños** del vehículo por tipo de carrocería (sedán, hatchback, SUV, camioneta, etc.):
  se marcan los golpes/daños al ingreso con puntos sobre un blueprint.
- **Catálogo de precios** de mano de obra y repuestos (importable desde Excel), con precio sugerido
  autocompletado y editable por orden (permite descuentos o recargos).
- **Prefactura y Orden de Trabajo en PDF** descargables y enviables.
- **Integración con WhatsApp**: envío de órdenes, prefacturas y aviso automático de "vehículo listo".
- **Gestión de clientes** y vehículos con búsqueda e historial.
- **Agenda/citas** y asignación de técnicos con bloqueo de disponibilidad.
- **Finanzas**: ingresos por período, mano de obra vs repuestos, top técnicos y marcas.
- **Reincidencias**: detecta clientes que regresan dentro de 30 días (control de calidad).
- **Bot de WhatsApp** para atención al cliente (agendar, consultar estado).

Stack: Node.js + Express + PostgreSQL, desplegado en Railway. Panel web responsive.

---

## PROMPT PARA PEGAR EN CLAUDE

```
Eres un estratega de marketing y ventas B2B SaaS de clase mundial, especializado en software
vertical para PYMES de servicios (vertical SaaS) en Latinoamérica. Tu trabajo es diseñarme una
estrategia COMPLETA, accionable y por fases para vender mi ERP a talleres automotrices, partiendo
de cero y con presupuesto limitado, priorizando canales de bajo costo y alta conversión.

# CONTEXTO DEL PRODUCTO
Tengo un ERP web para talleres automotrices, ya funcionando en un taller real en
[ciudad/país: ej. Quito, Ecuador]. Módulos:
- Órdenes de trabajo digitales con estados y asignación de técnicos.
- Diagrama de daños del vehículo al ingreso (por tipo de carrocería).
- Catálogo de precios (mano de obra y repuestos) con precio editable por orden.
- Prefactura y orden de trabajo en PDF, enviables por WhatsApp.
- Integración con WhatsApp (envío de órdenes, prefacturas, aviso de "vehículo listo").
- Gestión de clientes/vehículos con historial.
- Agenda de citas y disponibilidad de técnicos.
- Reportes financieros (ingresos, mano de obra vs repuestos, top técnicos/marcas).
- Detección de reincidencias (control de calidad).
- Bot de WhatsApp para atención al cliente.
Stack: web responsive, en la nube. Funciona en celular y computador, sin instalar nada.

# MI SITUACIÓN
- Soy [perfil: ej. desarrollador/consultor independiente / pequeña agencia].
- Tengo [N] cliente(s) usándolo hoy (caso de éxito: [describe brevemente el resultado, ej.
  "digitalizó 500+ órdenes, redujo tiempo de facturación de 20 a 3 min"]).
- Presupuesto de marketing inicial: [ej. bajo / USD X al mes].
- Mercado objetivo inicial: [país/ciudad/región].
- Idioma del mercado: español.
- Mi objetivo a 12 meses: [ej. llegar a 30 talleres pagando].

# LO QUE NECESITO QUE PRODUZCAS (en este orden, con encabezados claros)

1. PERFIL DE CLIENTE IDEAL (ICP) y segmentación
   - Define 2-3 segmentos de talleres (por tamaño, tipo, # técnicos, nivel de digitalización).
   - Para cada uno: dolores concretos, motivación de compra, quién decide, quién usa, presupuesto
     típico, objeciones esperadas.

2. PROPUESTA DE VALOR y posicionamiento
   - Una frase de posicionamiento por segmento.
   - 5-7 beneficios traducidos a dinero/tiempo/tranquilidad (no features técnicas).
   - Diferenciadores vs. (a) hacerlo en papel/Excel/WhatsApp manual y (b) ERPs genéricos.

3. MODELO DE PRECIOS Y EMPAQUETADO
   - Propón 3 planes (ej. Básico / Pro / Multi-sucursal) con qué incluye cada uno y rango de precio
     mensual sugerido para [país], más cargo de implementación/onboarding.
   - Estrategia de prueba gratuita / piloto y cómo convertir piloto en pago.
   - Tácticas de pricing para reducir fricción (anual con descuento, garantía, etc.).

4. MENSAJES Y CONTENIDO
   - 3 ganchos/hooks de apertura para frío (WhatsApp, llamada, visita).
   - 1 guion de demo de 15 minutos (qué mostrar y en qué orden para generar el "ajá").
   - Calendario de contenido de 8 semanas (Instagram/TikTok/YouTube Shorts + LinkedIn) con ideas
     concretas de publicaciones que un taller compartiría.
   - 3 estudios de caso/plantillas de testimonio para capturar resultados.

5. CANALES DE ADQUISICIÓN priorizados (bajo costo primero)
   - Outbound directo (visita física a talleres, WhatsApp, llamada): cómo armar la lista, cómo
     abordar, cadencia de seguimiento.
   - Alianzas (distribuidoras de repuestos, gremios de talleres, marcas de lubricantes, institutos
     técnicos): cómo proponer un acuerdo gana-gana.
   - Referidos: programa de referidos para talleres y para técnicos.
   - Orgánico/contenido y, si aplica, publicidad paga (con presupuesto mínimo y métricas de corte).
   Para cada canal: esfuerzo, costo, tiempo a primer resultado y prioridad (1-3).

6. PROCESO DE VENTAS (pipeline) y materiales
   - Etapas del pipeline con criterios de avance y tasas de conversión esperadas.
   - Secuencia de outreach de 14 días (mensajes exactos de WhatsApp/email/llamada, listos para usar).
   - Manejo de las 7 objeciones más comunes ("es caro", "mis técnicos no saben usar tecnología",
     "ya uso WhatsApp y Excel", "no tengo tiempo de aprender", "¿y si se cae el internet?",
     "¿mis datos están seguros?", "déjame pensarlo") con respuestas persuasivas.

7. ONBOARDING Y RETENCIÓN (para que no se vayan)
   - Checklist de implementación de los primeros 7 días.
   - Cómo migrar sus datos (clientes, precios) sin fricción.
   - Métricas de salud del cliente y señales de churn temprano.

8. PLAN DE 90 DÍAS y KPIs
   - Semana a semana / mes a mes: qué hacer primero, metas realistas de talleres firmados.
   - KPIs clave (leads, demos, cierres, CAC, MRR, churn) con números objetivo para [mi meta].

# FORMATO DE RESPUESTA
- Español neutro, tono profesional pero directo.
- Usa tablas donde aporten claridad (pricing, canales, pipeline).
- Da ejemplos concretos y textos listos para copiar y pegar, no consejos genéricos.
- Al final, dame una lista de "primeras 10 acciones para esta semana".
- Si necesitas un dato mío para afinar algo, asúmelo con un supuesto razonable y márcalo como
  [SUPUESTO] para que yo lo corrija.
```

---

## Notas para sacarle más provecho

- **Itera por secciones.** Después de la primera respuesta, pídele a Claude: *"Profundiza la sección
  5 (canales) y dame la lista exacta de mensajes de WhatsApp para outbound a talleres."*
- **Aliméntalo con datos reales** del taller actual (números antes/después) para que los testimonios
  y el caso de éxito sean creíbles.
- **Pídele variantes de pricing** por país si vas a vender en más de un mercado.
- **Genera los materiales**: tras el plan, pídele el one-pager de ventas, el guion de demo y la
  secuencia de 14 días como documentos separados.
