'use strict';
// =====================================================================
// RN-1 · Cierre de entregas con prórroga auditada
// ---------------------------------------------------------------------
// Un estudiante solo puede subir, reemplazar o eliminar una entrega si
//   (a) está matriculado en el curso de la actividad, y
//   (b) la fecha límite (o su prórroga individual) no ha pasado.
// Si no: el servidor rechaza (403 por plazo, 404 si no está matriculado)
// y lo registra como DENEGADO en audit_log.
// =====================================================================
const { audit } = require('../audit');
const { cargarActividad, estaMatriculado, noEncontrado } = require('./scope');

// Devuelve la actividad si se permite la operación; si no, responde y devuelve null.
async function comprobarRN1(req, res, accion, assignmentId) {
  const recurso = { tipo: 'actividad', id: assignmentId };
  const act = await cargarActividad(assignmentId, req.user.id);
  if (!act) return void (await noEncontrado(req, res, accion, recurso, 'actividad_inexistente'));

  // (a) matrícula
  if (!(await estaMatriculado(req.user.id, act.course_id))) {
    return void (await noEncontrado(req, res, accion, recurso, 'no_matriculado'));
  }

  // (b) plazo, con prórroga si existe
  const ahora = new Date();
  const limite = new Date(act.limite_efectivo);
  if (ahora > limite) {
    await audit(req, accion, recurso, 'DENEGADO', {
      motivo: 'fuera_de_plazo',
      regla: 'RN-1',
      fecha_limite: act.fecha_limite,
      prorroga: act.prorroga,
      intento_en: ahora.toISOString(),
    });
    res.status(403).json({
      error: 'La actividad está cerrada: la fecha límite ya pasó (RN-1). Pide una prórroga a tu docente.',
      fecha_limite: act.limite_efectivo,
    });
    return null;
  }
  return act;
}

// Versión middleware para POST /api/actividades/:id/entregas
function verificarRN1(accion) {
  return async function rn1Middleware(req, res, next) {
    const act = await comprobarRN1(req, res, accion, req.params.id);
    if (!act) return undefined;
    req.actividad = act;
    req.auditCtx = { accion, recurso: { tipo: 'actividad', id: act.id } };
    return next();
  };
}

module.exports = { comprobarRN1, verificarRN1 };
