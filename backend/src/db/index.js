const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Erreur inattendue sur le client PostgreSQL inactif', err);
});

const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV !== 'production') {
      console.log('Query exécutée', { text: text.substring(0, 80), duration, rows: res.rowCount });
    }
    return res;
  } catch (err) {
    console.error('Erreur DB:', err.message);
    throw err;
  }
};

const getClient = () => pool.connect();

// Setup initial de la BDD
const setup = async () => {
  const schemaPath = path.join(__dirname, '../../schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  try {
    await pool.query(schema);
    console.log('✅ Schéma BDD appliqué avec succès');
  } catch (err) {
    console.error('❌ Erreur lors de l\'application du schéma:', err.message);
    throw err;
  }
};

module.exports = { query, getClient, pool, setup };
