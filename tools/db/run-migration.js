const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    const sql = fs.readFileSync('./tools/db/migrations/add_tipo_vehiculo_clave_prefactura.sql', 'utf8');
    await pool.query(sql);
    console.log('✅ Migration executed successfully');
    pool.end();
    process.exit(0);
  } catch(e) {
    console.error('❌ Migration failed:', e.message, e.code);
    pool.end();
    process.exit(1);
  }
})();
