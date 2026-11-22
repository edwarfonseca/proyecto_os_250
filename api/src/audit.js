'use strict';
// =====================================================================
// AUDITORÍA · una sola función para todo el sistema.
//   audit(req, 'entrega:descargar', { tipo: 'entrega', id }, 'PERMITIDO', { ... })
// Se llama en las acciones permitidas y en las denegadas importantes.
// La tabla audit_log es append-only (ver db/migrations/002 y 001).
//
// Reto 6 (auditoría): añadir una línea  await audit(req, ...)  en la ruta
// que pidan.
// =====================================================================
const { pool } = require('./db');
const log = require('./logger');

async function audit(req, accion, recurso, resultado, detalle = {}) {
  const u = (req && req.user) || {};
  try {
    await pool.query(
      `INSERT INTO audit_log
         (user_id, username, rol, accion, recurso_tipo, recurso_id, resultado, ip, detalle)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        u.id || null,
        u.username || (detalle && detalle.username_intentado) || null,
        u.rol || 'anonimo',
        accion,
        recurso ? recurso.tipo : null,
        recurso && recurso.id != null ? String(recurso.id) : null,
        resultado,
        (req && req.ip) || null,
        detalle || {},
      ],
    );
  } catch (e) {
    // Si la auditoría falla, se deja constancia en el log del contenedor.
    log.error({ err: e.message, accion, resultado }, 'no se pudo escribir en audit_log');
  }
}

module.exports = { audit };
