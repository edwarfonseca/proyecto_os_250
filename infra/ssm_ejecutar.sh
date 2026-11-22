#!/usr/bin/env bash
# =====================================================================
# Ejecuta un comando en la EC2 a través de AWS Systems Manager (sin SSH:
# el puerto 22 está cerrado) y muestra su salida.
#
#   infra/ssm_ejecutar.sh 'cd /opt/entregasegura && docker compose ps'
#   infra/ssm_ejecutar.sh 'comando largo' 1800        # tiempo máximo en segundos
#
# Requisitos: AWS CLI conectado al lab (scripts/conectar_aws_lab.sh) y la
# instancia con la etiqueta Name=entregasegura en estado running.
# El comando corre como root, con bash, en el servidor.
# Para una terminal interactiva usa la consola web:
#   EC2 -> la instancia -> Connect -> Session Manager -> Connect
# =====================================================================
set -euo pipefail
[[ $# -ge 1 ]] || { sed -n '2,15p' "$0"; exit 1; }
CMD="$1"
TIEMPO="${2:-600}"
REGION="${AWS_REGION:-us-east-1}"

ID="${INSTANCIA:-$(aws ec2 describe-instances --region "$REGION" \
  --filters Name=tag:Name,Values=entregasegura Name=instance-state-name,Values=running \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)}"
[[ "$ID" == i-* ]] || { echo "No hay ninguna instancia 'entregasegura' encendida."; exit 1; }

# El comando viaja como JSON (python se encarga de las comillas) y se ejecuta con bash.
PARAMS="$(python3 -c '
import json, shlex, sys
script = "export HOME=/root; cd /opt/entregasegura 2>/dev/null || cd /; bash -c " + shlex.quote(sys.argv[1])
print(json.dumps({"commands": [script], "executionTimeout": [sys.argv[2]]}))' "$CMD" "$TIEMPO")"

CID="$(aws ssm send-command --region "$REGION" --instance-ids "$ID" --document-name AWS-RunShellScript \
  --comment "entregasegura" --parameters "$PARAMS" --query Command.CommandId --output text)"

ESTADO=Pending
while :; do
  ESTADO="$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$ID" \
    --query Status --output text 2>/dev/null || echo Pending)"
  case "$ESTADO" in Success|Failed|Cancelled|TimedOut|Undeliverable|Terminated) break ;; esac
  sleep 3
done

aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$ID" \
  --query StandardOutputContent --output text
ERR="$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$ID" \
  --query StandardErrorContent --output text)"
[[ -n "${ERR//[[:space:]]/}" && "$ERR" != "None" ]] && { echo "--- stderr ---"; echo "$ERR"; }
CODIGO="$(aws ssm get-command-invocation --region "$REGION" --command-id "$CID" --instance-id "$ID" \
  --query ResponseCode --output text)"
echo "--- [$ESTADO · código $CODIGO · $ID] ---"
[[ "$ESTADO" == Success ]]
