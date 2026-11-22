'use strict';
// Toda la configuración sale de variables de entorno (.env). Nada de
// secretos escritos en el código.

function requerida(nombre) {
  const v = process.env[nombre];
  if (!v) {
    console.error(`Falta la variable de entorno ${nombre}`);
    process.exit(1);
  }
  return v;
}

const jwtSecret = requerida('JWT_SECRET');
if (jwtSecret.length < 32) {
  console.error('JWT_SECRET debe tener al menos 32 caracteres');
  process.exit(1);
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  db: {
    host: process.env.DB_HOST || 'db',
    port: Number(process.env.DB_PORT || 5432),
    database: requerida('DB_NAME'),
    user: requerida('DB_USER'),
    password: requerida('DB_PASSWORD'),
  },
  jwtSecret,
  jwtTtlSeg: 60 * 60, // 1 hora
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  dataDir: process.env.DATA_DIR || '/data',
  maxBytes: 5 * 1024 * 1024, // 5 MB, igual que Nginx
  seedDemo: process.env.SEED_DEMO === 'true',
  adminPassword: process.env.ADMIN_PASSWORD || '',
  demoPassword: process.env.DEMO_PASSWORD || '',
  logLevel: process.env.LOG_LEVEL || 'info',
};
