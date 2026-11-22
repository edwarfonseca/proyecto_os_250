-- =====================================================================
-- EntregaSegura · Esquema de base de datos
-- Lo ejecuta PostgreSQL automáticamente la PRIMERA vez que arranca con
-- el volumen "pgdata" vacío (docker-entrypoint-initdb.d).
-- =====================================================================

-- ---------- Usuarios ----------
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username      TEXT NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_.]{3,32}$'),
  nombre        TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 100),
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL CHECK (rol IN ('admin', 'docente', 'estudiante')),
  activo        BOOLEAN NOT NULL DEFAULT true,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Cursos y matrículas ----------
CREATE TABLE courses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo     TEXT NOT NULL UNIQUE CHECK (codigo ~ '^[A-Z0-9-]{2,20}$'),
  nombre     TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 120),
  docente_id UUID NOT NULL REFERENCES users(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrollments (
  course_id  UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id),
  creado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (course_id, student_id)
);

-- ---------- Actividades y prórrogas (regla RN-1) ----------
CREATE TABLE assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id    UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  titulo       TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 120),
  descripcion  TEXT NOT NULL DEFAULT '' CHECK (length(descripcion) <= 2000),
  fecha_limite TIMESTAMPTZ NOT NULL,
  creado_por   UUID NOT NULL REFERENCES users(id),
  creado_en    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (course_id, titulo)
);

-- Una prórroga individual por estudiante y actividad (si se da otra, se
-- reemplaza; el historial completo queda en audit_log).
CREATE TABLE extensions (
  assignment_id      UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id         UUID NOT NULL REFERENCES users(id),
  nueva_fecha_limite TIMESTAMPTZ NOT NULL,
  otorgada_por       UUID NOT NULL REFERENCES users(id),
  creado_en          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, student_id)
);

-- ---------- Entregas ----------
-- "ruta" es un nombre generado por el servidor (UUID); el nombre que puso el
-- estudiante se guarda solo aquí, nunca se usa como ruta (evita path traversal).
CREATE TABLE submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id      UUID NOT NULL REFERENCES users(id),
  nombre_original TEXT NOT NULL CHECK (length(nombre_original) BETWEEN 1 AND 255),
  ruta            TEXT NOT NULL UNIQUE,
  tamano          INTEGER NOT NULL CHECK (tamano >= 0 AND tamano <= 5242880),
  mime            TEXT NOT NULL,
  sha256          CHAR(64),             -- lo calcula el worker
  creado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Cola de trabajos (decisión D1: la cola ES una tabla) ----------
CREATE TABLE jobs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id  UUID NOT NULL UNIQUE REFERENCES submissions(id) ON DELETE CASCADE,
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente', 'en_ejecucion', 'completado', 'fallido')),
  intentos       INTEGER NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  max_intentos   INTEGER NOT NULL DEFAULT 3 CHECK (max_intentos > 0),
  error          TEXT,
  ruta_resultado TEXT,
  ms             INTEGER,               -- duración del procesamiento
  disponible_en  TIMESTAMPTZ NOT NULL DEFAULT now(),  -- para el backoff
  creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
  iniciado_en    TIMESTAMPTZ,
  terminado_en   TIMESTAMPTZ
);

-- ---------- Auditoría (append-only) ----------
CREATE TABLE audit_log (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id      UUID,                    -- sin FK: el rastro sobrevive al usuario
  username     TEXT,
  rol          TEXT,
  accion       TEXT NOT NULL,
  recurso_tipo TEXT,
  recurso_id   TEXT,
  resultado    TEXT NOT NULL CHECK (resultado IN ('PERMITIDO', 'DENEGADO', 'ERROR')),
  ip           TEXT,
  detalle      JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Segunda barrera (además de los GRANT de 002): un trigger que impide
-- modificar o borrar filas de auditoría, incluso al dueño de la tabla.
CREATE FUNCTION audit_log_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es de solo inserción: % no permitido', TG_OP;
END;
$$;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_inmutable();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_inmutable();

-- ---------- Índices ----------
CREATE INDEX jobs_cola_idx          ON jobs (estado, disponible_en, creado_en);
CREATE INDEX submissions_dup_idx    ON submissions (assignment_id, sha256);
CREATE INDEX submissions_student_idx ON submissions (student_id);
CREATE INDEX audit_user_ts_idx      ON audit_log (user_id, ts);
CREATE INDEX audit_recurso_idx      ON audit_log (recurso_tipo, recurso_id);
CREATE INDEX audit_resultado_idx    ON audit_log (resultado, ts);
CREATE INDEX enrollments_student_idx ON enrollments (student_id);
