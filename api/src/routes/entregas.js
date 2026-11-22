'use strict';
// GET    /api/entregas                    lista según el rol
// GET    /api/entregas/:id                metadatos y estado
// GET    /api/entregas/:id/archivo        descargar el original (dueño o docente)
// GET    /api/entregas/:id/resultado      resultado del análisis (dueño o docente)
// PUT    /api/entregas/:id                reemplazar (dueño, RN-1)
// DELETE /api/entregas/:id                eliminar (dueño, RN-1)
// POST   /api/entregas/:id/reprocesar     reencolar un trabajo fallido (admin o docente)
// GET    /api/entregas/:id/trazabilidad   línea de tiempo (admin o docente)
const fs = require('node:fs');
const express = require('express');
const { pool, transaccion } = require('../db');
const { audit } = require('../audit');
const { puede } = require('../permissions');
const { authorize } = require('../middleware/authorize');
const { comprobarRN1 } = require('../middleware/rn1');
const {
  esUuid, cargarEntrega, esDuenoDeEntrega, esDocenteDelCurso,
  puedeAccederContenido, puedeVerMetadatos, noEncontrado,
} = require('../middleware/scope');
const { recibirArchivo, nombreSeguro, rutaRelativa, rutaAbsoluta, borrarSilencioso } = require('../upload');

const router = express.Router();
const rec = (id) => ({ tipo: 'entrega', id });

// Quita la marca de duplicado a quien no sea docente (regla complementaria).
function filtrarDuplicado(user, fila) {
  if (puede(user.rol, 'duplicado:ver')) return fila;
  const { posible_duplicado: _p, duplicado_con: _d, ...resto } = fila;
  return resto;
}

// Metadatos públicos de una entrega (sin rutas internas).
function metadatos(e) {
  return {
    id: e.id, actividad: e.actividad, assignment_id: e.assignment_id, curso: e.curso,
    estudiante: e.estudiante, nombre_original: e.nombre_original, tamano: e.tamano, mime: e.mime,
    sha256: e.sha256, creado_en: e.creado_en, actualizado_en: e.actualizado_en,
    trabajo: {
      id: e.job_id, estado: e.estado, intentos: e.intentos, max_intentos: e.max_intentos,
      error: e.error, ms: e.ms, iniciado_en: e.iniciado_en, terminado_en: e.terminado_en,
    },
  };
}

// ---------- Listado según el rol ----------
router.get('/', authorize('entrega:listar_propias', 'entrega:listar_curso', 'entrega:metadatos'), async (req, res) => {
  const params = [];
  const cond = [];
  if (req.user.rol === 'estudiante') { params.push(req.user.id); cond.push(`s.student_id = $${params.length}`); }
  else if (req.user.rol === 'docente') { params.push(req.user.id); cond.push(`c.docente_id = $${params.length}`); }
  if (esUuid(req.query.actividad)) { params.push(req.query.actividad); cond.push(`s.assignment_id = $${params.length}`); }

  const { rows } = await pool.query(
    `SELECT s.id, s.assignment_id, a.titulo AS actividad, c.codigo AS curso, u.username AS estudiante,
            s.nombre_original, s.tamano, s.mime, s.sha256, s.creado_en, s.actualizado_en,
            j.estado, j.intentos, j.error, j.ms, j.terminado_en,
            (s.sha256 IS NOT NULL AND EXISTS (
               SELECT 1 FROM submissions s2
                WHERE s2.assignment_id = s.assignment_id AND s2.sha256 = s.sha256
                  AND s2.student_id <> s.student_id)) AS posible_duplicado
       FROM submissions s
       JOIN assignments a ON a.id = s.assignment_id
       JOIN courses c     ON c.id = a.course_id
       JOIN users u       ON u.id = s.student_id
  LEFT JOIN jobs j        ON j.submission_id = s.id
      ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY s.creado_en DESC
      LIMIT 500`,
    params,
  );
  res.json(rows.map((r) => filtrarDuplicado(req.user, r)));
});

