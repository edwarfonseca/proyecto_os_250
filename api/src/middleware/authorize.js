'use strict';
// Capa 1 de autorización (RBAC): ¿el ROL del usuario puede hacer esta acción?
// Consulta permissions.js. Si no puede: 403 y se registra DENEGADO.
const { puede } = require('../permissions');
const { audit } = require('../audit');

// Para que el intento denegado aparezca en la trazabilidad del recurso.
const TIPOS = { '/api/entregas': 'entrega', '/api/actividades': 'actividad', '/api/cursos': 'curso' };

function authorize(...acciones) {
  return async function authorizeMiddleware(req, res, next) {
    if (req.user && acciones.some((a) => puede(req.user.rol, a))) return next();
    const ruta = `${req.method} ${req.originalUrl}`;
    const id = req.params && req.params.id;
    const recurso = id ? { tipo: TIPOS[req.baseUrl] || 'recurso', id } : { tipo: 'ruta', id: ruta };
    await audit(req, acciones[0], recurso, 'DENEGADO', { motivo: 'rol_sin_permiso', ruta });
    return res.status(403).json({ error: 'No tienes permiso para esta acción' });
  };
}

module.exports = { authorize };
