#!/usr/bin/env bash
# =====================================================================
# Prueba de RECUPERACIÓN del worker (Reto 5), en tres escenarios:
#   A. Worker detenido: los trabajos esperan en "pendiente" y se procesan al volver.
#   B. Apagado ordenado (docker compose stop) a mitad de un trabajo:
#      el worker devuelve a la cola lo que no terminó.
#   C. Caída brusca (kill -9): el trabajo queda "en_ejecucion" y el
#      mecanismo de recuperación lo devuelve a la cola.
# Uso:  ./scripts/prueba_recuperacion.sh
# =====================================================================
set -uo pipefail
source "$(dirname "$0")/lib.sh"
evidencia recuperacion
DS="$RAIZ/dataset"
[[ -f "$DS/informe_laboratorio.md" ]] || ./scripts/generar_dataset.sh >/dev/null

login est_carla >/dev/null
pedir est_carla GET /api/cursos >/dev/null
CURSO="$(buscar_id codigo SO-101)"
pedir est_carla GET "/api/cursos/$CURSO/actividades" >/dev/null
ACT="$(buscar_id titulo 'Informe de laboratorio 1')"

estado_de() { pedir est_carla GET "/api/entregas/$1" >/dev/null; json trabajo.estado; }
worker_con() { # worker_con VAR=valor ...  -> recrea el worker con esas variables
  env "$@" $DC up -d --no-deps worker >/dev/null 2>&1
  local ctr; ctr="$($DC ps -q worker)"
  for _ in $(seq 1 30); do [[ "$($DOCKER inspect -f '{{.State.Health.Status}}' "$ctr")" == healthy ]] && return; sleep 2; done
}

titulo "A. Worker detenido: los trabajos esperan y se procesan al volver"
$DC stop worker 2>&1 | tail -1
IDS=()
for f in informe_laboratorio.md algoritmo_ordenamiento.txt metadatos_entrega.json; do
  comprobar 201 "$(subir est_carla "/api/actividades/$ACT/entregas" "$DS/$f")" "subir $f con el worker apagado"
  IDS+=("$(json id)")
done
sleep 2
for id in "${IDS[@]}"; do verificar '[[ "$(estado_de "$id")" == pendiente ]]' "entrega ${id:0:8}… sigue en 'pendiente'"; done
$DC start worker 2>&1 | tail -1
for id in "${IDS[@]}"; do esperar_trabajo est_carla "$id" 60 >/dev/null; verificar '[[ "$ESTADO" == completado ]]' "entrega ${id:0:8}… 'completado' al volver el worker"; done

titulo "B. Apagado ordenado a mitad de un trabajo (cada trabajo tarda 20 s a propósito)"
worker_con WORKER_DEMORA_MS=20000
comprobar 201 "$(subir est_carla "/api/actividades/$ACT/entregas" "$DS/informe_laboratorio.md")" "subir entrega"
ID="$(json id)"
for _ in $(seq 1 20); do [[ "$(estado_de "$ID")" == en_ejecucion ]] && break; sleep 0.5; done
echo "          estado antes de parar: $(estado_de "$ID")"
$DC stop worker 2>&1 | tail -1
verificar '[[ "$(estado_de "$ID")" == pendiente ]]' "tras 'docker compose stop' el trabajo volvió a 'pendiente'"
$DC logs --since 30s worker 2>/dev/null | grep -E 'apagando|devueltos' | sed 's/^/          /' | cut -c1-160

titulo "C. Caída brusca (kill -9) a mitad de un trabajo"
worker_con WORKER_DEMORA_MS=20000 RECUPERAR_TRAS_SEG=10
for _ in $(seq 1 30); do [[ "$(estado_de "$ID")" == en_ejecucion ]] && break; sleep 0.5; done
echo "          estado antes del kill: $(estado_de "$ID")"
$DC kill -s SIGKILL worker 2>&1 | tail -1
sleep 1
verificar '[[ "$(estado_de "$ID")" == en_ejecucion ]]' "tras el kill -9 el trabajo quedó colgado en 'en_ejecucion'"
echo "          reiniciando el worker (sin demora; umbral de recuperación 10 s)…"
worker_con RECUPERAR_TRAS_SEG=10
esperar_trabajo est_carla "$ID" 60
verificar '[[ "$ESTADO" == completado ]]' "el trabajo colgado se recuperó y terminó 'completado'"
$DC logs --since 90s worker 2>/dev/null | grep -E 'colgado recuperado' | sed 's/^/          /' | cut -c1-160

titulo "Restaurando el worker con la configuración del .env"
$DC up -d --no-deps worker 2>&1 | tail -1
resumen
