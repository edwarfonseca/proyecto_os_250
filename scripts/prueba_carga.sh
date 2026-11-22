#!/usr/bin/env bash
# =====================================================================
# Prueba de CARGA: 5 estudiantes × 10 entregas = 50 trabajos en paralelo.
# Mide: tiempo total, promedio por trabajo, espera en cola y pico de CPU y
# RAM del worker. Se corre con concurrencia 1 y 2 para comparar.
#
# Uso:  ./scripts/prueba_carga.sh 1      (concurrencia del worker = 1)
#       ./scripts/prueba_carga.sh 2      (concurrencia del worker = 2)
# Al terminar, el worker vuelve a la concurrencia del .env.
# =====================================================================
set -uo pipefail
source "$(dirname "$0")/lib.sh"
C="${1:-1}"
ESTUDIANTES="${ESTUDIANTES:-5}"
POR_ESTUDIANTE="${POR_ESTUDIANTE:-10}"
TOTAL=$((ESTUDIANTES * POR_ESTUDIANTE))
evidencia "carga_c${C}"
DS="$RAIZ/dataset"
[[ -f "$DS/ensayo_largo.txt" ]] || ./scripts/generar_dataset.sh >/dev/null
# 10 archivos por estudiante; uno de ellos es el de 4.8 MB.
ARCHIVOS=(informe_laboratorio.md notas_parcial_sintetico.csv algoritmo_ordenamiento.txt informe_copia.md
          metadatos_entrega.json ensayo_largo.txt informe_laboratorio.md notas_parcial_sintetico.csv
          algoritmo_ordenamiento.txt metadatos_entrega.json)

titulo "1. Preparación (usuarios, curso y actividad de carga)"
login admin >/dev/null; login doc_ramirez >/dev/null
for i in $(seq 1 "$ESTUDIANTES"); do
  pedir_json admin POST /api/admin/usuarios "{\"username\":\"est_carga$i\",\"nombre\":\"Estudiante de carga $i\",\"password\":\"$DEMO_PASS\",\"rol\":\"estudiante\"}" >/dev/null
done
pedir_json admin POST /api/admin/cursos '{"codigo":"CARGA-01","nombre":"Curso de prueba de carga","docente":"doc_ramirez"}' >/dev/null
pedir admin GET /api/cursos >/dev/null
CURSO="$(buscar_id codigo CARGA-01)"
for i in $(seq 1 "$ESTUDIANTES"); do
  pedir_json admin POST "/api/admin/cursos/$CURSO/matriculas" "{\"estudiante\":\"est_carga$i\"}" >/dev/null
  login "est_carga$i" >/dev/null
done
LIMITE="$(date -u -d '+1 day' +%Y-%m-%dT%H:%M:%SZ)"
comprobar 201 "$(pedir_json doc_ramirez POST "/api/cursos/$CURSO/actividades" "{\"titulo\":\"Carga c$C $(date +%H%M%S)\",\"fecha_limite\":\"$LIMITE\"}")" "actividad de carga creada"
ACT="$(json id)"

titulo "2. Worker con WORKER_CONCURRENCY=$C"
WORKER_CONCURRENCY="$C" $DC up -d --no-deps worker 2>&1 | tail -1
WORKER_CTR="$($DC ps -q worker)"
for _ in $(seq 1 30); do
  [[ "$($DOCKER inspect -f '{{.State.Health.Status}}' "$WORKER_CTR")" == healthy ]] && break; sleep 2
done
verificar '$DOCKER inspect -f "{{range .Config.Env}}{{println .}}{{end}}" "$WORKER_CTR" | grep -qx "WORKER_CONCURRENCY=$C"' "worker corriendo con WORKER_CONCURRENCY=$C"

titulo "3. Disparando $TOTAL subidas ($ESTUDIANTES estudiantes en paralelo)"
# Muestreo continuo de CPU y RAM del worker (docker stats emite ~1 lectura por segundo)
$DOCKER stats --format '{{.CPUPerc}};{{.MemUsage}}' "$WORKER_CTR" > "$TMPD/stats" 2>/dev/null &
MUESTREO=$!
sleep 2
T0="$(date +%s.%N)"
for i in $(seq 1 "$ESTUDIANTES"); do
  (
    for k in $(seq 0 $((POR_ESTUDIANTE - 1))); do
      f="${ARCHIVOS[$((k % ${#ARCHIVOS[@]}))]}"
      curl -s -o /dev/null -w '%{http_code}\n' -b "$TMPD/est_carga$i.jar" -F "archivo=@$DS/$f" \
        "$BASE/api/actividades/$ACT/entregas" >> "$TMPD/codigos"
    done
  ) &
