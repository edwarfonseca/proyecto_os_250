#!/usr/bin/env bash
# =====================================================================
# Copia a este PC las evidencias generadas en la EC2 (docs/evidencias/),
# a través de Systems Manager (no hay SSH). Solo trae las que faltan.
#   infra/traer_evidencias.sh
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
DESTINO="docs/evidencias"
mkdir -p "$DESTINO"

LISTA="$(./infra/ssm_ejecutar.sh 'ls -1 /opt/entregasegura/docs/evidencias/' 120 | grep -E '\.txt$' || true)"
[[ -n "$LISTA" ]] || { echo "No hay evidencias en el servidor."; exit 0; }

N=0
while IFS= read -r f; do
  [[ "$f" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "Nombre raro, se omite: $f"; continue; }
  if [[ -e "$DESTINO/$f" ]]; then continue; fi
  # Viaja en base64 para que los bytes lleguen exactos (tildes, emojis...).
  ./infra/ssm_ejecutar.sh "base64 -w0 /opt/entregasegura/docs/evidencias/$f" 120 \
    | head -1 | base64 -d > "$DESTINO/$f"
  echo "  traída: $f ($(wc -c < "$DESTINO/$f") bytes)"
  N=$((N + 1))
done <<< "$LISTA"
echo "Evidencias nuevas: $N (en $DESTINO/)"
