#!/usr/bin/env bash
# =====================================================================
# Activa HTTPS en la EC2 con un certificado gratuito de Let's Encrypt
# para <subdominio>.duckdns.org. Requisito: haber ejecutado antes
# infra/configurar_duckdns.sh (usa su nombre y su token).
#
#   infra/ssm_ejecutar.sh 'PRUEBA=si bash infra/configurar_https.sh' 900   # ensayo (certificado de pruebas)
#   infra/ssm_ejecutar.sh 'bash infra/configurar_https.sh' 900              # de verdad
#   infra/ssm_ejecutar.sh 'bash infra/configurar_https.sh desactivar' 900   # volver a solo HTTP
#
# Qué hace:
#   1. Instala certbot y copia los ganchos a /usr/local/lib/entregasegura.
#   2. Pide el certificado con el reto DNS-01 (TXT en DuckDNS): no necesita
#      abrir ningún puerto extra. Se renueva solo (certbot.timer).
#   3. En el .env: COMPOSE_FILE (añade docker-compose.https.yml) y
#      COOKIE_SECURE=true (la cookie de sesión solo viaja cifrada).
#   4. ufw: permite el 443. (El Security Group se abre aparte, desde el PC.)
#   5. Recrea el proxy y comprueba HTTPS.
# No se envía ningún correo a Let's Encrypt (--register-unsafely-without-email).
# =====================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo"; exit 1; }
APP_DIR="${APP_DIR:-/opt/entregasegura}"
ENV_FILE="$APP_DIR/.env"
GANCHOS="/usr/local/lib/entregasegura/certbot_ganchos.sh"
CERT=entregasegura
cd "$APP_DIR"

leer() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | tr -d '[:space:]'; }
poner() { # poner VARIABLE valor  (reemplaza o añade en el .env)
  sed -i "/^$1=/d" "$ENV_FILE"
  [[ -z "$(tail -c 1 "$ENV_FILE")" ]] || echo >> "$ENV_FILE"
  echo "$1=$2" >> "$ENV_FILE"
}
esperar_sano() {
  for _ in $(seq 1 40); do
    [[ "$(docker compose ps --format '{{.Health}}' | grep -c '^healthy$' || true)" == 4 ]] && return 0
    sleep 3
  done
  docker compose ps; return 1
}

if [[ "${1:-}" == "desactivar" ]]; then
  echo "[*] Volviendo a solo HTTP"
  sed -i '/^COMPOSE_FILE=/d' "$ENV_FILE"
  poner COOKIE_SECURE false
  docker compose up -d --force-recreate proxy api
  esperar_sano && echo "Listo: de nuevo solo HTTP (el certificado sigue guardado por si se reactiva)."
  exit 0
fi

DOMINIO="$(leer DUCKDNS_DOMAIN)"
[[ -n "$DOMINIO" && -n "$(leer DUCKDNS_TOKEN)" ]] || { echo "Falta DuckDNS: ejecuta antes infra/configurar_duckdns.sh"; exit 1; }
FQDN="$DOMINIO.duckdns.org"
grep -qF "$FQDN" proxy/nginx-https.conf || { echo "proxy/nginx-https.conf no menciona $FQDN: actualízalo"; exit 1; }

echo "[1] certbot y ganchos"
command -v certbot >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq certbot >/dev/null
install -d -m 0755 -o root -g root /usr/local/lib/entregasegura
install -m 0755 -o root -g root infra/certbot_ganchos.sh "$GANCHOS"
certbot --version

OPCIONES=(--non-interactive --agree-tos --register-unsafely-without-email
          --manual --preferred-challenges dns
          --manual-auth-hook "$GANCHOS auth" --manual-cleanup-hook "$GANCHOS cleanup"
          --cert-name "$CERT" -d "$FQDN")
if [[ "${PRUEBA:-no}" == "si" ]]; then
  echo "[2] ENSAYO con el servidor de pruebas de Let's Encrypt (no guarda nada)"
  certbot certonly --dry-run "${OPCIONES[@]}"
  echo "Ensayo correcto: el reto DNS funciona. Ejecuta sin PRUEBA=si para el certificado real."
  exit 0
fi

echo "[2] Certificado de Let's Encrypt para $FQDN"
certbot certonly --keep-until-expiring --deploy-hook "$GANCHOS deploy" "${OPCIONES[@]}"
# Si el certificado ya existía, certbot no llama al gancho: se instala igual.
RENEWED_LINEAGE="/etc/letsencrypt/live/$CERT" "$GANCHOS" deploy
openssl x509 -in /etc/entregasegura/tls/fullchain.pem -noout -subject -issuer -enddate
systemctl is-enabled certbot.timer >/dev/null && echo "  renovación automática: certbot.timer activo"

echo "[3] .env: COMPOSE_FILE y COOKIE_SECURE=true"
poner COMPOSE_FILE docker-compose.yml:docker-compose.https.yml
poner COOKIE_SECURE true
chown entregas:entregas "$ENV_FILE" 2>/dev/null || true
chmod 600 "$ENV_FILE"

echo "[4] ufw: permitir 443"
ufw allow 443/tcp comment 'EntregaSegura HTTPS' >/dev/null && ufw status | grep -E '^(80|443)/tcp ' || true

echo "[5] Recreando proxy y api"
docker compose up -d --build --force-recreate proxy api
esperar_sano
docker compose ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
echo "--- HTTPS desde la propia EC2:"
curl -fsS --resolve "$FQDN:443:127.0.0.1" "https://$FQDN/api/health" && echo
curl -sSI --resolve "$FQDN:443:127.0.0.1" "https://$FQDN/" | grep -iE '^(HTTP|strict-transport)'
echo "--- HTTP público -> HTTPS:"
curl -sSI -H "Host: $FQDN" http://127.0.0.1/ | grep -iE '^(HTTP|location)'
echo
echo "Listo: https://$FQDN  (falta abrir el 443 en el Security Group si aún no está)"