// ---------- Metadatos ----------
router.get('/:id', authorize('entrega:metadatos'), async (req, res) => {
  const e = await cargarEntrega(req.params.id);
  if (!e || !puedeVerMetadatos(req.user, e)) {
    return noEncontrado(req, res, 'entrega:metadatos', rec(req.params.id), e ? 'entrega_ajena' : 'entrega_inexistente');
  }
  return res.json(metadatos(e));
});

// ---------- Descargar el archivo original ----------
router.get('/:id/archivo', authorize('entrega:descargar'), async (req, res) => {
  const e = await cargarEntrega(req.params.id);
  if (!e || !puedeAccederContenido(req.user, e)) {
    return noEncontrado(req, res, 'entrega:descargar', rec(req.params.id), e ? 'entrega_ajena' : 'entrega_inexistente');
  }
  const abs = rutaAbsoluta(e.ruta);
  if (!fs.existsSync(abs)) return res.status(410).json({ error: 'El archivo ya no está disponible' });
  await audit(req, 'entrega:descargar', rec(e.id), 'PERMITIDO', { nombre: e.nombre_original });
  // Siempre como descarga y octet-stream: el navegador no lo interpreta (evita XSS).
  res.attachment(e.nombre_original);
  res.type('application/octet-stream');
  return fs.createReadStream(abs).pipe(res);
});

// ---------- Resultado del análisis ----------
router.get('/:id/resultado', authorize('resultado:ver'), async (req, res) => {
  const e = await cargarEntrega(req.params.id);
  if (!e || !puedeAccederContenido(req.user, e)) {
    return noEncontrado(req, res, 'resultado:ver', rec(req.params.id), e ? 'entrega_ajena' : 'entrega_inexistente');
  }
  if (e.estado !== 'completado' || !e.ruta_resultado) {
    return res.status(409).json({ error: 'El resultado aún no está disponible', estado: e.estado, motivo: e.error });
  }
  const resultado = JSON.parse(await fs.promises.readFile(rutaAbsoluta(e.ruta_resultado), 'utf8'));

  if (puede(req.user.rol, 'duplicado:ver')) {
    // Se recalcula en vivo: puede haber llegado una copia después del análisis.
    const { rows } = await pool.query(
      `SELECT s2.id AS entrega_id, u.username AS estudiante FROM submissions s2
         JOIN users u ON u.id = s2.student_id
        WHERE s2.assignment_id = $1 AND s2.sha256 = $2 AND s2.student_id <> $3`,
      [e.assignment_id, e.sha256, e.student_id],
    );
    resultado.posible_duplicado = rows.length > 0;
    resultado.duplicado_con = rows;
  }
  await audit(req, 'resultado:ver', rec(e.id), 'PERMITIDO');
  return res.json(filtrarDuplicado(req.user, resultado));
});

// ---------- Reemplazar o eliminar: solo el dueño y dentro del plazo ----------
function cargarPropiaConRN1(accion) {
  return async function propiaMiddleware(req, res, next) {
    const e = await cargarEntrega(req.params.id);
    if (!e || !esDuenoDeEntrega(req.user, e)) {
      return noEncontrado(req, res, accion, rec(req.params.id), e ? 'entrega_ajena' : 'entrega_inexistente');
    }
    const act = await comprobarRN1(req, res, accion, e.assignment_id);
    if (!act) return undefined;
    req.entrega = e;
    req.auditCtx = { accion, recurso: rec(e.id) };
    return next();
  };
}

