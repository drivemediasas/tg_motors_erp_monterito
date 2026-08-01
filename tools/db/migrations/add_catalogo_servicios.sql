-- Catálogo de servicios y materiales con precio (para seleccionar en la orden)
CREATE TABLE IF NOT EXISTS catalogo (
  id      SERIAL PRIMARY KEY,
  nombre  TEXT NOT NULL,
  tipo    TEXT NOT NULL DEFAULT 'material',  -- 'material' | 'servicio'
  precio  NUMERIC(10,2) NOT NULL DEFAULT 0,
  activo  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_catalogo_tipo ON catalogo(tipo);

-- Desglose de servicios de mano de obra por orden (suma = mano_de_obra)
ALTER TABLE citas ADD COLUMN IF NOT EXISTS servicios_detalle JSONB;
