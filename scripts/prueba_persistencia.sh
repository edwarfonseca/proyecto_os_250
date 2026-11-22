#!/usr/bin/env bash
# =====================================================================
# Prueba de PERSISTENCIA: "docker compose down" (SIN -v) y "up -d".
# Los contenedores se destruyen y se crean de nuevo, pero los volúmenes
# pgdata y files sobreviven: usuarios, entregas, resultados y auditoría
# siguen ahí.
# Uso:  ./scripts/prueba_persistencia.sh
# =====================================================================
set -uo pipefail
source "$(dirname "$0")/lib.sh"
evidencia persistencia
DBNAME="$(leer_env POSTGRES_DB)"

conteo() {
  $DC exec -T db psql -U postgres -d "$DBNAME" -At -c \
    "SELECT (SELECT count(*) FROM users)||' usuarios, '||(SELECT count(*) FROM submissions)||' entregas, '||
            (SELECT count(*) FROM jobs WHERE estado='completado')||' completadas, '||(SELECT count(*) FROM audit_log)||' eventos de auditoría'"
}

titulo "Antes"
login est_ana >/dev/null
pedir est_ana GET /api/entregas >/dev/null
ID="$(python3 -c 'import json,sys; d=[x for x in json.load(open(sys.argv[1])) if x["estado"]=="completado"]; print(d[0]["id"] if d else "")' "$TMPD/out")"
pedir est_ana GET "/api/entregas/$ID/resultado" >/dev/null; SHA_ANTES="$(json sha256)"
echo "          entrega de referencia: $ID (sha256 ${SHA_ANTES:0:16}…)"
ANTES="$(conteo)"; echo "          $ANTES"
$DOCKER volume ls --filter name=entregasegura --format '          volumen: {{.Name}}'

titulo "docker compose down  (sin -v: se borran contenedores y redes, NO volúmenes)"
$DC down 2>&1 | tail -4 | sed 's/^/          /'
$DC ps -a --format '{{.Name}}' | grep -q . && echo "          quedan contenedores" || echo "          no queda ningún contenedor"

titulo "docker compose up -d"
$DC up -d 2>&1 | tail -2 | sed 's/^/          /'
for _ in $(seq 1 60); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/health")" == 200 ]] && break; sleep 2
done

titulo "Después"
DESPUES="$(conteo)"; echo "          $DESPUES"
verificar '[[ "$ANTES" == "$DESPUES" ]]' "mismos usuarios, entregas, resultados y auditoría"
comprobar 200 "$(login est_ana)" "el usuario sigue pudiendo iniciar sesión"
comprobar 200 "$(pedir est_ana GET "/api/entregas/$ID/resultado")" "el resultado anterior sigue disponible"
verificar '[[ "$(json sha256)" == "$SHA_ANTES" ]]' "con el mismo SHA-256"

resumen
