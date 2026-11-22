'use strict';
// Autenticación: lee el JWT de la cookie HttpOnly "sesion", lo verifica y
// carga el usuario DESDE LA BASE DE DATOS en cada petición. Así, si el
// admin desactiva a alguien o le cambia el rol, el cambio aplica al instante.
const jwt = require('jsonwebtoken');
const config = require('../config');
const { pool } = require('../db');

const COOKIE = 'sesion';

async function autenticar(req, res, next) {
  const token = req.cookies && req.cookies[COOKIE];
  if (!token) return res.status(401).json({ error: 'No has iniciado sesión' });

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    res.clearCookie(COOKIE, { path: '/' });
    return res.status(401).json({ error: 'Sesión inválida o vencida' });
  }

  const { rows } = await pool.query(
    'SELECT id, username, nombre, rol, activo FROM users WHERE id = $1',
    [payload.sub],
  );
  const user = rows[0];
  if (!user || !user.activo) {
    res.clearCookie(COOKIE, { path: '/' });
    return res.status(401).json({ error: 'Usuario inexistente o desactivado' });
  }
  req.user = { id: user.id, username: user.username, nombre: user.nombre, rol: user.rol };
  return next();
}

function emitirSesion(res, user) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtTtlSeg,
  });
  res.cookie(COOKIE, token, {
    httpOnly: true,          // JavaScript del navegador no puede leerla
    sameSite: 'strict',      // no viaja en peticiones desde otros sitios (CSRF)
    secure: config.cookieSecure, // true cuando haya HTTPS
    maxAge: config.jwtTtlSeg * 1000,
    path: '/',
  });
}

function cerrarSesion(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

module.exports = { autenticar, emitirSesion, cerrarSesion };
