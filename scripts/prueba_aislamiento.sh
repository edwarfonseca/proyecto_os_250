#!/usr/bin/env bash
# =====================================================================
# Prueba de AISLAMIENTO: nadie accede a lo que no es suyo.
#   - Estudiante B pide la entrega de A          -> 404
#   - Docente de otro curso pide la entrega      -> 404
#   - Admin TI pide el CONTENIDO                 -> 403 (solo metadatos)
#   - Estudiante no matriculado sube             -> 404
# y todo queda como DENEGADO en la auditoría.
# Uso:  ./scripts/prueba_aislamiento.sh
# =====================================================================
set -uo pipefail
source "$(dirname "$0")/lib.sh"
evidencia aislamiento
DS="$RAIZ/dataset"
[[ -f "$DS/informe_laboratorio.md" ]] || ./scripts/generar_dataset.sh >/dev/null

titulo "Preparación"
for u in admin doc_ramirez doc_torres est_ana est_bruno est_diego; do
  comprobar 200 "$(login "$u")" "login $u"
done
pedir est_ana GET /api/cursos >/dev/null
CURSO="$(buscar_id codigo SO-101)"
pedir est_ana GET "/api/cursos/$CURSO/actividades" >/dev/null
ACT="$(buscar_id titulo 'Informe de laboratorio 1')"
comprobar 201 "$(subir est_ana "/api/actividades/$ACT/entregas" "$DS/algoritmo_ordenamiento.txt")" "est_ana sube una entrega (la víctima)"
A="$(json id)"
echo "          ID de la entrega de est_ana: $A"
esperar_trabajo est_ana "$A" >/dev/null

titulo "Estudiante B (est_bruno) intenta usar el ID de la entrega de A"
comprobar 404 "$(pedir est_bruno GET "/api/entregas/$A")" "ver metadatos"
comprobar 404 "$(pedir est_bruno GET "/api/entregas/$A/archivo")" "descargar el archivo"
comprobar 404 "$(pedir est_bruno GET "/api/entregas/$A/resultado")" "ver el resultado"
comprobar 404 "$(subir est_bruno "/api/entregas/$A" "$DS/informe_copia.md" PUT)" "reemplazarla"
comprobar 404 "$(pedir est_bruno DELETE "/api/entregas/$A")" "eliminarla"
pedir est_bruno GET /api/entregas >/dev/null
verificar '! grep -q "$A" "$TMPD/out"' "no aparece en el listado de est_bruno"
comprobar 404 "$(pedir est_bruno GET "/api/entregas/00000000-0000-4000-8000-000000000000")" "ID inexistente (misma respuesta: no se puede enumerar)"

titulo "Docente de OTRO curso (doc_torres, BD-201)"
comprobar 404 "$(pedir doc_torres GET "/api/entregas/$A/archivo")" "descargar entrega de SO-101"
comprobar 404 "$(pedir doc_torres GET "/api/entregas/$A/trazabilidad")" "ver su trazabilidad"
comprobar 404 "$(pedir_json doc_torres POST "/api/actividades/$ACT/prorrogas" '{"estudiante":"est_ana","nueva_fecha_limite":"2030-01-01T00:00:00Z"}')" "otorgar prórroga en un curso ajeno"

titulo "Control positivo: el docente del curso (doc_ramirez) sí puede"
comprobar 200 "$(pedir doc_ramirez GET "/api/entregas/$A/archivo")" "descargar la entrega"

titulo "Separación de funciones: el Admin TI no ve contenidos"
comprobar 200 "$(pedir admin GET "/api/entregas/$A")" "admin ve METADATOS"
comprobar 403 "$(pedir admin GET "/api/entregas/$A/archivo")" "admin intenta descargar el archivo"
comprobar 403 "$(pedir admin GET "/api/entregas/$A/resultado")" "admin intenta ver el resultado"

titulo "Estudiante no matriculado (est_diego no está en SO-101)"
comprobar 404 "$(subir est_diego "/api/actividades/$ACT/entregas" "$DS/informe_copia.md")" "subir a una actividad de SO-101"
comprobar 404 "$(pedir est_diego GET "/api/cursos/$CURSO/actividades")" "ver las actividades de SO-101"

titulo "Escalada de privilegios"
comprobar 403 "$(pedir est_ana GET /api/admin/usuarios)" "estudiante -> /api/admin/usuarios"
comprobar 403 "$(pedir_json est_ana POST /api/admin/usuarios '{"username":"hacker","nombre":"x","password":"1234567890","rol":"admin"}')" "estudiante intenta crearse un admin"

titulo "Todo quedó en la auditoría como DENEGADO"
comprobar 200 "$(pedir admin GET "/api/admin/auditoria?resultado=DENEGADO&recurso=$A&limit=50")" "admin consulta los denegados sobre la entrega"
python3 - "$TMPD/out" <<'PY'
import json, sys
filas = json.load(open(sys.argv[1]))
for f in filas:
    print(f"          {f['ts'][:19]}  {f['username']:<12} {f['accion']:<20} {f['resultado']:<9} {f['detalle'].get('motivo', '')}")
PY
N="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))))' "$TMPD/out")"
verificar '[[ "$N" -ge 9 ]]' "al menos 9 intentos denegados registrados sobre esa entrega ($N)"

resumen
