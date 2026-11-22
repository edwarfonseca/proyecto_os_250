'use strict';
// =====================================================================
// WORKER de EntregaSegura
//   - Despierta con LISTEN/NOTIFY (aviso inmediato de la API) y, por si
//     se pierde un aviso, revisa la cola cada 3 s (sondeo de respaldo).
//   - Procesa WORKER_CONCURRENCY trabajos a la vez (por defecto 1).
//   - Recupera trabajos colgados al arrancar y cada minuto.
//   - Apagado ordenado: con SIGTERM termina lo que tiene o lo devuelve a la cola.
// =====================================================================
const fs = require('node:fs');
const path = require('node:path');
const { Pool, Client } = require('pg');
const pino = require('pino');
const { reclamar, completar, fallar, recuperarColgados, devolverACola } = require('./queue');
const { analizar, ErrorPermanente } = require('./processors/analizar');

const log = pino({ level: process.env.LOG_LEVEL || 'info', base: { svc: 'worker' } });

const entero = (v, def, min, max) => {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : Math.min(Math.max(n, min), max);
};
const DATA = path.resolve(process.env.DATA_DIR || '/data');
const CONCURRENCIA = entero(process.env.WORKER_CONCURRENCY, 1, 1, 8);
const SONDEO_MS = 3000;
const RECUPERAR_TRAS_SEG = entero(process.env.RECUPERAR_TRAS_SEG, 300, 10, 86400);
const DEMORA_MS = entero(process.env.WORKER_DEMORA_MS, 0, 0, 60000); // solo para demos
const HEARTBEAT = '/tmp/heartbeat';

for (const v of ['DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[v]) { log.fatal(`Falta la variable de entorno ${v}`); process.exit(1); }
}
const dbConf = {
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
};
const pool = new Pool({ ...dbConf, max: CONCURRENCIA + 2, connectionTimeoutMillis: 5000 });
pool.on('error', (e) => log.error({ err: e.message }, 'error en el pool de PostgreSQL'));

let apagando = false;
let listener = null;
const enCurso = new Set();
const despertadores = new Set();

// Espera ms milisegundos o hasta que llegue un NOTIFY.
function dormir(ms) {
  return new Promise((resolve) => {
    const fin = () => { clearTimeout(t); despertadores.delete(fin); resolve(); };
    const t = setTimeout(fin, ms);
    despertadores.add(fin);
  });
}
const despertarTodos = () => [...despertadores].forEach((f) => f());

async function auditar(accion, submissionId, resultado, detalle) {
  try {
    await pool.query(
      `INSERT INTO audit_log (username, rol, accion, recurso_tipo, recurso_id, resultado, detalle)
       VALUES ('worker', 'sistema', $1, 'entrega', $2, $3, $4)`,
      [accion, submissionId, resultado, detalle],
    );
  } catch (e) {
    log.error({ err: e.message, accion }, 'no se pudo escribir en audit_log');
  }
}

// Ruta absoluta verificando que quede dentro de /data/originales.
function rutaOriginal(relativa) {
  const abs = path.resolve(DATA, relativa);
  if (!abs.startsWith(path.join(DATA, 'originales') + path.sep)) {
    throw new ErrorPermanente('Ruta de archivo inválida');
  }
  return abs;
}

async function procesar(job) {
  const t0 = Date.now();
  enCurso.add(job.id);
  const ctx = { job_id: job.id, entrega_id: job.submission_id, intento: job.intentos };
  log.info({ ...ctx, estado: 'en_ejecucion' }, 'trabajo reclamado');
  try {
    const { rows } = await pool.query(
      'SELECT id, assignment_id, student_id, nombre_original, ruta FROM submissions WHERE id = $1',
      [job.submission_id],
    );
    const sub = rows[0];
    if (!sub) throw new ErrorPermanente('La entrega ya no existe');
    await auditar('trabajo:iniciado', sub.id, 'PERMITIDO', { job_id: job.id, intento: job.intentos });

    const buffer = await fs.promises.readFile(rutaOriginal(sub.ruta));
    if (DEMORA_MS) await new Promise((r) => setTimeout(r, DEMORA_MS));
    const analisis = analizar(buffer, sub.nombre_original);

    // Duplicados vistos en el momento del análisis (la API lo recalcula en vivo para el docente).
    const dup = await pool.query(
      'SELECT id FROM submissions WHERE assignment_id = $1 AND sha256 = $2 AND student_id <> $3',
      [sub.assignment_id, analisis.sha256, sub.student_id],
    );
    const ms = Date.now() - t0;
    const resultado = {
      entrega_id: sub.id,
      job_id: job.id,
      archivo: sub.nombre_original,
      ...analisis,
      posible_duplicado: dup.rowCount > 0,
      duplicado_con: dup.rows.map((r) => r.id),
      intento: job.intentos,
      procesado_en: new Date().toISOString(),
      tiempo_procesamiento_ms: ms,
    };

    // Escritura atómica: primero a .tmp y luego rename.
    const dir = path.join(DATA, 'resultados', sub.student_id);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o750 });
    const destino = path.join(dir, `${job.id}.json`);
    await fs.promises.writeFile(`${destino}.tmp`, JSON.stringify(resultado, null, 2), { mode: 0o640 });
    await fs.promises.rename(`${destino}.tmp`, destino);

    // Huella + estado en la misma transacción.
    const client = await pool.connect();
    let ok = false;
    try {
      await client.query('BEGIN');
      await client.query('UPDATE submissions SET sha256 = $2 WHERE id = $1', [sub.id, analisis.sha256]);
      ok = await completar(client, job, path.relative(DATA, destino), ms);
      await client.query(ok ? 'COMMIT' : 'ROLLBACK');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    if (!ok) {
      log.warn({ ...ctx }, 'resultado descartado: la entrega cambió mientras se procesaba');
      return;
    }
    log.info({ ...ctx, estado: 'completado', ms, bytes: buffer.length, duplicado: resultado.posible_duplicado }, 'trabajo completado');
    await auditar('trabajo:completado', sub.id, 'PERMITIDO',
      { job_id: job.id, ms, sha256: analisis.sha256, posible_duplicado: resultado.posible_duplicado });
  } catch (e) {
    const ms = Date.now() - t0;
    const { reintentar, esperaSeg } = await fallar(pool, job, e.message, Boolean(e.permanente));
    const estado = reintentar ? 'pendiente' : 'fallido';
    log[reintentar ? 'warn' : 'error']({ ...ctx, estado, ms, error: e.message, reintento_en_seg: reintentar ? esperaSeg : undefined },
      reintentar ? 'trabajo falló, se reintentará' : 'trabajo fallido');
    await auditar(reintentar ? 'trabajo:reintento' : 'trabajo:fallido', job.submission_id, 'ERROR',
      { job_id: job.id, intento: job.intentos, error: e.message, permanente: Boolean(e.permanente) });
  } finally {
    enCurso.delete(job.id);
  }
}

