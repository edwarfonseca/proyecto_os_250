#!/usr/bin/env bash
# Funciones comunes de los scripts de prueba. No se ejecuta solo: lo cargan
# los demás scripts con "source".

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$RAIZ" || exit 1

leer_env() { grep -E "^$1=" "$RAIZ/.env" 2>/dev/null | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*$//'; }

if [[ ! -r "$RAIZ/.env" ]]; then
  echo "No puedo leer .env (en la EC2 ejecuta el script con sudo)."; exit 1
fi
PUERTO="$(leer_env HTTP_PORT)"
BASE="${BASE:-http://localhost:${PUERTO:-80}}"
ADMIN_PASS="$(leer_env ADMIN_PASSWORD)"
DEMO_PASS="$(leer_env DEMO_PASSWORD)"

# En la EC2 los scripts se ejecutan con sudo (el usuario no está en el grupo docker);
# en local, el usuario sí está en el grupo docker.
if ! docker info >/dev/null 2>&1; then
  echo "No tengo acceso a Docker. En la EC2 ejecuta el script con sudo:  sudo $0 $*"; exit 1
fi
DOCKER="docker"
DC="$DOCKER compose"

TMPD="$(mktemp -d)"
limpiar_tmp() { find "$TMPD" -mindepth 1 -delete 2>/dev/null; rmdir "$TMPD" 2>/dev/null; }
trap limpiar_tmp EXIT

OKS=0
FALLOS=0

# Guarda toda la salida también en docs/evidencias/<nombre>_<fecha>.txt
evidencia() {
  mkdir -p "$RAIZ/docs/evidencias"
  EVID="$RAIZ/docs/evidencias/$1_$(date +%Y%m%d_%H%M%S).txt"
  exec > >(tee "$EVID") 2>&1
  echo "== $1 · $(date '+%Y-%m-%d %H:%M:%S %Z') · $(uname -n) · $BASE =="
}

titulo() { echo; echo "---- $* ----"; }

# login <usuario> [contraseña] [nombre_cookie]  -> guarda la cookie en $TMPD/<nombre_cookie o usuario>.jar
# e imprime el código HTTP
login() {
  local u="$1" p="${2:-$DEMO_PASS}" jar="${3:-$1}"
  [[ "$u" == "admin" && -z "${2:-}" ]] && p="$ADMIN_PASS"
  curl -s -o "$TMPD/out" -w '%{http_code}' -c "$TMPD/$jar.jar" \
    -H 'Content-Type: application/json' \
    --data-raw "{\"username\":\"$u\",\"password\":\"$p\"}" "$BASE/api/auth/login"
}

# pedir <usuario> <MÉTODO> <ruta> [opciones de curl...]  -> imprime el código; el cuerpo queda en $TMPD/out
pedir() {
  local u="$1" m="$2" r="$3"; shift 3
  curl -s -o "$TMPD/out" -w '%{http_code}' -b "$TMPD/$u.jar" -X "$m" "$@" "$BASE$r"
}

# pedir_json <usuario> <MÉTODO> <ruta> '<json>'
pedir_json() { pedir "$1" "$2" "$3" -H 'Content-Type: application/json' --data-raw "$4"; }

# subir <usuario> <ruta_api> <archivo> [MÉTODO]
subir() { pedir "$1" "${4:-POST}" "$2" -F "archivo=@$3"; }

cuerpo() { cat "$TMPD/out"; }

# json <ruta.con.puntos> [archivo]  -> extrae un campo del último cuerpo JSON
json() {
  python3 - "$1" "${2:-$TMPD/out}" <<'PY'
import json, sys
try:
    d = json.load(open(sys.argv[2]))
except Exception:
    d = None
for k in [x for x in sys.argv[1].split(".") if x]:
    if isinstance(d, list):
        d = d[int(k)] if int(k) < len(d) else None
    elif isinstance(d, dict):
        d = d.get(k)
    else:
        d = None
print(json.dumps(d, ensure_ascii=False) if isinstance(d, (dict, list)) else ("" if d is None else d))
PY
}

# buscar_id <campo> <valor>  -> id del primer elemento de la lista JSON cuyo campo vale <valor>
buscar_id() {
  python3 - "$1" "$2" "$TMPD/out" <<'PY'
import json, sys
for x in json.load(open(sys.argv[3])):
    if str(x.get(sys.argv[1])) == sys.argv[2]:
        print(x["id"]); break
PY
}

# comprobar <esperado> <real> <descripción>
comprobar() {
  local esperado="$1" real="$2" desc="$3"
  if [[ "$real" == "$esperado" ]]; then
    printf '  [OK]    %-62s HTTP %s\n' "$desc" "$real"; OKS=$((OKS + 1))
  else
    printf '  [FALLO] %-62s esperaba %s, llegó %s\n          %s\n' "$desc" "$esperado" "$real" "$(cuerpo | head -c 300)"
    FALLOS=$((FALLOS + 1))
  fi
}

# verificar <condición-bash> <descripción>   (para comprobaciones que no son HTTP)
verificar() {
  if eval "$1"; then printf '  [OK]    %s\n' "$2"; OKS=$((OKS + 1))
  else printf '  [FALLO] %s\n' "$2"; FALLOS=$((FALLOS + 1)); fi
}

# esperar_trabajo <usuario> <id_entrega> [segundos]  -> imprime las transiciones y deja el estado final en $ESTADO
esperar_trabajo() {
  local u="$1" id="$2" max="${3:-60}" anterior="" i
  ESTADO=""
  for ((i = 0; i < max * 2; i++)); do
    if [[ -z "$id" || "$(pedir "$u" GET "/api/entregas/$id")" != 200 ]]; then
      echo "          (no se pudo consultar la entrega)"; return 1
    fi
    ESTADO="$(json trabajo.estado)"
    if [[ "$ESTADO" != "$anterior" ]]; then echo "          estado: $ESTADO"; anterior="$ESTADO"; fi
    [[ "$ESTADO" == "completado" || "$ESTADO" == "fallido" ]] && return 0
    sleep 0.5
  done
  return 1
}

resumen() {
  echo
  echo "== RESUMEN: $OKS correctas, $FALLOS fallidas =="
  [[ -n "${EVID:-}" ]] && echo "Evidencia guardada en: $EVID"
  [[ "$FALLOS" -eq 0 ]]
}
