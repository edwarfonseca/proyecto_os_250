'use strict';
// Conexión a PostgreSQL con el rol de mínimo privilegio "app_api".
const { Pool } = require('pg');
const config = require('./config');
const log = require('./logger');

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Si PostgreSQL se reinicia, las conexiones inactivas del pool reciben un error.
// Sin este manejador, Node lo trataría como una excepción no capturada y la API
// se caería; con él, el pool descarta esa conexión y abre otra en la siguiente consulta.
pool.on('error', (err) => log.error({ err: err.message }, 'se perdió una conexión inactiva con PostgreSQL'));

// Ejecuta fn(client) dentro de una transacción.
async function transaccion(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, transaccion };
