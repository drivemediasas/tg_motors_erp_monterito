-- Multi-vehículo por cliente: tabla vehiculos (1 cliente : N vehículos)
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

-- Backfill: pasar el vehículo actual de cada cliente (una sola vez, idempotente)
INSERT INTO vehiculos (cliente_id, placa, marca, modelo, anio)
SELECT id, placa, marca, modelo, anio FROM clientes
WHERE COALESCE(placa,'') <> ''
  AND NOT EXISTS (SELECT 1 FROM vehiculos v WHERE v.cliente_id = clientes.id);
