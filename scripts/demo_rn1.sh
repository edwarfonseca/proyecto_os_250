#!/usr/bin/env bash
# =====================================================================
# Demostración en vivo de la regla de negocio RN-1 (≈ 1,5 minutos)
#   1. El docente crea una actividad que cierra en 1 minuto
#   2. La estudiante sube dentro del plazo            -> 201
#   3. Se espera al cierre
#   4. La estudiante intenta subir                    -> 403 (DENEGADO)
#   5. El docente le da una prórroga individual
#   6. La estudiante vuelve a subir                   -> 201
#   7. Otro estudiante, sin prórroga, sigue bloqueado -> 403
#   8. La trazabilidad muestra todo
# Uso:  ./scripts/demo_rn1.sh           (CIERRE_SEG=30 ./scripts/demo_rn1.sh para ir más rápido)
# =====================================================================
set -uo pipefail
source "$(dirname "$0")/lib.sh"
evidencia demo_rn1
DS="$RAIZ/dataset"
CIERRE="${CIERRE_SEG:-60}"
[[ -f "$DS/informe_laboratorio.md" ]] || ./scripts/generar_dataset.sh >/dev/null

login doc_ramirez >/dev/null; login est_carla >/dev/null; login est_bruno >/dev/null; login admin >/dev/null
pedir doc_ramirez GET /api/cursos >/dev/null
CURSO="$(buscar_id codigo SO-101)"

titulo "1. El docente crea una actividad que cierra en $CIERRE s"
LIMITE="$(date -u -d "+$CIERRE seconds" +%Y-%m-%dT%H:%M:%SZ)"
comprobar 201 "$(pedir_json doc_ramirez POST "/api/cursos/$CURSO/actividades" "{\"titulo\":\"Demo RN-1 $(date +%H:%M:%S)\",\"fecha_limite\":\"$LIMITE\"}")" "crear actividad (cierra $LIMITE)"
ACT="$(json id)"

titulo "2. est_carla sube dentro del plazo"
comprobar 201 "$(subir est_carla "/api/actividades/$ACT/entregas" "$DS/informe_laboratorio.md")" "subida dentro del plazo"

titulo "3. Esperando el cierre…"
while (( $(date +%s) <= $(date -d "$LIMITE" +%s) )); do
  printf '\r          faltan %3d s ' $(( $(date -d "$LIMITE" +%s) - $(date +%s) + 1 )); sleep 1
done
echo; sleep 1

titulo "4. est_carla intenta subir después del cierre"
comprobar 403 "$(subir est_carla "/api/actividades/$ACT/entregas" "$DS/algoritmo_ordenamiento.txt")" "subida fuera de plazo"
echo "          respuesta: $(json error)"

titulo "5. El docente otorga una prórroga individual a est_carla (+10 min)"
NUEVA="$(date -u -d '+10 minutes' +%Y-%m-%dT%H:%M:%SZ)"
comprobar 201 "$(pedir_json doc_ramirez POST "/api/actividades/$ACT/prorrogas" "{\"estudiante\":\"est_carla\",\"nueva_fecha_limite\":\"$NUEVA\"}")" "otorgar prórroga hasta $NUEVA"

titulo "6. est_carla vuelve a subir"
comprobar 201 "$(subir est_carla "/api/actividades/$ACT/entregas" "$DS/algoritmo_ordenamiento.txt")" "subida con prórroga"
ENT="$(json id)"

titulo "7. La prórroga es individual: est_bruno sigue bloqueado"
comprobar 403 "$(subir est_bruno "/api/actividades/$ACT/entregas" "$DS/informe_copia.md")" "est_bruno sin prórroga"

titulo "8. Auditoría de la actividad (lo que ve el Admin TI)"
pedir admin GET "/api/admin/auditoria?recurso=$ACT&limit=50" >/dev/null
python3 - "$TMPD/out" <<'PY'
import json, sys
for f in reversed(json.load(open(sys.argv[1]))):
    d = f["detalle"]
    extra = d.get("motivo") or (f"a {d.get('estudiante')} hasta {d.get('nueva_fecha_limite')}" if f["accion"] == "prorroga:otorgar" else "")
    print(f"          {f['ts'][11:19]}  {f['username']:<12} {f['accion']:<18} {f['resultado']:<9} {extra}")
PY
titulo "Trazabilidad de la entrega final de est_carla (lo que ve el docente)"
pedir doc_ramirez GET "/api/entregas/$ENT/trazabilidad" >/dev/null
python3 - "$TMPD/out" <<'PY'
import json, sys
for f in json.load(open(sys.argv[1]))["eventos"]:
    print(f"          {f['ts'][11:19]}  {f['username']:<12} {f['accion']:<18} {f['resultado']:<9} {f['detalle'].get('motivo', '')}")
PY

resumen
