-- Override de mano de obra (servicios) editable solo en la prefactura.
-- Estructura: JSONB [{ "desc": "...", "precio": 0 }]
-- No altera servicios_detalle de la orden de trabajo.
ALTER TABLE citas ADD COLUMN IF NOT EXISTS prefactura_servicios JSONB;
