#!/usr/bin/env bash
# =====================================================================
# Despliegue / actualización en la EC2.
#   sudo ./scripts/deploy.sh
# Trae la última versión de GitHub (si es un clon de git), reconstruye las
# imágenes EN LA PROPIA EC2 (sin ECR) y espera a que todo esté sano.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo: sudo $0"; exit 1; }
[[ -f .env ]] || { echo "Falta .env. Créalo con:  sudo ./scripts/generar_env.sh"; exit 1; }

DEPLOY_KEY="${DEPLOY_KEY:-/home/ubuntu/.ssh/entregasegura_deploy}"
if [[ -d .git ]]; then
  echo "[1] Actualizando el código desde GitHub"
  if [[ -f "$DEPLOY_KEY" ]]; then export GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes"; fi
  git -c safe.directory="$PWD" pull --ff-only
fi

echo "[2] Permisos"
if id entregas >/dev/null 2>&1; then chown -R entregas:entregas .; fi
chmod 600 .env
chmod -R o+rX db/migrations

[[ -f dataset/ensayo_largo.txt ]] || { echo "[*] Generando dataset"; python3 scripts/generar_dataset.py dataset >/dev/null; }

echo "[3] Construyendo y levantando contenedores"
docker compose up -d --build

echo "[4] Esperando a que los 4 servicios estén healthy"
for _ in $(seq 1 60); do
  N="$(docker compose ps --format '{{.Health}}' | grep -c '^healthy$' || true)"
  [[ "$N" == 4 ]] && break; sleep 3
done
docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
curl -fsS "http://localhost:$(grep -E '^HTTP_PORT=' .env | cut -d= -f2 | tr -d ' ' || echo 80)/api/health" && echo
docker image prune -f >/dev/null   # libera disco: borra capas viejas sin uso
df -h / | tail -1 | awk '{print "Disco: " $3 " usados de " $2 " (" $5 ")"}'
