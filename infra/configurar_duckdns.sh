#!/usr/bin/env bash
# =====================================================================
# Nombre fijo para la EC2 con DuckDNS (gratis), en vez de la IP pública
# que cambia en cada Stop/Start. Se ejecuta UNA vez en la EC2, desde
# Session Manager (consola EC2 -> Connect -> Session Manager), porque
# pide el token de DuckDNS sin mostrarlo en pantalla:
#
#     sudo bash /opt/entregasegura/infra/configurar_duckdns.sh <subdominio>
#
# Qué hace:
#   1. Guarda DUCKDNS_DOMAIN y DUCKDNS_TOKEN en el .env (600, nunca en git).
#   2. Instala el servicio systemd "entregasegura-duckdns", que en cada
#      arranque ejecuta infra/duckdns.sh como el usuario "entregas"
#      (sin privilegios) y con el sistema de archivos en solo lectura.
#   3. Lo ejecuta ya una vez y muestra el resultado.
# Volver a ejecutarlo sirve para cambiar el nombre o el token.
# =====================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo: sudo bash $0 <subdominio>"; exit 1; }

APP_DIR="${APP_DIR:-/opt/entregasegura}"
ENV_FILE="$APP_DIR/.env"
SVC_USER="entregas"
SVC="entregasegura-duckdns"
[[ -f "$ENV_FILE" ]] || { echo "No existe $ENV_FILE: primero despliega la app."; exit 1; }
id "$SVC_USER" >/dev/null 2>&1 || { echo "No existe el usuario '$SVC_USER': ejecuta antes infra/hardening_host.sh"; exit 1; }

# --- 1. Nombre y token ---
DOMINIO="${1:-}"
[[ -n "$DOMINIO" ]] || read -rp "Subdominio (lo que va antes de .duckdns.org): " DOMINIO
DOMINIO="$(printf '%s' "$DOMINIO" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
DOMINIO="${DOMINIO#http://}"; DOMINIO="${DOMINIO#https://}"; DOMINIO="${DOMINIO%%/*}"
DOMINIO="${DOMINIO%.duckdns.org}"
if [[ ! "$DOMINIO" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
  echo "Nombre no válido: '$DOMINIO'. Escribe solo la parte de antes de .duckdns.org"; exit 1
fi

echo "Copia el token desde https://www.duckdns.org (arriba, donde dice 'token')."
read -rsp "Pégalo aquí y pulsa Enter (no se verá nada al pegarlo): " TOKEN; echo
TOKEN="$(printf '%s' "$TOKEN" | tr -d '[:space:]')"
if [[ ! "$TOKEN" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "Eso no parece un token de DuckDNS (son 36 caracteres tipo xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)."
  exit 1
fi

# Se quitan los valores anteriores (si los había) y se añaden los nuevos.
sed -i '/^DUCKDNS_\(DOMAIN\|TOKEN\)=/d' "$ENV_FILE"
[[ -z "$(tail -c 1 "$ENV_FILE")" ]] || echo >> "$ENV_FILE"
printf 'DUCKDNS_DOMAIN=%s\nDUCKDNS_TOKEN=%s\n' "$DOMINIO" "$TOKEN" >> "$ENV_FILE"
unset TOKEN
chown "$SVC_USER:$SVC_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"
echo "[1] Nombre y token guardados en $ENV_FILE (permisos 600)"

# --- 2. Servicio systemd ---
cat > "/etc/systemd/system/$SVC.service" <<EOF
# EntregaSegura: mantiene $DOMINIO.duckdns.org apuntando a la IP pública
# de esta EC2. Instalado por infra/configurar_duckdns.sh
[Unit]
Description=EntregaSegura: actualiza $DOMINIO.duckdns.org con la IP pública
Wants=network-online.target
After=network-online.target
# Si el token está mal no se insiste para siempre: 10 intentos en 15 min.
StartLimitIntervalSec=15min
StartLimitBurst=10

[Service]
Type=oneshot
User=$SVC_USER
Group=$SVC_USER
ExecStart=/bin/bash $APP_DIR/infra/duckdns.sh
Restart=on-failure
RestartSec=30
# Mínimo privilegio: solo lee el .env y hace peticiones HTTP(S).
NoNewPrivileges=yes
CapabilityBoundingSet=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
RestrictNamespaces=yes
LockPersonality=yes
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SVC.service" >/dev/null 2>&1
echo "[2] Servicio $SVC instalado y activado en el arranque"

# --- 3. Primera actualización ---
echo "[3] Primera actualización:"
systemctl reset-failed "$SVC.service" 2>/dev/null || true
DESDE="$(date '+%Y-%m-%d %H:%M:%S')"
mensajes() { # solo lo que escribe duckdns.sh, no los avisos de systemd
  journalctl -u "$SVC.service" --since "$DESDE" --no-pager -o cat \
    | grep -E 'DuckDNS|Faltan|IP pública|curl:' | tail -n 3 || true
}
if systemctl restart "$SVC.service"; then
  mensajes
  echo
  echo "Listo. La aplicación queda en:  http://$DOMINIO.duckdns.org"
  echo "(tras cada arranque, el nombre tarda hasta 1 minuto en apuntar a la IP nueva)"
else
  mensajes
  echo "Falló. Revisa el nombre y el token y vuelve a ejecutar este script."
  exit 1
fi
