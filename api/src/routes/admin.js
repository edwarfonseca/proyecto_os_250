'use strict';
// Rutas del Administrador TI: usuarios, cursos, matrículas, auditoría y estado.
// Todas pasan por authorize(), que consulta permissions.js.
const fs = require('node:fs');
const express = require('express');
const config = require('../config');
const { pool } = require('../db');
const { audit } = require('../audit');
const { authorize } = require('../middleware/authorize');
const { esUuid, cargarCurso, noEncontrado } = require('../middleware/scope');
const { hashear, validarPolitica } = require('../passwords');

const router = express.Router();
const ROLES = ['admin', 'docente', 'estudiante'];
const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;

// ---------- Usuarios ----------

router.get('/usuarios', authorize('usuario:listar'), async (req, res) => {
  const params = [];
  let filtro = '';
  if (ROLES.includes(req.query.rol)) {
    params.push(req.query.rol);
    filtro = 'WHERE rol = $1';
  }
  const { rows } = await pool.query(
    `SELECT id, username, nombre, rol, activo, creado_en FROM users ${filtro} ORDER BY rol, username`,
    params,
  );
  res.json(rows);
});

router.post('/usuarios', authorize('usuario:crear'), async (req, res) => {
  const { username, nombre, password, rol } = req.body || {};
  const u = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!USERNAME_RE.test(u)) {
    return res.status(400).json({ error: 'El usuario debe tener 3-32 caracteres: minúsculas, números, punto o guion bajo' });
  }
  if (!ROLES.includes(rol)) return res.status(400).json({ error: `Rol inválido. Usa: ${ROLES.join(', ')}` });
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 100) {
    return res.status(400).json({ error: 'El nombre es obligatorio (máx. 100 caracteres)' });
  }
  const errPass = validarPolitica(password);
  if (errPass) return res.status(400).json({ error: errPass });

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (username, nombre, password_hash, rol)
       VALUES ($1, $2, $3, $4) RETURNING id, username, nombre, rol, activo, creado_en`,
      [u, nombre.trim(), await hashear(password), rol],
    );
    await audit(req, 'usuario:crear', { tipo: 'usuario', id: rows[0].id }, 'PERMITIDO', { username: u, rol });
    return res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ese nombre de usuario ya existe' });
    throw e;
  }
});

router.patch('/usuarios/:id', authorize('usuario:modificar'), async (req, res) => {
  const { id } = req.params;
  if (!esUuid(id)) return res.status(404).json({ error: 'No encontrado' });
  const { activo, rol, password } = req.body || {};
  const cambios = [];
  const params = [];
  const detalle = {};

  if (id === req.user.id && (activo === false || (rol && rol !== 'admin'))) {
    return res.status(400).json({ error: 'No puedes desactivarte ni quitarte el rol de admin a ti mismo' });
  }
  if (typeof activo === 'boolean') {
    params.push(activo);
    cambios.push(`activo = $${params.length}`);
    detalle.activo = activo;
  }
  if (rol !== undefined) {
    if (!ROLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    params.push(rol);
    cambios.push(`rol = $${params.length}`);
    detalle.rol = rol;
  }
  if (password !== undefined) {
    const errPass = validarPolitica(password);
    if (errPass) return res.status(400).json({ error: errPass });
    params.push(await hashear(password));
    cambios.push(`password_hash = $${params.length}`);
    detalle.password = 'cambiada';
  }
  if (!cambios.length) return res.status(400).json({ error: 'No hay cambios (activo, rol o password)' });

  params.push(id);
  const { rows } = await pool.query(
    `UPDATE users SET ${cambios.join(', ')} WHERE id = $${params.length}
     RETURNING id, username, nombre, rol, activo`,
    params,
  );
  if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });
  await audit(req, 'usuario:modificar', { tipo: 'usuario', id }, 'PERMITIDO', { username: rows[0].username, ...detalle });
  return res.json(rows[0]);
});

// ---------- Cursos y matrículas ----------

router.post('/cursos', authorize('curso:crear'), async (req, res) => {
  const { codigo, nombre, docente } = req.body || {};
  const cod = typeof codigo === 'string' ? codigo.trim().toUpperCase() : '';
  if (!/^[A-Z0-9-]{2,20}$/.test(cod)) return res.status(400).json({ error: 'Código inválido (ej. SO-101)' });
  if (typeof nombre !== 'string' || !nombre.trim() || nombre.length > 120) {
    return res.status(400).json({ error: 'Nombre del curso obligatorio' });
  }
  // "docente" puede ser el username o el id
  const { rows: doc } = await pool.query(
    `SELECT id, username FROM users WHERE (username = $1 OR id::text = $1) AND rol = 'docente' AND activo`,
    [String(docente || '').trim().toLowerCase()],
  );
  if (!doc[0]) return res.status(400).json({ error: 'El docente no existe o no tiene rol docente' });

  try {
    const { rows } = await pool.query(
      'INSERT INTO courses (codigo, nombre, docente_id) VALUES ($1, $2, $3) RETURNING *',
      [cod, nombre.trim(), doc[0].id],
    );
    await audit(req, 'curso:crear', { tipo: 'curso', id: rows[0].id }, 'PERMITIDO', { codigo: cod, docente: doc[0].username });
    return res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ya existe un curso con ese código' });
    throw e;
  }
});

router.post('/cursos/:id/matriculas', authorize('curso:matricular'), async (req, res) => {
  const curso = await cargarCurso(req.params.id);
  if (!curso) return noEncontrado(req, res, 'curso:matricular', { tipo: 'curso', id: req.params.id }, 'curso_inexistente');
  const est = String((req.body || {}).estudiante || '').trim().toLowerCase();
  const { rows } = await pool.query(
    `SELECT id, username FROM users WHERE (username = $1 OR id::text = $1) AND rol = 'estudiante' AND activo`,
    [est],
  );
  if (!rows[0]) return res.status(400).json({ error: 'El estudiante no existe o no tiene rol estudiante' });
  await pool.query(
    'INSERT INTO enrollments (course_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [curso.id, rows[0].id],
  );
  await audit(req, 'curso:matricular', { tipo: 'curso', id: curso.id }, 'PERMITIDO',
    { codigo: curso.codigo, estudiante: rows[0].username, student_id: rows[0].id });
  return res.status(201).json({ ok: true, curso: curso.codigo, estudiante: rows[0].username });
});

router.delete('/cursos/:id/matriculas/:studentId', authorize('curso:matricular'), async (req, res) => {
  if (!esUuid(req.params.id) || !esUuid(req.params.studentId)) return res.status(404).json({ error: 'No encontrado' });
  const { rowCount } = await pool.query(
    'DELETE FROM enrollments WHERE course_id = $1 AND student_id = $2',
    [req.params.id, req.params.studentId],
  );
  if (!rowCount) return res.status(404).json({ error: 'No encontrado' });
  await audit(req, 'curso:desmatricular', { tipo: 'curso', id: req.params.id }, 'PERMITIDO', { student_id: req.params.studentId });
  return res.json({ ok: true });
});

// ---------- Auditoría ----------

router.get('/auditoria', authorize('auditoria:ver'), async (req, res) => {
  const cond = [];
  const params = [];
  const add = (sql, v) => { params.push(v); cond.push(sql.replace('?', `$${params.length}`)); };
  if (['PERMITIDO', 'DENEGADO', 'ERROR'].includes(req.query.resultado)) add('resultado = ?', req.query.resultado);
  if (typeof req.query.usuario === 'string' && req.query.usuario) add('username = ?', req.query.usuario);
  if (typeof req.query.accion === 'string' && req.query.accion) add('accion = ?', req.query.accion);
  if (typeof req.query.recurso === 'string' && req.query.recurso) add('recurso_id = ?', req.query.recurso);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 100, 1), 1000);
  params.push(limit);
  const { rows } = await pool.query(
    `SELECT id, ts, username, rol, accion, recurso_tipo, recurso_id, resultado, ip, detalle
       FROM audit_log ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''}
      ORDER BY ts DESC, id DESC LIMIT $${params.length}`,
    params,
  );
  res.json(rows);
});

// Reporte de accesos denegados agrupados por usuario (detecta a quien prueba IDs ajenos).
router.get('/auditoria/denegados', authorize('auditoria:ver'), async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT COALESCE(username, '(desconocido)') AS username, rol,
            count(*)::int AS intentos,
            count(DISTINCT recurso_id)::int AS recursos_distintos,
            array_agg(DISTINCT accion) AS acciones,
            array_agg(DISTINCT detalle->>'motivo') AS motivos,
            min(ts) AS primero, max(ts) AS ultimo
       FROM audit_log
      WHERE resultado = 'DENEGADO'
      GROUP BY username, rol
      ORDER BY intentos DESC`,
  );
  res.json(rows);
});

