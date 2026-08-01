# Estructura del Proyecto — TG Motors (Monterito)

Guía rápida y minimalista de qué hay en cada carpeta. Para el detalle técnico completo, ver
`documentos/contexto-proyecto-claude.md`. Para el estado y la hoja de ruta, ver
`documentos/PROYECTO-estado-y-expansion.md`.

---

## Carpetas de código

| Carpeta | Qué es | Para qué sirve |
|---------|--------|----------------|
| `src/` | Servidor Node.js / Express | API REST, bot de WhatsApp, manejadores de mensajes, scheduler de recordatorios |
| `public/` | Web estática | Panel de administración (`admin.html`), blueprints de vehículos (`blueprint_autos/`), logos (`img/`) |
| `tools/` | Ejecución (WAT capa 3) | `db/` operaciones de PostgreSQL · `whatsapp/` envío de mensajes |
| `prompts/` | Prompt del bot | System prompt de "Monterito" (Claude) |
| `workflows/` | SOPs del negocio (WAT capa 1) | Procesos en lenguaje natural (recordatorios, booking, encuestas, proveedor WhatsApp) |
| `config/` | Plantillas de configuración | `client.template.json` para dar de alta nuevos talleres |
| `scripts/` | Utilidades | Alta de cliente, generación del manual PDF |

---

## Carpetas de datos y documentos

| Carpeta | Qué contiene |
|---------|--------------|
| `datos-cliente/` | `Base Emilio.xlsx` — catálogo real de servicios, precios y técnicos del taller (fuente del seed) |
| `assets/` | Logos corporativos originales en SVG (emblema y horizontal) |
| `documentos/` | `Manual-TG-Motors.pdf`, prefacturas (`prefacturas/2025/`, `prefacturas/2026/`) y los docs de proyecto (`contexto-proyecto-claude.md`, `master-prompt-marketing-erp.md`, `PROYECTO-estado-y-expansion.md`) |

---

## Archivos raíz importantes

| Archivo | Para qué sirve |
|---------|----------------|
| `CLAUDE.md` | Instrucciones del agente IA (framework WAT) |
| `.env` | Variables de entorno: credenciales, API keys, datos del taller. **Nunca subir a git** |
| `package.json` | Dependencias y scripts de Node.js |
| `railway.toml` | Configuración de deploy en Railway |
| `ESTRUCTURA.md` | Este archivo — guía de navegación del proyecto |

---

## Flujo de datos

```
Cliente WhatsApp → src/handlers/ → src/conversation.js (Claude) → tools/db/ → PostgreSQL
Admin web (public/admin.html) → src/routes/api.js → tools/db/ → PostgreSQL
Excel del taller → tools/db/seed-catalog.js → tabla catalogo (PostgreSQL)
```

---

## Comandos útiles

```bash
# Arrancar en local (requiere .env con DATABASE_URL)
npm start

# Importar/actualizar el catálogo de precios del taller (UPSERT desde el Excel)
node tools/db/seed-catalog.js "datos-cliente/Base Emilio.xlsx"

# Generar el manual PDF de usuario
python3 scripts/generar-manual.py

# Desplegar a producción (desde la carpeta del proyecto)
railway up
```
