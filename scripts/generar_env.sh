#!/usr/bin/env bash
# Crea el archivo .env a partir de .env.example con contraseñas aleatorias.
# Uso:  ./scripts/generar_env.sh
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  echo "Ya existe un .env; no se modifica. Si de verdad quieres uno nuevo, renombra el actual primero."
  exit 1
fi

aleatorio() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c "$1" || true; }

umask 077
while IFS= read -r linea; do
  case "$linea" in
    POSTGRES_PASSWORD=*)      echo "POSTGRES_PASSWORD=$(aleatorio 32)" ;;
    APP_API_DB_PASSWORD=*)    echo "APP_API_DB_PASSWORD=$(aleatorio 32)" ;;
    APP_WORKER_DB_PASSWORD=*) echo "APP_WORKER_DB_PASSWORD=$(aleatorio 32)" ;;
    JWT_SECRET=*)             echo "JWT_SECRET=$(aleatorio 64)" ;;
    ADMIN_PASSWORD=*)         echo "ADMIN_PASSWORD=$(aleatorio 16)" ;;
    DEMO_PASSWORD=*)          echo "DEMO_PASSWORD=$(aleatorio 14)" ;;
    *)                        echo "$linea" ;;
  esac
done < .env.example > .env
chmod 600 .env

echo ".env creado con permisos 600 (solo tu usuario puede leerlo)."
echo "Contraseñas para entrar a la aplicación:"
grep -E '^(ADMIN|DEMO)_PASSWORD=' .env