router.put('/:id', authorize('entrega:reemplazar'), cargarPropiaConRN1('entrega:reemplazar'), recibirArchivo, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo (campo "archivo")' });
  const e = req.entrega;
  const nombre = nombreSeguro(req.file.originalname);
  try {
    await transaccion(async (c) => {
      await c.query(
        `UPDATE submissions SET nombre_original = $2, ruta = $3, tamano = $4, mime = $5,
                sha256 = NULL, actualizado_en = now() WHERE id = $1`,
        [e.id, nombre, rutaRelativa(req.file.path), req.file.size, (req.file.mimetype || '').split(';')[0]],
      );
      await c.query(
        `UPDATE jobs SET estado = 'pendiente', intentos = 0, error = NULL, ruta_resultado = NULL, ms = NULL,
                disponible_en = now(), iniciado_en = NULL, terminado_en = NULL WHERE submission_id = $1`,
        [e.id],
      );
      await c.query("SELECT pg_notify('nuevo_trabajo', $1)", [e.job_id]);
    });
  } catch (err) {
    borrarSilencioso(req.file.path);
    throw err;
  }
  borrarSilencioso(rutaAbsoluta(e.ruta));
  if (e.ruta_resultado) borrarSilencioso(rutaAbsoluta(e.ruta_resultado));
  await audit(req, 'entrega:reemplazar', rec(e.id), 'PERMITIDO',
    { nombre_anterior: e.nombre_original, nombre, tamano: req.file.size });
  await audit(req, 'trabajo:encolado', rec(e.id), 'PERMITIDO', { job_id: e.job_id, motivo: 'reemplazo' });
  return res.json({ id: e.id, estado: 'pendiente', nombre, tamano: req.file.size });
});

router.delete('/:id', authorize('entrega:eliminar'), cargarPropiaConRN1('entrega:eliminar'), async (req, res) => {
  const e = req.entrega;
  await pool.query('DELETE FROM submissions WHERE id = $1', [e.id]); // el job se borra en cascada
  borrarSilencioso(rutaAbsoluta(e.ruta));
  if (e.ruta_resultado) borrarSilencioso(rutaAbsoluta(e.ruta_resultado));
  await audit(req, 'entrega:eliminar', rec(e.id), 'PERMITIDO', { nombre: e.nombre_original, actividad: e.actividad });
  return res.json({ ok: true });
});

// ---------- Reprocesar un trabajo fallido ----------
router.post('/:id/reprocesar', authorize('trabajo:reprocesar'), async (req, res) => {
  const e = await cargarEntrega(req.params.id);
  if (!e || (req.user.rol !== 'admin' && !esDocenteDelCurso(req.user, e))) {
    return noEncontrado(req, res, 'trabajo:reprocesar', rec(req.params.id), e ? 'curso_ajeno' : 'entrega_inexistente');
  }
  if (e.estado !== 'fallido') {
    return res.status(409).json({ error: `Solo se reprocesan trabajos fallidos (estado actual: ${e.estado})` });
  }
  await pool.query(
    `UPDATE jobs SET estado = 'pendiente', intentos = 0, error = NULL, disponible_en = now(),
            iniciado_en = NULL, terminado_en = NULL WHERE id = $1`,
    [e.job_id],
  );
  await pool.query("SELECT pg_notify('nuevo_trabajo', $1)", [e.job_id]);
  await audit(req, 'trabajo:reprocesar', rec(e.id), 'PERMITIDO', { job_id: e.job_id, error_anterior: e.error });
  return res.json({ ok: true, estado: 'pendiente' });
});

// ---------- Trazabilidad: la línea de tiempo completa de una entrega ----------
router.get('/:id/trazabilidad', authorize('trazabilidad:ver'), async (req, res) => {
  const e = await cargarEntrega(req.params.id);
  if (!e || (req.user.rol !== 'admin' && !esDocenteDelCurso(req.user, e))) {
    return noEncontrado(req, res, 'trazabilidad:ver', rec(req.params.id), e ? 'curso_ajeno' : 'entrega_inexistente');
  }
  // Eventos de la entrega + intentos del estudiante y prórrogas sobre su actividad.
  const { rows } = await pool.query(
    `SELECT id, ts, username, rol, accion, recurso_tipo, recurso_id, resultado, ip, detalle
       FROM audit_log
      WHERE (recurso_tipo = 'entrega' AND recurso_id = $1)
         OR (recurso_tipo = 'actividad' AND recurso_id = $2
             AND (user_id = $3 OR detalle->>'student_id' = $4))
      ORDER BY ts, id`,
    [e.id, e.assignment_id, e.student_id, e.student_id],
  );
  await audit(req, 'trazabilidad:ver', rec(e.id), 'PERMITIDO');
  return res.json({ entrega: metadatos(e), eventos: rows });
});

module.exports = router;
