require('dotenv').config();
const express    = require('express');
const path       = require('path');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { handleInbound } = require('./handlers/message');
const { handleRespondioInbound } = require('./handlers/respondio');
const { handleD360Inbound } = require('./handlers/360dialog');
const scheduler  = require('./scheduler');
const apiRouter  = require('./routes/api');
const pool       = require('../tools/db/client');
const { getGuardStats } = require('./guards');
const { installGlobalSafeNet } = require('./safe-mode');

const app = express();

// ── Ensure schema (idempotente, no bloquea el arranque) ─────────────────────────
// Crea la tabla `vehiculos` (multi-vehículo por cliente) y backfillea el vehículo
// actual de cada cliente. Envuelto en try/catch para que NUNCA tumbe el server.
async function ensureSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS vehiculos (
        id          SERIAL PRIMARY KEY,
        cliente_id  INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
        placa       TEXT, marca TEXT, modelo TEXT, anio TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente ON vehiculos(cliente_id);
      INSERT INTO vehiculos (cliente_id, placa, marca, modelo, anio)
      SELECT id, placa, marca, modelo, anio FROM clientes
      WHERE COALESCE(placa,'') <> ''
        AND NOT EXISTS (SELECT 1 FROM vehiculos v WHERE v.cliente_id = clientes.id);

      CREATE TABLE IF NOT EXISTS consultas_precio (
        id          SERIAL PRIMARY KEY,
        telefono    TEXT NOT NULL,
        nombre      TEXT,
        pregunta    TEXT NOT NULL,
        estado      TEXT DEFAULT 'pendiente',
        respuesta   TEXT,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        answered_at TIMESTAMPTZ
      );
      ALTER TABLE consultas_precio ADD COLUMN IF NOT EXISTS notify_msg_id TEXT;
      ALTER TABLE consultas_precio ADD COLUMN IF NOT EXISTS vehiculo TEXT;
      ALTER TABLE consultas_precio ADD COLUMN IF NOT EXISTS placa TEXT;
      ALTER TABLE consultas_precio ADD COLUMN IF NOT EXISTS concepto TEXT;
      ALTER TABLE citas ADD COLUMN IF NOT EXISTS calificacion INTEGER;
      ALTER TABLE clientes ADD COLUMN IF NOT EXISTS es_proveedor BOOLEAN DEFAULT false;
      CREATE INDEX IF NOT EXISTS idx_consultas_estado ON consultas_precio(estado);

      CREATE TABLE IF NOT EXISTS mensajes_procesados (
        message_id TEXT PRIMARY KEY,
        telefono   TEXT,
        provider   TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Conversation Control Layer (Etapa 2): ownership + estado por conversación
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS owner_type         TEXT DEFAULT 'BOT';
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS owner_id           TEXT;
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS last_owner_change  TIMESTAMPTZ;
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS last_human_activity TIMESTAMPTZ;
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS last_bot_activity  TIMESTAMPTZ;
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS conversation_mode  TEXT DEFAULT 'BOT';
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS intencion          TEXT;
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS last_answered_message_id TEXT;
      ALTER TABLE conversaciones ADD COLUMN IF NOT EXISTS updated_at         TIMESTAMPTZ;

      CREATE TABLE IF NOT EXISTS precios_estandar (
        id         SERIAL PRIMARY KEY,
        servicio   TEXT NOT NULL,
        precio     NUMERIC NOT NULL,
        nota       TEXT,
        activo     BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS _migraciones (
        nombre  TEXT PRIMARY KEY,
        ran_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[db] ensureSchema OK (vehiculos, consultas_precio, precios_estandar, mensajes_procesados, conversaciones+control, _migraciones)');

    // Migración de una sola vez: limpiar precios incrustados en nombres del catálogo.
    await runCatalogCleanOnce();

    // Cargar la lista de proveedores (una vez por SEED_VERSION).
    await runProveedoresSeedOnce();
  } catch (e) {
    console.error('[db] ensureSchema falló (continúa el arranque):', e.message);
  }
}

// Corre la limpieza del catálogo exactamente una vez (registrada en _migraciones).
async function runCatalogCleanOnce() {
  const MIGRATION = 'clean_catalog_prices_v1';
  try {
    const { rows } = await pool.query('SELECT 1 FROM _migraciones WHERE nombre = $1', [MIGRATION]);
    if (rows.length) return; // ya corrió
    const { cleanCatalogNames } = require('../tools/db/clean-catalog-names');
    const changed = await cleanCatalogNames(pool, { apply: true });
    await pool.query('INSERT INTO _migraciones (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [MIGRATION]);
    console.log(`[clean-catalog] migración aplicada: ${changed} nombre(s) limpiados`);
  } catch (e) {
    console.error('[clean-catalog] migración falló (continúa el arranque):', e.message);
  }
}

// Carga la lista de proveedores una sola vez por versión (se re-ejecuta al subir SEED_VERSION).
async function runProveedoresSeedOnce() {
  try {
    const { SEED_VERSION, seedProveedores } = require('../tools/db/seed-proveedores');
    const MIGRATION = 'seed_proveedores_' + SEED_VERSION;
    const { rows } = await pool.query('SELECT 1 FROM _migraciones WHERE nombre = $1', [MIGRATION]);
    if (rows.length) return; // esta versión ya corrió
    const n = await seedProveedores();
    await pool.query('INSERT INTO _migraciones (nombre) VALUES ($1) ON CONFLICT DO NOTHING', [MIGRATION]);
    console.log(`[seed-proveedores] aplicado (${MIGRATION}): ${n} marcados`);
  } catch (e) {
    console.error('[seed-proveedores] migración falló (continúa el arranque):', e.message);
  }
}

// ── Seguridad ─────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false })); // CSP off para no romper el admin HTML inline
app.set('trust proxy', 1); // Railway usa proxy

app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Parseo mínimo de cookies (sin dependencias) → req.cookies
app.use((req, _res, next) => {
  const header = req.headers.cookie || '';
  req.cookies = {};
  header.split(';').forEach(pair => {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) req.cookies[k] = decodeURIComponent(v);
    }
  });
  next();
});
app.use(express.static(path.join(__dirname, '..', 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// ── Webhook (WhatsApp) — sin rate limit para no perder mensajes ───────────────
app.get('/webhook', (req, res) => {
  const mode  = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WEBHOOK_VERIFY_TOKEN) {
    console.log('[webhook] verified');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  res.status(200).end();
  try { await handleInbound(req.body); }
  catch (err) { console.error('[webhook] error:', err.message); }
});

// ── Webhook (respond.io) — proveedor nuevo, en paralelo, no toca el de arriba ───
app.post('/webhook/respondio', async (req, res) => {
  if (process.env.RESPOND_IO_WEBHOOK_SECRET && req.query.secret !== process.env.RESPOND_IO_WEBHOOK_SECRET) {
    return res.sendStatus(403);
  }
  res.status(200).end();
  try { await handleRespondioInbound(req.body); }
  catch (err) { console.error('[webhook/respondio] error:', err.message); }
});

// ── Webhook (360dialog) — proveedor nuevo, en paralelo, no toca los de arriba ───
app.post('/webhook/360dialog', async (req, res) => {
  if (process.env.D360_WEBHOOK_SECRET && req.query.secret !== process.env.D360_WEBHOOK_SECRET) {
    return res.sendStatus(403);
  }
  res.status(200).end();
  try { await handleD360Inbound(req.body); }
  catch (err) { console.error('[webhook/360dialog] error:', err.message); }
});

// ── Blueprints (SVG vehicle diagrams) ──────────────────────────────────────────
app.use('/blueprint_autos', express.static(path.join(__dirname, '..', 'public', 'blueprint_autos'), {
  etag: true,
  maxAge: '1d',
}));

// ── API REST ──────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);

// ── Admin dashboard (puerta cerrada: requiere sesión válida) ────────────────────
function serveAdminHtml(res) {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
}

app.get('/admin', (req, res) => {
  // Sin cookie de sesión válida no se sirve el panel: se manda a la pantalla de login.
  if (apiRouter.isValidSession && apiRouter.isValidSession(req.cookies.tgm_sid)) {
    return serveAdminHtml(res);
  }
  res.redirect('/login');
});

// Pantalla de login (mismo HTML; muestra el formulario de acceso cuando no hay sesión).
app.get('/login', (req, res) => serveAdminHtml(res));

// ── Root ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/admin'));

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({
  status:   'ok',
  service:  'monterito-erp',
  provider: process.env.WHATSAPP_PROVIDER || 'wati',
  ...getGuardStats(),
}));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] Monterito ERP corriendo en puerto ${PORT}`);
  installGlobalSafeNet();
  ensureSchema();
  scheduler.start();
});
