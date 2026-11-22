-- =====================================================================
-- EntregaSegura · Roles de base de datos con mínimo privilegio (D5)
--   app_api    -> lo usa el contenedor "api"
--   app_worker -> lo usa el contenedor "worker"
--   postgres   -> solo para estas migraciones; la aplicación NUNCA lo usa
-- Las contraseñas se ponen en 003_role_passwords.sh (salen del .env).
-- =====================================================================

CREATE ROLE app_api    NOLOGIN;
CREATE ROLE app_worker NOLOGIN;

-- Nadie entra a la base ni al esquema salvo quien se autorice explícitamente.
DO $$ BEGIN
  EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_api, app_worker', current_database());
END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO app_api, app_worker;

-- ---------- app_api ----------
GRANT SELECT, INSERT, UPDATE, DELETE
  ON users, courses, enrollments, assignments, extensions, submissions, jobs
  TO app_api;

-- Auditoría: solo insertar y leer. Sin UPDATE ni DELETE: ni la propia
-- aplicación puede borrar su rastro.
GRANT SELECT, INSERT ON audit_log TO app_api;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO app_api;

-- ---------- app_worker ----------
-- Lee y actualiza la cola.
GRANT SELECT, UPDATE ON jobs TO app_worker;
-- De las entregas solo puede leer y escribir UNA columna: la huella sha256.
GRANT SELECT ON submissions TO app_worker;
GRANT UPDATE (sha256) ON submissions TO app_worker;
-- Auditoría: solo insertar (ni siquiera leer).
GRANT INSERT ON audit_log TO app_worker;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO app_worker;

-- Explícito, para que se vea en la sustentación:
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM app_api, app_worker;
