#!/usr/bin/env bash
# =====================================================================
# Prueba FUNCIONAL: login de los 3 roles, subida, ciclo de estados,
# descarga, validaciones de archivo (413, 415, fallido) y duplicados.
# Uso:  ./scripts/prueba_funcional.sh        (en la EC2: sudo ./scripts/prueba_funcional.sh)
# =====================================================================
set -uo pipefail
source "$(dirname "$0")/lib.sh"
evidencia funcional
DS="$RAIZ/dataset"
[[ -f "$DS/ensayo_largo.txt" ]] || ./scripts/generar_dataset.sh >/dev/null

titulo "1. Salud del sistema"
comprobar 200 "$(curl -s -o "$TMPD/out" -w '%{http_code}' "$BASE/api/health")" "GET /api/health"

titulo "2. Autenticación de los tres roles"
comprobar 200 "$(login admin)" "login admin (Administrador TI)"
comprobar 200 "$(login doc_ramirez)" "login doc_ramirez (Docente)"
comprobar 200 "$(login est_ana)" "login est_ana (Estudiante)"
comprobar 200 "$(login est_bruno)" "login est_bruno (Estudiante)"
comprobar 401 "$(login est_ana 'contraseña-incorrecta' intruso)" "login con contraseña incorrecta"
comprobar 401 "$(curl -s -o "$TMPD/out" -w '%{http_code}' "$BASE/api/entregas")" "petición sin sesión"

titulo "3. Autorización por rol (RBAC)"
comprobar 200 "$(pedir admin GET /api/admin/usuarios)" "admin lista usuarios"
comprobar 403 "$(pedir est_ana GET /api/admin/usuarios)" "estudiante intenta listar usuarios"
comprobar 403 "$(pedir doc_ramirez GET /api/admin/auditoria)" "docente intenta ver la auditoría completa"

pedir doc_ramirez GET /api/cursos >/dev/null
CURSO="$(buscar_id codigo SO-101)"
TIT="Prueba funcional $(date +%H%M%S)"
LIMITE="$(date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)"
comprobar 201 "$(pedir_json doc_ramirez POST "/api/cursos/$CURSO/actividades" "{\"titulo\":\"$TIT\",\"fecha_limite\":\"$LIMITE\"}")" "docente crea actividad en SO-101"
ACT="$(json id)"
comprobar 403 "$(pedir_json est_ana POST "/api/cursos/$CURSO/actividades" "{\"titulo\":\"x\",\"fecha_limite\":\"$LIMITE\"}")" "estudiante intenta crear actividad"

titulo "4. Subida y ciclo de estados (pendiente → en_ejecucion → completado)"
comprobar 201 "$(subir est_ana "/api/actividades/$ACT/entregas" "$DS/informe_laboratorio.md")" "est_ana sube informe_laboratorio.md"
E1="$(json id)"; echo "          entrega: $E1 · estado inicial: $(json estado)"
esperar_trabajo est_ana "$E1"
verificar '[[ "$ESTADO" == completado ]]' "el trabajo termina en 'completado'"
comprobar 200 "$(pedir est_ana GET "/api/entregas/$E1/resultado")" "est_ana descarga su resultado"
SHA_SRV="$(json sha256)"
SHA_LOC="$(sha256sum "$DS/informe_laboratorio.md" | cut -d' ' -f1)"
echo "          sha256=$SHA_SRV · líneas=$(json lineas) · palabras=$(json palabras) · ms=$(json tiempo_procesamiento_ms)"
verificar '[[ "$SHA_SRV" == "$SHA_LOC" ]]' "el SHA-256 del servidor coincide con sha256sum local"
verificar '! grep -q posible_duplicado "$TMPD/out"' "el estudiante NO ve la marca posible_duplicado"
comprobar 200 "$(pedir est_ana GET "/api/entregas/$E1/archivo" )" "est_ana descarga su archivo original"
verificar 'cmp -s "$TMPD/out" "$DS/informe_laboratorio.md"' "el archivo descargado es idéntico al subido"

