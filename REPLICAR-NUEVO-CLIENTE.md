# Replicar el software de taller para un cliente nuevo

Guía paso a paso para poner en marcha una instancia del ERP de taller (el core, **sin WhatsApp**)
para un cliente nuevo, desde cero. WhatsApp es un **add-on** que se conecta después
(ver la última sección).

> **Modelo mental (leer primero).** El sistema es **mono-taller**: un despliegue = un taller.
> No es multi-tenant. "Replicar" significa **crear una instancia nueva** (código + base de datos
> nueva + variables de entorno nuevas), **no** agregar un cliente a la instancia de TG Motors.
> Cada cliente vive aislado: su propia base, su propio dominio, su propio panel.

---

## 0. Qué es "el core" vs. el add-on de WhatsApp

| Capa | Qué incluye | ¿Necesaria para vender el software? |
|------|-------------|--------------------------------------|
| **Core (esta guía)** | Panel `/admin`, clientes y vehículos, órdenes de trabajo, prefacturas PDF, catálogo de precios, calendario/disponibilidad, técnicos, login | **Sí.** Funciona solo con base de datos + Anthropic + config del taller. |
| **Add-on WhatsApp** | Bot que agenda citas, cotizaciones que se reenvían al dueño, recordatorios, encuestas post-servicio | No. Se conecta cuando el cliente contrata el canal. |

El core arranca sin ninguna variable de WhatsApp. El panel es 100% usable así.

---

## 1. Requisitos por cliente (cuentas y datos)

Antes de empezar, ten a mano:

1. **Cuenta Railway** (hosting + PostgreSQL). Puede ser tu cuenta con un proyecto por cliente.
2. **API key de Anthropic** (`ANTHROPIC_API_KEY`). Puedes reutilizar una key tuya o crear una por cliente para separar costos.
3. **Datos del taller del cliente**: nombre, ciudad, dirección, horarios, lista de servicios, nombres de técnicos, capacidad diaria, teléfono y nombre del dueño.
4. **Excel de precios del cliente** (catálogo). Formato exacto en la sección 4.
5. **Logo del cliente** (SVG idealmente) para el panel y las prefacturas.

**Costo aproximado por cliente/mes:** hosting Railway (plan según uso) + consumo de tokens de Anthropic (bajo si no hay WhatsApp, porque el bot es la parte que más llama a Claude).

---

## 2. Copiar el código (una vez por cliente)

Cada cliente necesita su propia copia del repo para poder personalizar branding y desplegar por separado.

```bash
# Copia la carpeta del proyecto a una nueva (OJO: el nombre puede llevar espacios; usa comillas)
cp -R "Workflow TG Motors " "Taller <NOMBRE-CLIENTE>"
cd "Taller <NOMBRE-CLIENTE>"

# Borra el estado que es específico de TG Motors:
rm -f .env                      # se genera uno nuevo (paso 5)
rm -rf node_modules && npm install
```

> Alternativa recomendada a mediano plazo: convertir esto en un repo git plantilla
> ("template repo") y hacer `git clone` por cliente. Por ahora `cp -R` funciona.

**No copies como buenas** estas cosas de TG Motors (las tocamos en pasos siguientes):
- `.env` (credenciales de TG) → se regenera.
- `datos-cliente/Base Emilio.xlsx` (catálogo de TG) → se reemplaza por el del cliente.
- Branding "TG Motors"/"Monterito" en `public/admin.html` → find & replace (paso 6).

---

## 3. Crear la base de datos (Railway PostgreSQL)

1. En Railway: **New Project → Provision PostgreSQL**.
2. Copia la **connection string** (formato `postgresql://user:pass@host:port/db`).
3. Guárdala; será tu `DATABASE_URL` (paso 5).

> Cada cliente = una base separada. Nunca reutilices la base de TG Motors.

---

## 4. Preparar el catálogo de precios del cliente (Excel)

El catálogo (mano de obra + repuestos con precio) se importa desde un Excel. El importador
([tools/db/seed-catalog.js](tools/db/seed-catalog.js)) espera **dos hojas con estos nombres exactos**:

**Hoja `PRECIOS MDO`** (mano de obra):

| Columna | Contenido |
|---------|-----------|
| **B** | Nombre del servicio |
| **C** | Precio para vehículo estándar (4 cilindros) |
| **D** | Precio para 4x4/SUV (opcional; si difiere de C, crea una entrada extra `"SERVICIO (4x4/SUV)"`) |

**Hoja `PRECIOS REPUESTOS`** (materiales):

| Columna | Contenido |
|---------|-----------|
| **A** | Nombre del repuesto |
| **F** | Precio |

Guárdalo como `datos-cliente/<Cliente>.xlsx`. El Excel es la **fuente de verdad**: el importador
hace UPSERT, así que puedes re-correrlo cuando el cliente actualice precios.

