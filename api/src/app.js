'use strict';
// Punto de entrada de la API.
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const config = require('./config');
const log = require('./logger');
const { pool } = require('./db');
const { audit } = require('./audit');
const { autenticar } = require('./middleware/auth');
const { sembrar } = require('./seed');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // hay exactamente un proxy delante (Nginx): IP real del cliente
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Log de cada petición (sin cabeceras ni cookies).
app.use((req, res, next) => {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/api/health') return;
    log.info({
      metodo: req.method, ruta: req.originalUrl, status: res.statusCode,
      ms: Number(process.hrtime.bigint() - t0) / 1e6, usuario: req.user?.username, ip: req.ip,
    }, 'peticion');
  });
  next();
});

// Salud: la usa el healthcheck de Docker y Nginx.
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch {
    res.status(503).json({ status: 'error', db: 'sin conexión' });
  }
});

app.use('/api/auth', require('./routes/auth'));

// Todo lo que sigue exige sesión.
app.use('/api', autenticar);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/cursos', require('./routes/cursos'));
app.use('/api/actividades', require('./routes/actividades'));
app.use('/api/entregas', require('./routes/entregas'));
app.use('/api', (_req, res) => res.status(404).json({ error: 'No encontrado' }));

// Manejo central de errores.
// eslint-disable-next-line no-unused-vars
app.use(async (err, req, res, _next) => {
  let status = 500;
  let mensaje = 'Error interno';
  let motivo = null;
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') { status = 413; mensaje = 'El archivo supera el máximo de 5 MB'; motivo = 'archivo_muy_grande'; }
    else { status = 400; mensaje = `Formulario inválido: ${err.code}`; motivo = 'formulario_invalido'; }
  } else if (err.code === 'TIPO_NO_PERMITIDO') {
    status = 415; mensaje = err.message; motivo = 'tipo_no_permitido';
  } else if (err.type === 'entity.too.large') {
    status = 413; mensaje = 'Cuerpo de la petición demasiado grande';
  } else if (err.type === 'entity.parse.failed') {
    status = 400; mensaje = 'JSON inválido';
  } else {
    log.error({ err: err.message, stack: err.stack, ruta: req.originalUrl }, 'error no controlado');
  }
  // Los archivos rechazados también quedan en la auditoría.
  if (motivo && req.user && req.auditCtx) {
    await audit(req, req.auditCtx.accion, req.auditCtx.recurso, 'DENEGADO', { motivo });
  }
  if (!res.headersSent) res.status(status).json({ error: mensaje });
});

async function esperarBD(intentos = 30) {
  for (let i = 1; i <= intentos; i += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      log.warn({ intento: i, err: e.message }, 'esperando a la base de datos');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('La base de datos no responde');
}

async function main() {
  await esperarBD();
  await sembrar();
  const server = app.listen(config.port, () => log.info({ puerto: config.port }, 'API escuchando'));

  // Apagado ordenado (docker compose stop envía SIGTERM).
  const apagar = (senal) => {
    log.info({ senal }, 'apagando API');
    server.close(() => pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', apagar);
  process.on('SIGINT', apagar);
}

main().catch((e) => {
  log.fatal({ err: e.message }, 'no se pudo arrancar la API');
  process.exit(1);
});