// ---------- Estado de servicios y de la cola ----------

router.get('/estado', authorize('sistema:estado'), async (_req, res) => {
  const [porEstado, tiempos, ultimoError, pendiente, auditoria] = await Promise.all([
    pool.query('SELECT estado, count(*)::int AS n FROM jobs GROUP BY estado'),
    pool.query(`SELECT round(avg(ms))::int AS ms_promedio, max(ms) AS ms_max, count(*)::int AS completados,
                       max(terminado_en) AS ultimo_completado
                  FROM jobs WHERE estado = 'completado'`),
    pool.query(`SELECT j.error, j.terminado_en, j.submission_id
                  FROM jobs j WHERE estado = 'fallido' ORDER BY terminado_en DESC NULLS LAST LIMIT 1`),
    pool.query(`SELECT EXTRACT(EPOCH FROM (now() - min(creado_en)))::int AS seg
                  FROM jobs WHERE estado = 'pendiente'`),
    pool.query(`SELECT count(*)::int AS total,
                       count(*) FILTER (WHERE resultado = 'DENEGADO' AND ts > now() - interval '24 hours')::int AS denegados_24h
                  FROM audit_log`),
  ]);
  const cola = { pendiente: 0, en_ejecucion: 0, completado: 0, fallido: 0 };
  porEstado.rows.forEach((r) => { cola[r.estado] = r.n; });

  let disco = null;
  try {
    const s = fs.statfsSync(config.dataDir);
    disco = {
      total_mb: Math.round((s.blocks * s.bsize) / 1048576),
      libre_mb: Math.round((s.bavail * s.bsize) / 1048576),
    };
  } catch { /* sin datos de disco */ }

  const pendienteSeg = pendiente.rows[0].seg;
  res.json({
    servicios: {
      api: 'ok',
      db: 'ok',
      // si hay trabajos esperando más de 60 s, probablemente el worker está caído
      worker: pendienteSeg !== null && pendienteSeg > 60 ? 'posiblemente_detenido' : 'ok',
    },
    cola,
    pendiente_mas_antiguo_seg: pendienteSeg,
    procesamiento: tiempos.rows[0],
    ultimo_error: ultimoError.rows[0] || null,
    auditoria: auditoria.rows[0],
    disco_datos: disco,
    memoria_api_mb: Math.round(process.memoryUsage().rss / 1048576),
    uptime_api_seg: Math.round(process.uptime()),
  });
});

module.exports = router;
