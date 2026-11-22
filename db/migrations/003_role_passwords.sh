#!/bin/sh
# Activa el inicio de sesión de los roles de la aplicación con las
# contraseñas del .env. Se hace en un .sh (y no en .sql) porque un .sql
# no puede leer variables de entorno, y las contraseñas NO van en el código.
set -eu

: "${APP_API_DB_PASSWORD:?Falta APP_API_DB_PASSWORD}"
: "${APP_WORKER_DB_PASSWORD:?Falta APP_WORKER_DB_PASSWORD}"

psql -v ON_ERROR_STOP=1 \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
     -v api_pw="$APP_API_DB_PASSWORD" \
     -v worker_pw="$APP_WORKER_DB_PASSWORD" <<'EOSQL'
ALTER ROLE app_api    WITH LOGIN PASSWORD :'api_pw'    CONNECTION LIMIT 20;
ALTER ROLE app_worker WITH LOGIN PASSWORD :'worker_pw' CONNECTION LIMIT 10;
EOSQL

echo "Roles app_api y app_worker listos."
