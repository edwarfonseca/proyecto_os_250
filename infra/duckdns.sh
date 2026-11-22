#!/usr/bin/env bash
# =====================================================================
# Avisa a DuckDNS de la IP pública ACTUAL de la EC2, para que el nombre
# <subdominio>.duckdns.org siga a la instancia aunque la IP cambie en
# cada Stop/Start (así no hace falta Elastic IP).
#
# No se ejecuta a mano: lo lanza el servicio systemd
# "entregasegura-duckdns" en cada arranque, como el usuario sin
# privilegios "entregas". Lo instala infra/configurar_duckdns.sh.
#
# Lee DUCKDNS_DOMAIN y DUCKDNS_TOKEN del .env (600, nunca en git).
# El token nunca va en la línea de comandos: no aparece en "ps".
# =====================================================================
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/entregasegura/.env}"

# Se lee el .env con sed en vez de "source": así no se ejecuta nada de él.
leer() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '[:space:]'; }
DOMINIO="$(leer DUCKDNS_DOMAIN)"
TOKEN="$(leer DUCKDNS_TOKEN)"
if [[ -z "$DOMINIO" || -z "$TOKEN" ]]; then
  echo "Faltan DUCKDNS_DOMAIN o DUCKDNS_TOKEN en $ENV_FILE (usa infra/configurar_duckdns.sh)"
  exit 1
fi

# IP pública desde el servicio de metadatos de la instancia (IMDSv2:
# primero se pide un token de sesión y con él se consulta).
IMDS="http://169.254.169.254/latest"
T="$(curl -fsS --max-time 5 -X PUT -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' "$IMDS/api/token")"
IP="$(curl -fsS --max-time 5 -H "X-aws-ec2-metadata-token: $T" "$IMDS/meta-data/public-ipv4" || true)"
if [[ ! "$IP" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]]; then
  echo "La instancia no tiene IP pública todavía"
  exit 1
fi

# La URL (con el token) se le pasa a curl por la entrada estándar (-K -).
R="$(printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip=%s"\n' \
       "$DOMINIO" "$TOKEN" "$IP" | curl -fsS --max-time 15 -K -)"
if [[ "$R" == "OK" ]]; then
  echo "DuckDNS actualizado: $DOMINIO.duckdns.org -> $IP"
else
  echo "DuckDNS rechazó la actualización (respuesta: $R). ¿El nombre o el token están mal?"
  exit 1
fi
