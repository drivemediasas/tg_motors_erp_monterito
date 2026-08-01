const { Pool } = require('pg');

const pool = new Pool({ 
  connectionString: 'postgresql://postgres:RwhXLTeqppWkVfzLqylyOskKvwRpkTpi@acela.proxy.rlwy.net:28593/railway'
});

(async () => {
  try {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 FINALIZANDO TG MOTORS ERP PARA PRODUCCIÓN');
    console.log('='.repeat(60));

    // PASO 1: Crear clientes de prueba
    console.log('\n📝 PASO 1: Creando clientes de prueba...');
    await pool.query(`
      INSERT INTO clientes (nombre, telefono, placa, marca, modelo, cedula, direccion) 
      VALUES 
      ('Juan Pérez García', '0987654321', 'ABC-1234', 'Toyota', 'Corolla 2020', '1712345678', 'Av. Amazonas N23-45'),
      ('María García López', '0912345678', 'XYZ-5678', 'Chevrolet', 'Spark 2019', '1787654321', 'Calle 10 de Agosto'),
      ('Carlos López Ruiz', '0998765432', 'DEF-9012', 'Hyundai', 'i10 2021', '1745678901', 'Calle Pichincha')
      ON CONFLICT (telefono) DO NOTHING;
    `);
    const clientCount = await pool.query('SELECT COUNT(*) FROM clientes');
    console.log(`✅ Clientes en BD: ${clientCount.rows[0].count}`);

    // PASO 2: Ejecutar migraciones SQL
    console.log('\n📝 PASO 2: Ejecutando migraciones SQL...');
    await pool.query(`
      ALTER TABLE citas ADD COLUMN IF NOT EXISTS tipo_vehiculo VARCHAR(30);
      ALTER TABLE citas ADD COLUMN IF NOT EXISTS clave_codigo VARCHAR(50);
      ALTER TABLE citas ADD COLUMN IF NOT EXISTS prefactura_items JSONB;
      ALTER TABLE citas ADD COLUMN IF NOT EXISTS prefactura_mano_obra DECIMAL(10,2);
      ALTER TABLE citas ADD COLUMN IF NOT EXISTS prefactura_notas TEXT;
    `);
    console.log('✅ Migraciones ejecutadas correctamente');

    // PASO 3: Verificar estructura
    console.log('\n📝 PASO 3: Verificando estructura de la BD...');
    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name='citas' AND column_name IN ('tipo_vehiculo', 'clave_codigo', 'prefactura_items')
    `);
    if (columns.rows.length === 3) {
      console.log('✅ Columnas nuevas creadas correctamente');
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ BASE DE DATOS LISTA PARA PRODUCCIÓN');
    console.log('='.repeat(60));
    console.log('\n📱 URL PÚBLICA: https://tg-motors-monterito-production.up.railway.app');
    console.log('👤 Usuario: admin@tgmotors.com');
    console.log('🔑 Contraseña: 123456');
    console.log('\n✅ CLIENTES DE PRUEBA DISPONIBLES:');
    console.log('  • Juan Pérez García (0987654321)');
    console.log('  • María García López (0912345678)');
    console.log('  • Carlos López Ruiz (0998765432)');
    console.log('\n');
    
    await pool.end();
    process.exit(0);
  } catch(e) {
    console.error('\n❌ ERROR:', e.message);
    await pool.end();
    process.exit(1);
  }
})();
