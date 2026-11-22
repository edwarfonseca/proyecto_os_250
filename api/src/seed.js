'use strict';
// Datos iniciales. Las contraseñas salen del .env (ADMIN_PASSWORD y
// DEMO_PASSWORD); nunca están escritas en el código.
//   - Siempre: el usuario "admin" si no existe.
//   - Con SEED_DEMO=true: 2 docentes, 4 estudiantes, 2 cursos, 2 actividades.
// Es idempotente: se puede ejecutar varias veces sin duplicar nada.
const config = require('./config');
const { pool } = require('./db');
const { hashear } = require('./passwords');
const log = require('./logger');

async function asegurarUsuario(username, nombre, rol, password) {
  const r = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
  if (r.rows[0]) return r.rows[0].id;
  const ins = await pool.query(
    `INSERT INTO users (username, nombre, password_hash, rol) VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username RETURNING id`,
    [username, nombre, await hashear(password), rol],
  );
  log.info({ username, rol }, 'usuario sembrado');
  return ins.rows[0].id;
}

async function asegurarCurso(codigo, nombre, docenteId) {
  const r = await pool.query(
    `INSERT INTO courses (codigo, nombre, docente_id) VALUES ($1, $2, $3)
     ON CONFLICT (codigo) DO UPDATE SET codigo = EXCLUDED.codigo RETURNING id`,
    [codigo, nombre, docenteId],
  );
  return r.rows[0].id;
}

async function sembrar() {
  if (config.adminPassword.length >= 10) {
    await asegurarUsuario('admin', 'Administrador TI', 'admin', config.adminPassword);
  } else {
    log.warn('ADMIN_PASSWORD no definida o con menos de 10 caracteres: no se crea el admin');
  }
  if (!config.seedDemo) return;
  if (config.demoPassword.length < 10) {
    log.warn('DEMO_PASSWORD no definida o corta: no se crean datos demo');
    return;
  }
  const p = config.demoPassword;
  const ramirez = await asegurarUsuario('doc_ramirez', 'Laura Ramírez', 'docente', p);
  const torres = await asegurarUsuario('doc_torres', 'Andrés Torres', 'docente', p);
  const ana = await asegurarUsuario('est_ana', 'Ana Gómez', 'estudiante', p);
  const bruno = await asegurarUsuario('est_bruno', 'Bruno Díaz', 'estudiante', p);
  const carla = await asegurarUsuario('est_carla', 'Carla Rojas', 'estudiante', p);
  const diego = await asegurarUsuario('est_diego', 'Diego Pérez', 'estudiante', p);

  const so = await asegurarCurso('SO-101', 'Sistemas Operativos', ramirez);
  const bd = await asegurarCurso('BD-201', 'Bases de Datos', torres);

  // SO-101: Ana, Bruno y Carla · BD-201: Carla y Diego
  const matriculas = [[so, ana], [so, bruno], [so, carla], [bd, carla], [bd, diego]];
  for (const [c, s] of matriculas) {
    await pool.query('INSERT INTO enrollments (course_id, student_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [c, s]);
  }

  const actividades = [
    [so, 'Informe de laboratorio 1', 'Informe del laboratorio de procesos e hilos (.md o .txt).', ramirez],
    [bd, 'Modelo relacional', 'Entrega el script o el CSV de tu modelo de datos.', torres],
  ];
  for (const [c, titulo, desc, doc] of actividades) {
    await pool.query(
      `INSERT INTO assignments (course_id, titulo, descripcion, fecha_limite, creado_por)
       VALUES ($1, $2, $3, now() + interval '30 days', $4) ON CONFLICT (course_id, titulo) DO NOTHING`,
      [c, titulo, desc, doc],
    );
  }
  log.info('datos demo listos');
}

module.exports = { sembrar };

// Permite ejecutarlo a mano:  docker compose exec api node src/seed.js
if (require.main === module) {
  sembrar()
    .then(() => pool.end())
    .catch((e) => { log.error(e); process.exit(1); });
}