> Si el taller no tiene lista de precios formal, arranca con un catálogo mínimo (5–10 servicios
> comunes) y lo completas después. El core funciona con catálogo vacío; solo no podrás autocompletar
> precios en las órdenes hasta cargarlo.

---

## 5. Configurar las variables de entorno (solo core)

Genera el `.env`. Puedes usar el asistente ([scripts/new-client.js](scripts/new-client.js)) o
escribirlo a mano. **Para el core, solo necesitas este bloque** (los campos de WhatsApp se dejan
vacíos):

```bash
# ── Base de datos ──
DATABASE_URL=postgresql://...        # del paso 3

# ── Claude ──
ANTHROPIC_API_KEY=sk-ant-...

# ── Datos del taller ──
SHOP_NAME=Taller del Cliente
SHOP_CITY=Quito
SHOP_ADDRESS=Av. Ejemplo 123
SHOP_HOURS=Lunes a Viernes 8:00-18:00, Sábados 8:00-13:00
SHOP_SERVICES=Cambio de aceite, Frenos, Alineación, Diagnóstico, Mantenimiento general
SHOP_TECHNICIANS=Nombre1, Nombre2       # separados por coma
SHOP_CAPACITY=4                          # citas simultáneas por franja
OWNER_NAME=Dueño del taller
OWNER_PHONE=5939XXXXXXXX                 # solo dígitos, con código de país
GOOGLE_REVIEW_URL=                       # opcional

# ── Credenciales del panel /admin ──
DASHBOARD_EMAIL=admin@cliente.com
DASHBOARD_PASSWORD=<contraseña-fuerte>

# ── Servidor ──
NODE_ENV=production
PORT=3000
```