done
wait $(jobs -p | grep -v "^$MUESTREO$") 2>/dev/null
T_SUBIDA="$(awk -v a="$(date +%s.%N)" -v b="$T0" 'BEGIN{printf "%.2f", a-b}')"
ACEPTADAS="$(grep -c '^201$' "$TMPD/codigos")"
echo "          subidas aceptadas: $ACEPTADAS/$TOTAL en ${T_SUBIDA}s"
verificar '[[ "$ACEPTADAS" == "$TOTAL" ]]' "todas las subidas reciben 201"

titulo "4. Esperando a que el worker vacíe la cola"
for _ in $(seq 1 600); do
  pedir doc_ramirez GET "/api/entregas?actividad=$ACT" >/dev/null
  read -r HECHOS PEND <<<"$(python3 -c '
import json,sys
d=json.load(open(sys.argv[1]))
h=sum(1 for x in d if x["estado"] in ("completado","fallido"))
print(h, len(d)-h)' "$TMPD/out")"
  printf '\r          terminados %3d · en cola %3d ' "$HECHOS" "$PEND"
  [[ "$PEND" == 0 && "$HECHOS" -ge "$ACEPTADAS" ]] && break
  sleep 0.5
done
echo
kill "$MUESTREO" 2>/dev/null; wait "$MUESTREO" 2>/dev/null

titulo "5. Resultados (calculados con los tiempos guardados en la BD)"
$DC exec -T db psql -U postgres -d entregasegura -P pager=off -c "
SELECT count(*)                                                        AS trabajos,
       count(*) FILTER (WHERE j.estado = 'completado')                 AS completados,
       count(*) FILTER (WHERE j.estado = 'fallido')                    AS fallidos,
       round(EXTRACT(EPOCH FROM max(j.terminado_en) - min(j.creado_en))::numeric, 2) AS total_seg,
       round(avg(j.ms))                                                AS ms_promedio,
       percentile_disc(0.95) WITHIN GROUP (ORDER BY j.ms)              AS ms_p95,
       max(j.ms)                                                       AS ms_max,
       round(avg(EXTRACT(EPOCH FROM j.iniciado_en - j.creado_en) * 1000)) AS espera_cola_ms_promedio,
       round(count(*) / NULLIF(EXTRACT(EPOCH FROM max(j.terminado_en) - min(j.creado_en)), 0)::numeric, 2) AS trabajos_por_seg
  FROM jobs j JOIN submissions s ON s.id = j.submission_id
 WHERE s.assignment_id = '$ACT';"

python3 - "$TMPD/stats" <<'PY'
import re, sys
cpu, mem = [], []
texto = re.sub(r"\x1b\[[0-9;]*[A-Za-z]", "\n", open(sys.argv[1], errors="replace").read())
for l in texto.splitlines():
    try:
        c, m = l.strip().split(";")
        cpu.append(float(c.rstrip("%")))
        v = re.match(r"([\d.]+)\s*([KMG]i?B)", m.split("/")[0].strip())
        mult = {"KiB": 1/1024, "kB": 1/1000, "MiB": 1, "MB": 1, "GiB": 1024, "GB": 1000}.get(v.group(2), 1)
        mem.append(float(v.group(1)) * mult)
    except Exception:
        pass
if cpu:
    print(f"          Worker · pico de CPU: {max(cpu):.1f} %  (límite 0.50 CPU = 50 %)")
    print(f"          Worker · pico de RAM: {max(mem):.1f} MiB de 256 MiB  ({max(mem)/256*100:.0f} % del límite)")
    print(f"          Muestras tomadas: {len(cpu)}")
PY

titulo "6. Restaurando la concurrencia del .env"
$DC up -d --no-deps worker 2>&1 | tail -1
resumen
