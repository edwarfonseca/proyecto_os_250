'use strict';
// =====================================================================
// COLA DE TRABAJOS EN POSTGRESQL (decisión de arquitectura D1)
// ---------------------------------------------------------------------
// Reclamo atómico con FOR UPDATE SKIP LOCKED: si dos workers (o dos hilos
// de este worker) piden trabajo a la vez, cada uno se lleva una fila
// distinta; nunca procesan el mismo trabajo dos veces.
// =====================================================================

const SQL_RECLAMAR = `
  UPDATE jobs
     SET estado = 'en_ejecucion', iniciado_en = now(), intentos = intentos + 1
   WHERE id = (
     SELECT id FROM jobs
      WHERE estado = 'pendiente' AND disponible_en <= now()
      ORDER BY creado_en
      FOR UPDATE SKIP LOCKED
      LIMIT 1
   )
  RETURNING *`;

async function reclamar(pool) {
  const { rows } = await pool.query(SQL_RECLAMAR);
  return rows[0] || null;
}

// Marca como completado SOLO si el trabajo sigue siendo nuestro (si el
// estudiante reemplazó el archivo mientras tanto, el trabajo volvió a
// "pendiente" y este resultado ya no vale).
async function completar(client, job, rutaResultado, ms) {
  const r = await client.query(
    `UPDATE jobs SET estado = 'completado', terminado_en = now(), ruta_resultado = $2, ms = $3, error = NULL
      WHERE id = $1 AND estado = 'en_ejecucion' AND intentos = $4`,
    [job.id, rutaResultado, ms, job.intentos],
  );
  return r.rowCount === 1;
}

// Fallo: si quedan intentos y el error no es permanente, vuelve a la cola
// con espera exponencial (5 s, 10 s, 20 s...). Si no, queda "fallido".
async function fallar(pool, job, error, permanente) {
  const reintentar = !permanente && job.intentos < job.max_intentos;
  const esperaSeg = 5 * 2 ** (job.intentos - 1);
  await pool.query(
    `UPDATE jobs
        SET estado = $2, error = $3,
            disponible_en = now() + make_interval(secs => $4),
            terminado_en = CASE WHEN $2 = 'fallido' THEN now() ELSE NULL END
      WHERE id = $1 AND estado = 'en_ejecucion' AND intentos = $5`,
    [job.id, reintentar ? 'pendiente' : 'fallido', String(error).slice(0, 500), reintentar ? esperaSeg : 0, job.intentos],
  );
  return { reintentar, esperaSeg };
}

// Recuperación: trabajos que llevan demasiado tiempo "en_ejecucion" (el
// worker murió a mitad, p. ej. por un kill -9 o un corte de luz).
async function recuperarColgados(pool, segundos) {
  const { rows } = await pool.query(
    `UPDATE jobs
        SET estado = CASE WHEN intentos >= max_intentos THEN 'fallido' ELSE 'pendiente' END,
            error  = CASE WHEN intentos >= max_intentos
                          THEN 'Agotó los intentos: el worker se detuvo durante el procesamiento'
                          ELSE 'Recuperado tras quedar colgado en ejecución' END,
            terminado_en = CASE WHEN intentos >= max_intentos THEN now() ELSE NULL END,
            disponible_en = now()
      WHERE estado = 'en_ejecucion' AND iniciado_en < now() - make_interval(secs => $1)
      RETURNING id, submission_id, estado`,
    [segundos],
  );
  return rows;
}

// Al apagar con orden (SIGTERM), devolvemos a la cola lo que no terminó.
async function devolverACola(pool, jobIds) {
  if (!jobIds.length) return 0;
  const r = await pool.query(
    `UPDATE jobs SET estado = 'pendiente', intentos = GREATEST(intentos - 1, 0), iniciado_en = NULL
      WHERE id = ANY($1::uuid[]) AND estado = 'en_ejecucion'`,
    [jobIds],
  );
  return r.rowCount;
}

module.exports = { reclamar, completar, fallar, recuperarColgados, devolverACola };