titulo "5. Otros formatos permitidos"
comprobar 201 "$(subir est_ana "/api/actividades/$ACT/entregas" "$DS/notas_parcial_sintetico.csv")" "sube CSV"
E2="$(json id)"; esperar_trabajo est_ana "$E2"
pedir est_ana GET "/api/entregas/$E2/resultado" >/dev/null
echo "          CSV: filas=$(json csv.filas) columnas=$(json csv.columnas)"
verificar '[[ "$(json csv.columnas)" == 8 ]]' "el CSV se analiza con 8 columnas"
comprobar 201 "$(subir est_ana "/api/actividades/$ACT/entregas" "$DS/metadatos_entrega.json")" "sube JSON"
E3="$(json id)"; esperar_trabajo est_ana "$E3"
pedir est_ana GET "/api/entregas/$E3/resultado" >/dev/null
verificar '[[ "$(json json.json_valido)" == True ]]' "el JSON se reconoce como válido"

titulo "6. Validación de archivos en 3 capas"
comprobar 413 "$(subir est_ana "/api/actividades/$ACT/entregas" "$DS/ensayo_excedido.txt")" "6 MB rechazado (capa 1: Nginx, 413)"
printf 'MZ\x90\x00 programa' > "$TMPD/programa.exe"
comprobar 415 "$(subir est_ana "/api/actividades/$ACT/entregas" "$TMPD/programa.exe")" ".exe rechazado por extensión (capa 2: API, 415)"
comprobar 201 "$(subir est_ana "/api/actividades/$ACT/entregas" "$DS/binario_disfrazado.txt")" "binario renombrado a .txt pasa la API…"
E4="$(json id)"; esperar_trabajo est_ana "$E4"
pedir est_ana GET "/api/entregas/$E4" >/dev/null
echo "          motivo: $(json trabajo.error)"
verificar '[[ "$ESTADO" == fallido ]]' "…y el worker lo marca 'fallido' (capa 3: UTF-8)"
comprobar 201 "$(subir est_ana "/api/actividades/$ACT/entregas" "$DS/ensayo_largo.txt")" "4.8 MB aceptado (cerca del límite)"
E5="$(json id)"; esperar_trabajo est_ana "$E5" 120
pedir est_ana GET "/api/entregas/$E5" >/dev/null
echo "          tiempo de procesamiento: $(json trabajo.ms) ms"
verificar '[[ "$ESTADO" == completado ]]' "el archivo de 4.8 MB se procesa"

titulo "7. Detección de duplicados (regla complementaria)"
comprobar 201 "$(subir est_bruno "/api/actividades/$ACT/entregas" "$DS/informe_copia.md")" "est_bruno sube una copia idéntica"
E6="$(json id)"; esperar_trabajo est_bruno "$E6"
comprobar 200 "$(pedir doc_ramirez GET "/api/entregas/$E6/resultado")" "el docente consulta el resultado"
echo "          posible_duplicado=$(json posible_duplicado) · duplicado_con=$(json duplicado_con)"
verificar '[[ "$(json posible_duplicado)" == True ]]' "el docente VE la marca posible_duplicado"
pedir est_bruno GET "/api/entregas/$E6/resultado" >/dev/null
verificar '! grep -q posible_duplicado "$TMPD/out"' "el estudiante NO ve la marca"

titulo "8. Reprocesar un trabajo fallido"
comprobar 200 "$(pedir doc_ramirez POST "/api/entregas/$E4/reprocesar")" "el docente reencola el trabajo fallido"
esperar_trabajo doc_ramirez "$E4"
comprobar 403 "$(pedir est_ana POST "/api/entregas/$E4/reprocesar")" "el estudiante no puede reprocesar"

titulo "9. Cierre de sesión"
comprobar 200 "$(pedir est_ana POST /api/auth/logout)" "logout"
comprobar 401 "$(curl -s -o "$TMPD/out" -w '%{http_code}' "$BASE/api/entregas")" "sin cookie ya no hay acceso"

resumen