> `DASHBOARD_EMAIL` / `DASHBOARD_PASSWORD` son el login real del panel (lo valida
> [src/routes/api.js](src/routes/api.js#L43)). **No** uses `admin@tgmotors.com / 123456`:
> eso solo aparece impreso en un script viejo y no es seguro.

---

## 6. Personalizar el branding del panel

El panel `public/admin.html` tiene el nombre y logo de TG Motors escritos a mano (~52 referencias).
Reemplázalos:

```bash
# Nombre del taller en el panel
#   Revisa antes con:  grep -n "TG Motors\|Monterito\|tgmotors" public/admin.html
#   Luego reemplaza (haz respaldo o revisa el diff después):
sed -i '' 's/TG Motors/Taller del Cliente/g; s/Monterito/Asistente/g' public/admin.html
```

- **Logo:** reemplaza los archivos en `public/img/` y `assets/` por los del cliente, manteniendo
  los mismos nombres de archivo (o ajusta las rutas en `admin.html`).
- **Blueprints de prefactura (SVG):** si el logo va embebido en las prefacturas/órdenes, respeta el
  `viewBox` del emblema (`638 236`) al cambiar el SVG, o el logo saldrá deformado. *(Gotcha
  conocido — ver [MEMORY / deploy gotchas].)*

> Revisa el resultado con `git diff public/admin.html` antes de desplegar.

---

## 7. Inicializar el esquema de la base de datos

Con el `.env` ya apuntando a la base **nueva**, corre en orden:

```bash
# 1) Tablas base (clientes, vehículos, citas, disponibilidad, conversaciones, etc.)
node tools/db/init.js

# 2) Tabla `catalogo` (no la crea el arranque; solo existe en esta migración)
#    Y el índice ÚNICO que el seed necesita para el UPSERT.
#    Opción A — con psql:
psql "$DATABASE_URL" -f tools/db/migrations/add_catalogo_servicios.sql
psql "$DATABASE_URL" -c 'CREATE UNIQUE INDEX IF NOT EXISTS idx_catalogo_nombre ON catalogo(nombre);'
#    Opción B — sin psql: pega esos dos SQL en la consola "Query" de la base en Railway.

# 3) Importar el catálogo del cliente
node tools/db/seed-catalog.js "datos-cliente/<Cliente>.xlsx"
```

> **Por qué el paso 2 es obligatorio:** `seed-catalog.js` hace `INSERT ... ON CONFLICT (nombre)`.
> Sin un índice único en `catalogo(nombre)`, PostgreSQL responde *"no unique or exclusion constraint
> matching"* y el seed falla. Ninguna migración crea ese índice: hay que agregarlo a mano en cada
> base nueva.

El resto del esquema (columnas de órdenes/prefactura, tablas de control, `_migraciones`, etc.) lo
crea el servidor solo al arrancar, de forma idempotente ([src/server.js](src/server.js#L20) →
`ensureSchema()`). No tienes que correr nada más.

> ⚠️ **NO corras `node tools/db/setup-production.js`.** Ese script tiene **hardcodeada la base de
> TG Motors** e inserta clientes de prueba de TG. Es un artefacto de TG, no un instalador genérico.

---

## 8. Desplegar en Railway

```bash
# Desde la carpeta del cliente (recuerda las comillas si el nombre lleva espacios)
railway up --detach
```

Luego, en el dashboard de Railway del servicio:

1. **Variables** → carga todas las del `.env` (Railway no lee tu `.env` local; hay que ponerlas ahí).
   - `DATABASE_URL` la inyecta Railway si la base está en el mismo proyecto; si no, pégala.
2. Genera/activa el **dominio público** del servicio (Settings → Networking → Generate Domain).

> **Gotcha de deploy:** usa `railway up` (no `redeploy --from-source`). Y si el nombre de la carpeta
> termina en espacio, siempre entre comillas. *(Ver [MEMORY / deploy gotchas].)*

---

## 9. Verificar (smoke test)

```bash
# Salud del servicio (debe responder status: ok)
curl -s https://<dominio-del-cliente>.up.railway.app/health

railway logs   # buscar "[server] ... corriendo" y "[db] ensureSchema OK"
```

En el navegador:

1. Abre `https://<dominio>/admin` → debe redirigir a `/login`.
2. Entra con `DASHBOARD_EMAIL` / `DASHBOARD_PASSWORD`.
3. Crea un cliente de prueba, una orden de trabajo, genera una prefactura PDF.
4. Confirma que el catálogo carga precios al armar la orden.

Si todo eso funciona, **el core está en producción para ese cliente.** Ya puedes venderlo y hacer
demos sin tocar WhatsApp.

---

## 10. Add-on: conectar WhatsApp (después, cuando el cliente lo contrate)

El bot es una capa adicional. Para activarla, agrega al `.env` (y a Railway) el bloque del proveedor
y registra el webhook. Proveedor recomendado hoy: **360dialog** (es el que corre en producción en TG).

```bash
WHATSAPP_PROVIDER=360dialog
D360_API_KEY=...
D360_WEBHOOK_SECRET=<secreto-que-tú-eliges>
D360_API_BASE_URL=https://waba-v2.360dialog.io
REMINDER_TEMPLATE_NAME=            # plantilla aprobada, para recordatorios fuera de 24h (opcional)
```

Pasos del add-on:
1. Da de alta el número de WhatsApp Business del cliente con el proveedor (360dialog).
2. Registra el webhook del proveedor apuntando a
   `https://<dominio>/webhook/360dialog?secret=<D360_WEBHOOK_SECRET>`.
3. El dueño opera desde su propio WhatsApp: **cita** (responder deslizando) la notificación 📋 para
   reenviar cotizaciones; `#humano <telefono>` para tomar un chat, `#bot <telefono>` para devolverlo.
4. Detalles y operación diaria: ver [RUNBOOK.md](RUNBOOK.md) y [workflows/whatsapp-provider.md](workflows/whatsapp-provider.md).

> Limitaciones del canal que conviene explicar al cliente antes de vender el add-on: los envíos de
> texto fuera de la ventana de 24h requieren plantilla aprobada, y adjuntar el PDF en WhatsApp es un
> paso manual del asesor. Detalle completo en [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

---

## Checklist rápido (imprimible) — nuevo cliente

- [ ] Copiar repo a `Taller <Cliente>` + `npm install`
- [ ] Crear PostgreSQL en Railway → obtener `DATABASE_URL`
- [ ] Preparar Excel de precios (`PRECIOS MDO` + `PRECIOS REPUESTOS`)
- [ ] Escribir `.env` (core: DB, Anthropic, SHOP_*, OWNER_*, DASHBOARD_*)
- [ ] Branding: reemplazar "TG Motors" en `admin.html`, cambiar logos
- [ ] `node tools/db/init.js`
- [ ] Crear tabla `catalogo` + **índice único** en `catalogo(nombre)`
- [ ] `node tools/db/seed-catalog.js "datos-cliente/<Cliente>.xlsx"`
- [ ] `railway up --detach` + cargar variables en Railway + generar dominio
- [ ] Smoke test: `/health`, login en `/admin`, crear orden + prefactura
- [ ] (Opcional) Activar add-on de WhatsApp

---

## Gotchas resumidos

| # | Gotcha | Qué hacer |
|---|--------|-----------|
| 1 | `setup-production.js` apunta a la base de TG Motors | **No correrlo** en clientes nuevos |
| 2 | Tabla `catalogo` sin índice único → el seed falla | Crear `idx_catalogo_nombre` antes del seed (paso 7.2) |
| 3 | Branding "TG Motors" hardcodeado en `admin.html` | Find & replace + cambiar logos (paso 6) |
| 4 | Deploy: usar `railway up`, no `redeploy --from-source` | Ver RUNBOOK |
| 5 | Carpeta con espacio al final del nombre | Siempre entre comillas |
| 6 | `viewBox` del logo SVG = `638 236` | Respetarlo al cambiar el logo de prefactura |
| 7 | Es mono-taller | Una instancia por cliente, nunca compartir base |
```