async function bucle(n) {
  log.info({ hilo: n }, 'bucle de trabajo iniciado');
  while (!apagando) {
    let job = null;
    try {
      job = await reclamar(pool);
    } catch (e) {
      log.error({ err: e.message }, 'no se pudo consultar la cola');
    }
    if (job) await procesar(job);
    else await dormir(SONDEO_MS);
  }
}

async function escuchar() {
  while (!apagando) {
    listener = new Client(dbConf);
    try {
      await listener.connect();
      listener.on('notification', despertarTodos);
      await listener.query('LISTEN nuevo_trabajo');
      log.info('escuchando avisos (LISTEN nuevo_trabajo)');
      await new Promise((resolve) => { listener.on('error', resolve); listener.on('end', resolve); });
    } catch (e) {
      if (!apagando) log.warn({ err: e.message }, 'sin conexión de avisos; se reintenta');
    }
    await listener.end().catch(() => {});
    if (!apagando) await new Promise((r) => setTimeout(r, 3000));
  }
}

async function recuperar() {
  try {
    const rec = await recuperarColgados(pool, RECUPERAR_TRAS_SEG);
    for (const r of rec) {
      log.warn({ job_id: r.id, estado: r.estado }, 'trabajo colgado recuperado');
      await auditar('trabajo:recuperado', r.submission_id, r.estado === 'fallido' ? 'ERROR' : 'PERMITIDO',
        { job_id: r.id, nuevo_estado: r.estado });
    }
    if (rec.length) despertarTodos();
  } catch (e) {
    log.error({ err: e.message }, 'fallo en la recuperación');
  }
}

async function latido() {
  try {
    await pool.query('SELECT 1');
    await fs.promises.writeFile(HEARTBEAT, String(Date.now()));
  } catch (e) {
    log.warn({ err: e.message }, 'latido sin base de datos');
  }
}

async function apagar(senal) {
  if (apagando) return;
  apagando = true;
  log.info({ senal, en_curso: enCurso.size }, 'apagando worker');
  despertarTodos();
  const limite = Date.now() + 8000;
  while (enCurso.size && Date.now() < limite) await new Promise((r) => setTimeout(r, 200));
  if (enCurso.size) {
    const n = await devolverACola(pool, [...enCurso]).catch(() => 0);
    log.warn({ devueltos: n }, 'trabajos sin terminar devueltos a la cola');
  }
  await listener?.end().catch(() => {});
  await pool.end().catch(() => {});
  process.exit(0);
}

async function main() {
  for (let i = 1; ; i += 1) {
    try { await pool.query('SELECT 1'); break; } catch (e) {
      if (i >= 30) throw e;
      log.warn({ intento: i }, 'esperando a la base de datos');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  log.info({ concurrencia: CONCURRENCIA, recuperar_tras_seg: RECUPERAR_TRAS_SEG, demora_ms: DEMORA_MS }, 'worker arrancando');
  await recuperar();
  await latido();
  setInterval(recuperar, Math.min(60, RECUPERAR_TRAS_SEG) * 1000).unref();
  setInterval(latido, 10000).unref();
  process.on('SIGTERM', () => apagar('SIGTERM'));
  process.on('SIGINT', () => apagar('SIGINT'));
  escuchar();
  await Promise.all(Array.from({ length: CONCURRENCIA }, (_, i) => bucle(i + 1)));
}

main().catch((e) => {
  log.fatal({ err: e.message }, 'el worker no pudo arrancar');
  process.exit(1);
});
