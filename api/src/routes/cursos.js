'use strict';
// GET  /api/cursos                       cursos visibles para el usuario
// GET  /api/cursos/:id/estudiantes       matriculados (admin o docente del curso)
// GET  /api/cursos/:id/actividades       actividades del curso
// POST /api/cursos/:id/actividades       crear actividad (docente del curso)
const express = require('express');
const { pool } = require('../db');
const { audit } = require('../audit');
const { authorize } = require('../middleware/authorize');
const { cargarCurso, puedeVerCurso, esDocenteDelCurso, noEncontrado } = require('../middleware/scope');

const router = express.Router();

router.get('/', authorize('curso:listar'), async (req, res) => {
  const base = `SELECT c.id, c.codigo, c.nombre, c.docente_id, d.username AS docente, d.nombre AS docente_nombre,
                       (SELECT count(*)::int FROM enrollments e WHERE e.course_id = c.id) AS matriculados,
                       (SELECT count(*)::int FROM assignments a WHERE a.course_id = c.id) AS actividades
                  FROM courses c JOIN users d ON d.id = c.docente_id`;
  let q;
  if (req.user.rol === 'admin') q = pool.query(`${base} ORDER BY c.codigo`);
  else if (req.user.rol === 'docente') q = pool.query(`${base} WHERE c.docente_id = $1 ORDER BY c.codigo`, [req.user.id]);
  else {
    q = pool.query(
      `${base} WHERE EXISTS (SELECT 1 FROM enrollments e WHERE e.course_id = c.id AND e.student_id = $1)
       ORDER BY c.codigo`,
      [req.user.id],
    );
  }
  res.json((await q).rows);
});

router.get('/:id/estudiantes', authorize('curso:ver_estudiantes'), async (req, res) => {
  const recurso = { tipo: 'curso', id: req.params.id };
  const curso = await cargarCurso(req.params.id);
  if (!curso) return noEncontrado(req, res, 'curso:ver_estudiantes', recurso, 'curso_inexistente');
  if (req.user.rol !== 'admin' && !esDocenteDelCurso(req.user, curso)) {
    return noEncontrado(req, res, 'curso:ver_estudiantes', recurso, 'no_es_docente_del_curso');
  }
  const { rows } = await pool.query(
    `SELECT u.id, u.username, u.nombre, u.activo FROM enrollments e
       JOIN users u ON u.id = e.student_id WHERE e.course_id = $1 ORDER BY u.username`,
    [curso.id],
  );
  return res.json(rows);
});

router.get('/:id/actividades', authorize('actividad:listar'), async (req, res) => {
  const recurso = { tipo: 'curso', id: req.params.id };
  const curso = await cargarCurso(req.params.id);
  if (!curso || !(await puedeVerCurso(req.user, curso))) {
    return noEncontrado(req, res, 'actividad:listar', recurso, curso ? 'curso_ajeno' : 'curso_inexistente');
  }
  // Para el estudiante se calcula su fecha límite efectiva (con prórroga).
  const { rows } = await pool.query(
    `SELECT a.id, a.titulo, a.descripcion, a.fecha_limite, a.creado_en,
            e.nueva_fecha_limite AS prorroga,
            GREATEST(a.fecha_limite, e.nueva_fecha_limite) AS limite_efectivo,
            GREATEST(a.fecha_limite, e.nueva_fecha_limite) > now() AS abierta,
            (SELECT count(*)::int FROM submissions s WHERE s.assignment_id = a.id
               AND ($2::text <> 'estudiante' OR s.student_id = $3)) AS entregas
       FROM assignments a
  LEFT JOIN extensions e ON e.assignment_id = a.id AND e.student_id = $3
      WHERE a.course_id = $1
      ORDER BY a.fecha_limite`,
    [curso.id, req.user.rol, req.user.rol === 'estudiante' ? req.user.id : null],
  );
  return res.json(rows);
});

router.post('/:id/actividades', authorize('actividad:crear'), async (req, res) => {
  const recurso = { tipo: 'curso', id: req.params.id };
  const curso = await cargarCurso(req.params.id);
  if (!curso || !esDocenteDelCurso(req.user, curso)) {
    return noEncontrado(req, res, 'actividad:crear', recurso, curso ? 'no_es_docente_del_curso' : 'curso_inexistente');
  }
  const { titulo, descripcion, fecha_limite: fl } = req.body || {};
  if (typeof titulo !== 'string' || !titulo.trim() || titulo.length > 120) {
    return res.status(400).json({ error: 'El título es obligatorio (máx. 120 caracteres)' });
  }
  const fecha = new Date(fl);
  if (Number.isNaN(fecha.getTime())) return res.status(400).json({ error: 'fecha_limite inválida (usa formato ISO, ej. 2026-12-01T23:59:00-05:00)' });
  if (fecha <= new Date()) return res.status(400).json({ error: 'La fecha límite debe estar en el futuro' });

  try {
    const { rows } = await pool.query(
      `INSERT INTO assignments (course_id, titulo, descripcion, fecha_limite, creado_por)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [curso.id, titulo.trim(), typeof descripcion === 'string' ? descripcion.slice(0, 2000) : '', fecha, req.user.id],
    );
    await audit(req, 'actividad:crear', { tipo: 'actividad', id: rows[0].id }, 'PERMITIDO',
      { curso: curso.codigo, titulo: rows[0].titulo, fecha_limite: rows[0].fecha_limite });
    return res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe una actividad con ese título en el curso' });
    throw e;
  }
});

module.exports = router;
