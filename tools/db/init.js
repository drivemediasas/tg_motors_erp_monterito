// Crea todas las tablas en PostgreSQL. Ejecutar una sola vez.
// Uso: node tools/db/init.js
require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const pool = require('./client');

async function init() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await pool.query(sql);
  console.log('[db] Tablas creadas correctamente.');
  await pool.end();
}

init().catch(err => { console.error('[db] Error al inicializar:', err.message); process.exit(1); });
