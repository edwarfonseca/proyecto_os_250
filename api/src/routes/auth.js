'use strict';
// POST /api/auth/login · POST /api/auth/logout · GET /api/auth/me
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { pool } = require('../db');
const { audit } = require('../audit');
const { verificar } = require('../passwords');
const { autenticar, emitirSesion, cerrarSesion } = require('../middleware/auth');

const router = express.Router();

// Fuerza bruta: máximo 5 intentos FALLIDOS por minuto y por IP.
// Los inicios de sesión correctos no cuentan.
const limiteLogin = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: async (req, res) => {
    const username = typeof req.body?.username === 'string' ? req.body.username.slice(0, 64) : null;
    await audit(req, 'login', { tipo: 'usuario', id: username }, 'DENEGADO',
      { motivo: 'demasiados_intentos', username_intentado: username });
    res.status(429).json({ error: 'Demasiados intentos fallidos. Espera un minuto.' });
  },
});

router.post('/login', limiteLogin, async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > 128) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }
  const nombre = username.trim().toLowerCase();
  const { rows } = await pool.query(
    'SELECT id, username, nombre, rol, activo, password_hash FROM users WHERE username = $1',
    [nombre],
  );
  const user = rows[0];
  const ok = await verificar(user ? user.password_hash : null, password);

  if (!ok || !user.activo) {
    await audit(req, 'login', { tipo: 'usuario', id: nombre }, 'DENEGADO', {
      motivo: !ok ? 'credenciales_invalidas' : 'usuario_desactivado',
      username_intentado: nombre,
    });
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  emitirSesion(res, user);
  req.user = { id: user.id, username: user.username, rol: user.rol };
  await audit(req, 'login', { tipo: 'usuario', id: user.id }, 'PERMITIDO');
  return res.json({ user: { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol } });
});

router.post('/logout', autenticar, async (req, res) => {
  await audit(req, 'logout', { tipo: 'usuario', id: req.user.id }, 'PERMITIDO');
  cerrarSesion(res);
  res.json({ ok: true });
});

router.get('/me', autenticar, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
