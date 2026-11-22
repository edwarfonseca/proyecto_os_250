#!/usr/bin/env bash
# =====================================================================
# Conecta el AWS CLI de ESTE PC con la sesión actual del Learner Lab.
#
#   1. En el Learner Lab: Start Lab -> AWS Details -> AWS CLI: Show
#   2. Copia el bloque completo (empieza por [default])
#   3. Ejecuta:  ./scripts/conectar_aws_lab.sh   y pega el bloque
#
# Las credenciales del lab son TEMPORALES: dejan de valer cuando termina
# la sesión (unas 4 h). En cada sesión nueva hay que repetir esto.
# Solo toca el perfil [default]; los demás perfiles (p. ej. localstack)
# se conservan. Nunca muestra los valores secretos en pantalla.
# =====================================================================
set -euo pipefail
command -v aws >/dev/null || { echo "No encuentro el comando aws (AWS CLI)."; exit 1; }

CRED="${AWS_SHARED_CREDENTIALS_FILE:-$HOME/.aws/credentials}"
mkdir -p "$(dirname "$CRED")"
chmod 700 "$(dirname "$CRED")"

echo "Pega el bloque de 'AWS Details -> AWS CLI: Show' (empieza por [default])."
echo "Después pulsa Enter y luego Ctrl+D."
echo "-----------------------------------------------------------------"
BLOQUE="$(cat)"
echo "-----------------------------------------------------------------"

# Copia de seguridad, una sola vez, del archivo tal como estaba antes del lab.
if [[ -s "$CRED" && ! -e "$CRED.antes-del-lab" ]]; then
  cp -p "$CRED" "$CRED.antes-del-lab" && chmod 600 "$CRED.antes-del-lab"
  echo "Copia de seguridad del archivo anterior: $CRED.antes-del-lab"
fi

# El bloque viaja por variable de entorno (no por argumentos: esos los ve
# cualquiera con "ps").
BLOQUE="$BLOQUE" CRED="$CRED" python3 - <<'PY'
import configparser, os, re, sys

claves = {}
for linea in os.environ["BLOQUE"].splitlines():
    m = re.match(r"\s*(aws_access_key_id|aws_secret_access_key|aws_session_token)\s*=\s*(\S+)\s*$", linea)
    if m:
        claves[m.group(1)] = m.group(2)
faltan = [k for k in ("aws_access_key_id", "aws_secret_access_key", "aws_session_token") if k not in claves]
if faltan:
    sys.exit("No encontré en lo pegado: " + ", ".join(faltan) + ". Copia el bloque completo y repite.")
if not claves["aws_access_key_id"].startswith("ASIA"):
    print("Aviso: la clave no empieza por ASIA; las del Learner Lab normalmente sí.")

ruta = os.environ["CRED"]
cp = configparser.RawConfigParser()
cp.read(ruta)
if cp.has_section("default"):
    cp.remove_section("default")
cp.add_section("default")
for k in ("aws_access_key_id", "aws_secret_access_key", "aws_session_token"):
    cp.set("default", k, claves[k])

os.umask(0o077)
with open(ruta, "w") as f:
    cp.write(f)
os.chmod(ruta, 0o600)
print("Credenciales guardadas en", ruta, "(permisos 600). Perfiles en el archivo:", ", ".join(cp.sections()))
PY

# Región y formato del perfil default (us-east-1: regla 9 del presupuesto).
aws configure set region us-east-1 --profile default
aws configure set output json --profile default

echo
echo "Comprobando la conexión con AWS..."
if ID="$(aws sts get-caller-identity --profile default --query '[Account,Arn]' --output text 2>&1)"; then
  read -r CUENTA ARN <<<"$ID"
  echo "Conectado. Cuenta: $CUENTA"
  echo "Identidad: $ARN"
  echo "Región por defecto: $(aws configure get region --profile default)"
  echo
  echo "Recuerda: estas credenciales caducan cuando termina la sesión del lab."
else
  echo "No se pudo conectar:"
  echo "$ID"
  echo "¿Está el lab iniciado (círculo verde) y copiaste el bloque de ESTA sesión?"
  exit 1
fi
