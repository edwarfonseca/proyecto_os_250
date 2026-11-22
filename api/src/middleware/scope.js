'use strict';
// =====================================================================
// Capa 2 de autorización: ALCANCE / PROPIEDAD (ABAC)
// ---------------------------------------------------------------------
// authorize() ya comprobó que el ROL puede hacer la acción. Aquí se
// comprueba que el RECURSO concreto le pertenece:
//   - el estudiante solo toca SUS entregas
//   - el docente solo toca los cursos que DICTA
//   - el admin ve metadatos, nunca contenido
// La mayoría de fallos de aislamiento ocurren aquí, no en el RBAC.
//
// Ante un recurso ajeno se responde 404 (no 403) para no confirmar que el
// ID existe. En la auditoría sí queda como DENEGADO.
//
// Reto 3 (aislamiento): la comprobación clave es esDuenoDeEntrega().
// =====================================================================
const { pool } = require('../db');
const { audit } = require('../audit');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const esUuid = (s) => typeof s === 'string' && UUID_RE.test(s);

// ---------- Comprobaciones de alcance ----------

function esDuenoDeEntrega(user, entrega) {
  return user.rol === 'estudiante' && entrega.student_id === user.id;
}

function esDocenteDelCurso(user, curso) {
  // "curso" puede ser una fila de courses o cualquier fila con docente_id
  return user.rol === 'docente' && curso.docente_id === user.id;
}

async function estaMatriculado(studentId, courseId) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM enrollments WHERE course_id = $1 AND student_id = $2',
    [courseId, studentId],
  );
  return rowCount > 0;
}

// ¿Puede ver el CONTENIDO de la entrega (archivo y resultado)?
function puedeAccederContenido(user, entrega) {
  if (user.rol === 'estudiante') return esDuenoDeEntrega(user, entrega);
  if (user.rol === 'docente') return esDocenteDelCurso(user, entrega);
  return false; // el Admin TI nunca ve contenido (separación de funciones)
}

// ¿Puede ver los METADATOS de la entrega (estado, tamaño, fechas)?
function puedeVerMetadatos(user, entrega) {
  return user.rol === 'admin' || puedeAccederContenido(user, entrega);
}

// ¿Puede ver la actividad o el curso?
async function puedeVerCurso(user, curso) {
  if (user.rol === 'admin') return true;
  if (user.rol === 'docente') return esDocenteDelCurso(user, curso);
  return estaMatriculado(user.id, curso.id);
}

// ---------- Cargadores de recursos ----------

async function cargarEntrega(id) {
  if (!esUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT s.*, a.titulo AS actividad, a.course_id, a.fecha_limite,
            c.codigo AS curso, c.docente_id, u.username AS estudiante,
            j.id AS job_id, j.estado, j.intentos, j.max_intentos, j.error,
            j.ms, j.ruta_resultado, j.iniciado_en, j.terminado_en
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN courses c     ON c.id = a.course_id
       JOIN users u       ON u.id = s.student_id
  LEFT JOIN jobs j        ON j.submission_id = s.id
      WHERE s.id = $1`,
    [id],
  );
  return rows[0] || null;
}

// Si se pasa studentId, calcula también su fecha límite efectiva (con prórroga).
async function cargarActividad(id, studentId = null) {
  if (!esUuid(id)) return null;
  const { rows } = await pool.query(
    `SELECT a.*, c.codigo AS curso, c.docente_id,
            e.nueva_fecha_limite AS prorroga,
            GREATEST(a.fecha_limite, e.nueva_fecha_limite) AS limite_efectivo
       FROM assignments a
       JOIN courses c ON c.id = a.course_id
  LEFT JOIN extensions e ON e.assignment_id = a.id AND e.student_id = $2
      WHERE a.id = $1`,
    [id, studentId],
  );
  return rows[0] || null;
}

async function cargarCurso(id) {
  if (!esUuid(id)) return null;
  const { rows } = await pool.query('SELECT * FROM courses WHERE id = $1', [id]);
  return rows[0] || null;
}

// Responde 404 y deja el intento en la auditoría.
async function noEncontrado(req, res, accion, recurso, motivo) {
  await audit(req, accion, recurso, 'DENEGADO', { motivo });
  return res.status(404).json({ error: 'No encontrado' });
}

module.exports = {
  esUuid,
  esDuenoDeEntrega,
  esDocenteDelCurso,
  estaMatriculado,
  puedeAccederContenido,
  puedeVerMetadatos,
  puedeVerCurso,
  cargarEntrega,
  cargarActividad,
  cargarCurso,
  noEncontrado,
};
