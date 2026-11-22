'use strict';
// Logs estructurados (JSON) a stdout: Docker los recoge y los rota.
const pino = require('pino');

module.exports = pino({
  level: process.env.LOG_LEVEL || 'info',
  base: { svc: 'api' },
  redact: ['req.headers.cookie', 'password', '*.password'],
});
