require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
  max: parseInt(process.env.DB_POOL_MAX || '10', 10),
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  // Corta cualquier query que se trabe > 8s para que no cuelgue el turno del bot.
  statement_timeout: 8000,
});

pool.on('error', (err) => console.error('[db] Unexpected pool error:', err));

module.exports = pool;
