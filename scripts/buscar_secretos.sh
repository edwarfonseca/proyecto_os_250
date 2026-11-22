#!/usr/bin/env bash
# =====================================================================
# Checklist 14 · ¿Hay secretos en el repositorio? Revisa TODO el historial
# de git (todas las ramas y commits), no solo los archivos actuales:
#   1. ¿Se versionó alguna vez un .env, .pem o .key?
#   2. ¿Aparece en algún commit alguno de los valores REALES del .env?
#   3. ¿Hay alguna llave privada?
# Uso:  ./scripts/buscar_secretos.sh
# =====================================================================
set -uo pipefail
cd "$(dirname "$0")/.."
G=(git -c safe.directory="$PWD")
FALLOS=0

echo "1. Archivos sensibles versionados alguna vez:"
if "${G[@]}" log --all --name-only --format= | grep -E '(^|/)\.env$|(^|/)\.env\.[^e]|\.pem$|\.key$|\.p12$' | sort -u | grep .; then
  FALLOS=$((FALLOS + 1))
else
  echo "   ninguno ✔"
fi

echo "2. Valores reales del .env dentro del historial:"
if [[ -r .env ]]; then
  VALORES="$(grep -E '^[A-Z_]*(PASSWORD|SECRET)=' .env | cut -d= -f2- | sed 's/[[:space:]]*#.*$//' | grep -E '.{8,}')"
  if [[ -n "$VALORES" ]] && "${G[@]}" log --all -p | grep -qF -f <(printf '%s\n' "$VALORES"); then
    echo "   ¡ALERTA! Algún valor del .env está en un commit. Cambia esas contraseñas."; FALLOS=$((FALLOS + 1))
  else
    echo "   ninguno de los $(printf '%s\n' "$VALORES" | grep -c .) valores aparece ✔"
  fi
else
  echo "   (no hay .env legible para comparar; en la EC2 usa sudo)"
fi

echo "3. Llaves privadas en el historial:"
if "${G[@]}" log --all -p | grep -q 'BEGIN [A-Z ]*PRIVATE KEY'; then
  echo "   ¡ALERTA! Hay una llave privada en algún commit."; FALLOS=$((FALLOS + 1))
else
  echo "   ninguna ✔"
fi

echo "Commits revisados: $("${G[@]}" rev-list --all --count 2>/dev/null || echo 0)"
[[ "$FALLOS" -eq 0 ]] && echo "RESULTADO: OK, sin secretos versionados." || echo "RESULTADO: revisar los puntos marcados."
[[ "$FALLOS" -eq 0 ]]
