-- Add new columns for vehicle type selector, key code, and independent prefactura editing
ALTER TABLE citas ADD COLUMN IF NOT EXISTS tipo_vehiculo VARCHAR(30);
ALTER TABLE citas ADD COLUMN IF NOT EXISTS clave_codigo VARCHAR(50);
ALTER TABLE citas ADD COLUMN IF NOT EXISTS prefactura_items JSONB;
ALTER TABLE citas ADD COLUMN IF NOT EXISTS prefactura_mano_obra DECIMAL(10,2);
ALTER TABLE citas ADD COLUMN IF NOT EXISTS prefactura_notas TEXT;
