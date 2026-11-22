#!/usr/bin/env bash
# =====================================================================
# Ganchos de certbot para el certificado HTTPS de EntregaSegura.
# No se ejecuta a mano. infra/configurar_https.sh lo copia a
# /usr/local/lib/entregasegura/ (dueño root: un script que root ejecuta
# solo no debe poder modificarlo el usuario "entregas") y certbot lo
# llama al emitir y al renovar (timer certbot.timer, 2 veces al día):
#
#   auth     reto DNS-01: publica en DuckDNS el TXT que pide Let's Encrypt
#            para comprobar que el nombre es nuestro (variables CERTBOT_*).
#   cleanup  borra ese TXT.
#   deploy   copia el certificado nuevo a /etc/entregasegura/tls (llave
#            640 root:101, solo legible por el grupo de Nginx) y le pide a
#            Nginx que lo recargue sin cortar conexiones (señal HUP).
#
# El token de DuckDNS se lee del .env y se pasa a curl por stdin.
# =====================================================================
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/entregasegura/.env}"
TLS_DIR="/etc/entregasegura/tls"
NGINX_GID=101   # grupo del usuario de nginx-unprivileged

leer() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '[:space:]'; }
duckdns() { # duckdns <parámetros extra de la URL>
  printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&%s"\n' \
    "$(leer DUCKDNS_DOMAIN)" "$(leer DUCKDNS_TOKEN)" "$1" | curl -fsS --max-time 20 -K -
}

case "${1:-}" in
  auth)
    [[ "$(duckdns "txt=$CERTBOT_VALIDATION")" == "OK" ]] || { echo "DuckDNS no aceptó el TXT"; exit 1; }
    # Esperar a que TODOS los servidores DNS de DuckDNS lo publiquen
    # (Let's Encrypt pregunta desde varios sitios). Máximo ~3 minutos.
    mapfile -t NS < <(dig +short NS duckdns.org 2>/dev/null)
    for _ in $(seq 1 36); do
      LISTOS=0
      for ns in "${NS[@]}"; do
        dig +short TXT "_acme-challenge.$CERTBOT_DOMAIN" "@$ns" 2>/dev/null \
          | grep -qF "$CERTBOT_VALIDATION" && LISTOS=$((LISTOS + 1))
      done
      [[ "${#NS[@]}" -gt 0 && "$LISTOS" -eq "${#NS[@]}" ]] && break
      sleep 5
    done
    echo "TXT visible en $LISTOS de ${#NS[@]} servidores DNS de DuckDNS"
    sleep 10   # margen
    ;;
  cleanup)
    duckdns "txt=borrado&clear=true" >/dev/null || true
    ;;
  deploy)
    install -d -m 0750 -o root -g "$NGINX_GID" "$TLS_DIR"
    install -m 0644 -o root -g root        "$RENEWED_LINEAGE/fullchain.pem" "$TLS_DIR/fullchain.pem"
    install -m 0640 -o root -g "$NGINX_GID" "$RENEWED_LINEAGE/privkey.pem"   "$TLS_DIR/privkey.pem"
    C="$(docker ps -q --filter label=com.docker.compose.project=entregasegura \
                      --filter label=com.docker.compose.service=proxy)"
    if [[ -n "$C" ]]; then docker kill --signal=HUP "$C" >/dev/null && echo "Nginx recargado"; fi
    ;;
  *)
    echo "Uso: $0 auth|cleanup|deploy (lo llama certbot)"; exit 1 ;;
esac
