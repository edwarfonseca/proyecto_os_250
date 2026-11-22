'use strict';
// POST /api/actividades/:id/entregas   subir entrega (estudiante, regla RN-1)
// POST /api/actividades/:id/prorrogas  otorgar prórroga (docente del curso)
const express = require('express');
const { pool, transaccion } = require('../db');
const { audit } = require('../audit');
const { authorize } = require('../middleware/authorize');
const { verificarRN1 } = require('../middleware/rn1');
const { cargarActividad, esDocenteDelCurso, noEncontrado } = require('../middleware/scope');
const { recibirArchivo, nombreSeguro, rutaRelativa, borrarSilencioso } = require('../upload');

const router = express.Router();

// Orden importante: primero permisos y RN-1, DESPUÉS se acepta el archivo.
// Así un estudiante fuera de plazo no llega a escribir nada en disco.
router.post('/:id/entregas', authorize('entrega:subir'), verificarRN1('entrega:subir'), recibirArchivo, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "archivo")' });
  const act = req.actividad;
  const nombre = nombreSeguro(req.file.originalname);
  const mime = (req.file.mimetype || 'application/octet-stream').split(';')[0];

  let ids;
  try {
    // Entrega + trabajo en UNA transacción. pg_notify se entrega al confirmar.
    ids = await transaccion(async (c) => {
      const s = await c.query(
        `INSERT INTO submissions (assignment_id, student_id, nombre_original, ruta, tamano, mime)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [act.id, req.user.id, nombre, rutaRelativa(req.file.path), req.file.size, mime],
      );
      const j = await c.query('INSERT INTO jobs (submission_id) VALUES ($1) RETURNING id', [s.rows[0].id]);
      await c.query("SELECT pg_notify('nuevo_trabajo', $1)", [j.rows[0].id]);
      return { submission: s.rows[0].id, job: j.rows[0].id };
    });
  } catch (e) {
    borrarSilencioso(req.file.path); // si la BD falla, no dejamos archivos huérfanos
    throw e;
  }

  const recurso = { tipo: 'entrega', id: ids.submission };
  await audit(req, 'entrega:subir', recurso, 'PERMITIDO',
    { actividad: act.titulo, curso: act.curso, nombre, tamano: req.file.size, fecha_limite: act.limite_efectivo });
  await audit(req, 'trabajo:encolado', recurso, 'PERMITIDO', { job_id: ids.job });
  return res.status(201).json({ id: ids.submission, job_id: ids.job, estado: 'pendiente', nombre, tamano: req.file.size });
});

router.post('/:id/prorrogas', authorize('prorroga:otorgar'), async (req, res) => {
  const recurso = { tipo: 'actividad', id: req.params.id };
  const act = await cargarActividad(req.params.id);
  if (!act || !esDocenteDelCurso(req.user, act)) {
    return noEncontrado(req, res, 'prorroga:otorgar', recurso, act ? 'no_es_docente_del_curso' : 'actividad_inexistente');
  }
  const { estudiante, nueva_fecha_limite: nf } = req.body || {};
  const fecha = new Date(nf);
  if (Number.isNaN(fecha.getTime())) return res.status(400).json({ error: 'nueva_fecha_limite inválida (formato ISO)' });
  if (fecha <= new Date()) return res.status(400).json({ error: 'La nueva fecha límite debe estar en el futuro' });

  // El estudiante debe estar matriculado en ESTE curso.
  const { rows } = await pool.query(
    `SELECT u.id, u.username FROM users u
       JOIN enrollments e ON e.student_id = u.id AND e.course_id = $2
      WHERE (u.username = $1 OR u.id::text = $1) AND u.rol = 'estudiante'`,
    [String(estudiante || '').trim().toLowerCase(), act.course_id],
  );
  if (!rows[0]) return res.status(400).json({ error: 'El estudiante no está matriculado en este curso' });
  const est = rows[0];

  await pool.query(
    `INSERT INTO extensions (assignment_id, student_id, nueva_fecha_limite, otorgada_por)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (assignment_id, student_id)
     DO UPDATE SET nueva_fecha_limite = EXCLUDED.nueva_fecha_limite,
                   otorgada_por = EXCLUDED.otorgada_por, creado_en = now()`,
    [act.id, est.id, fecha, req.user.id],
  );
  // Quién la dio (user_id del docente), a quién y hasta cuándo.
  await audit(req, 'prorroga:otorgar', recurso, 'PERMITIDO', {
    regla: 'RN-1',
    student_id: est.id,
    estudiante: est.username,
    actividad: act.titulo,
    fecha_limite_original: act.fecha_limite,
    nueva_fecha_limite: fecha.toISOString(),
  });
  return res.status(201).json({ ok: true, actividad: act.titulo, estudiante: est.username, nueva_fecha_limite: fecha });
});

module.exports = router;
