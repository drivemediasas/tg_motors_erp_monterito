-- TG Motors ERP — Schema PostgreSQL
-- Ejecutar una sola vez: node tools/db/init.js

CREATE TABLE IF NOT EXISTS clientes (
  id                    SERIAL PRIMARY KEY,
  nombre                TEXT NOT NULL,
  telefono              TEXT UNIQUE NOT NULL,
  placa                 TEXT,
  marca                 TEXT,
  modelo                TEXT,
  anio                  TEXT,
  fecha_ultimo_servicio DATE,
  notas                 TEXT,
  mantenimiento_recordado BOOLEAN DEFAULT false,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehiculos (
  id          SERIAL PRIMARY KEY,
  cliente_id  INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  placa       TEXT,
  marca       TEXT,
  modelo      TEXT,
  anio        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vehiculos_cliente ON vehiculos(cliente_id);

CREATE TABLE IF NOT EXISTS citas (
  id                   SERIAL PRIMARY KEY,
  nombre_cliente       TEXT,
  telefono             TEXT,
  servicio_solicitado  TEXT,
  fecha                DATE,
  hora                 TIME,
  estado               TEXT DEFAULT 'Pendiente',
  seguimiento          TEXT,
  fecha_completada     DATE,
  -- Campos de orden de trabajo
  kilometraje          INTEGER,
  descripcion_problema TEXT,
  trabajos             TEXT,
  repuestos            TEXT,
  tecnico              TEXT,
  tiempo_estimado      NUMERIC,
  estado_orden         TEXT DEFAULT 'Borrador',
  notas                TEXT,
  created_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_citas_telefono ON citas(telefono);
CREATE INDEX IF NOT EXISTS idx_citas_fecha    ON citas(fecha);

CREATE TABLE IF NOT EXISTS disponibilidad (
  id          SERIAL PRIMARY KEY,
  fecha       DATE NOT NULL,
  hora        TIME NOT NULL,
  disponible  BOOLEAN DEFAULT true,
  cita_id     INTEGER REFERENCES citas(id),
  tecnico     TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_disp_fecha_hora_tec ON disponibilidad(fecha, hora, COALESCE(tecnico, ''));

CREATE TABLE IF NOT EXISTS conversaciones (
  id                   SERIAL PRIMARY KEY,
  telefono             TEXT UNIQUE NOT NULL,
  paso                 TEXT DEFAULT 'activo',
  servicio_elegido     TEXT,
  historial            JSONB DEFAULT '[]',
  ultima_actualizacion TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reincidencias (
  id               SERIAL PRIMARY KEY,
  placa            TEXT,
  telefono         TEXT,
  cliente_nombre   TEXT,
  tecnico          TEXT,
  trabajo_original TEXT,
  fecha_original   DATE,
  fecha_regreso    DATE,
  motivo_regreso   TEXT,
  misma_falla      BOOLEAN DEFAULT false,
  estado           TEXT DEFAULT 'Pendiente revisión',
  cita_original_id INTEGER REFERENCES citas(id),
  cita_regreso_id  INTEGER REFERENCES citas(id),
  created_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reinc_telefono ON reincidencias(telefono);

-- Consultas de precio: el bot las registra y notifica al dueño; la respuesta
-- del dueño (modo admin) se reenvía al cliente.
CREATE TABLE IF NOT EXISTS consultas_precio (
  id            SERIAL PRIMARY KEY,
  telefono      TEXT NOT NULL,
  nombre        TEXT,
  pregunta      TEXT NOT NULL,
  estado        TEXT DEFAULT 'pendiente',
  respuesta     TEXT,
  notify_msg_id TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  answered_at   TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_consultas_estado ON consultas_precio(estado);

-- Precios estándar de servicios básicos que el bot SÍ puede responder directo.
CREATE TABLE IF NOT EXISTS precios_estandar (
  id         SERIAL PRIMARY KEY,
  servicio   TEXT NOT NULL,
  precio     NUMERIC NOT NULL,
  nota       TEXT,
  activo     BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
