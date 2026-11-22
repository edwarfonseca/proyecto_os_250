#!/usr/bin/env bash
# =====================================================================
# Fase 7.2 · Hardening del host Ubuntu 24.04 (EC2). Se ejecuta UNA vez:
#     sudo bash infra/hardening_host.sh
# Medidas (el enunciado pide 3; aquí hay 6):
#   1. Usuario de servicio "entregas" sin sudo y sin grupo docker, dueño
#      de /opt/entregasegura, con .env en 600.
#   2. SSH: sin contraseñas, sin root, solo el usuario "ubuntu".
#   3. Firewall de doble capa: Security Group + ufw (solo 22 y 80).
#   4. Actualizaciones automáticas de seguridad (unattended-upgrades).
#   5. Servicios innecesarios desactivados.
#   6. Docker con rotación de logs y no-new-privileges por defecto.
# Deja evidencias "antes/después" en docs/evidencias/host_*.txt
# =====================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Ejecuta con sudo: sudo bash $0"; exit 1; }

APP_DIR="${APP_DIR:-/opt/entregasegura}"
SVC_USER="entregas"
ADMIN_USER="${ADMIN_USER:-ubuntu}"
ABRIR_443="${ABRIR_443:-no}"
EVID="$APP_DIR/docs/evidencias"
mkdir -p "$EVID"
FECHA="$(date +%Y%m%d_%H%M%S)"
# En Ubuntu 24.04 SSH arranca por socket: /run/sshd no existe hasta la primera
# conexión y sin ella "sshd -t" / "sshd -T" fallan. La creamos como haría el servicio.
install -d -m 0755 /run/sshd

evidencia() { # evidencia <etiqueta>
  {
    echo "== $1 · $(date) =="
    echo "--- apt list --upgradable";             apt list --upgradable 2>/dev/null | tail -n +2 | wc -l
    echo "--- ss -tulpn (puertos en escucha)";    ss -tulpn
    echo "--- ufw status";                        ufw status verbose || true
    echo "--- servicios habilitados";             systemctl list-unit-files --type=service --state=enabled --no-pager
    echo "--- sshd efectivo";                     sshd -T 2>&1 | grep -Ei '^(passwordauthentication|permitrootlogin|allowusers|maxauthtries|x11forwarding|pubkeyauthentication) ' || true
  } > "$EVID/host_${1}_${FECHA}.txt" 2>&1
  echo "  evidencia: $EVID/host_${1}_${FECHA}.txt"
}

echo "[0] Evidencia ANTES"
evidencia antes

echo "[1] Usuario de servicio '$SVC_USER' (sin sudo, sin grupo docker, sin shell de login)"
id "$SVC_USER" >/dev/null 2>&1 || useradd --system --create-home --home-dir "/home/$SVC_USER" --shell /usr/sbin/nologin "$SVC_USER"
gpasswd -d "$SVC_USER" docker 2>/dev/null || true
gpasswd -d "$SVC_USER" sudo 2>/dev/null || true
chown -R "$SVC_USER:$SVC_USER" "$APP_DIR"
chmod 750 "$APP_DIR"
# El admin entra al directorio en modo lectura (grupo), pero no puede leer .env (600)
# ni modificar nada sin sudo. Aplica desde su próximo inicio de sesión SSH.
usermod -aG "$SVC_USER" "$ADMIN_USER"
if [[ -f "$APP_DIR/.env" ]]; then
  chown "$SVC_USER:$SVC_USER" "$APP_DIR/.env"; chmod 600 "$APP_DIR/.env"
fi
# Las migraciones las lee el contenedor de PostgreSQL (usuario postgres): deben ser legibles.
chmod -R o+rX "$APP_DIR/db/migrations"

echo "[2] SSH endurecido"
cat > /etc/ssh/sshd_config.d/01-entregasegura.conf <<EOF
# EntregaSegura: hardening de SSH (el primer valor leído es el que vale,
# por eso el archivo empieza por 01-)
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
AllowUsers $ADMIN_USER
MaxAuthTries 3
X11Forwarding no
EOF
if sshd -t; then
  # Con activación por socket, si ssh.service no está corriendo leerá la
  # configuración nueva en la próxima conexión; si está corriendo, se recarga.
  if systemctl is-active --quiet ssh; then systemctl reload ssh; fi
  echo "  configuración de sshd validada con sshd -t y aplicada"
else
  echo "  ERROR en la configuración de sshd: se revierte para no perder el acceso"
  rm -f /etc/ssh/sshd_config.d/01-entregasegura.conf
fi

echo "[3] Firewall ufw: denegar todo lo entrante salvo 22 y 80"
apt-get install -y -qq ufw >/dev/null
ufw default deny incoming
ufw default allow outgoing
# El 22 lo cierra el Security Group (la administración es por Systems Manager).
# ufw lo deja pasar solo como acceso de EMERGENCIA: si SSM fallara, basta con
# abrirlo temporalmente en el Security Group desde la consola.
ufw allow 22/tcp comment 'SSH emergencia (cerrado en el SG)'
ufw allow 80/tcp comment 'EntregaSegura HTTP'
[[ "$ABRIR_443" == "si" ]] && ufw allow 443/tcp comment 'EntregaSegura HTTPS'
ufw --force enable
echo "  OJO: los puertos que publica Docker no pasan por ufw (Docker escribe sus"
echo "  propias reglas de iptables). Por eso el Security Group es la capa principal"
echo "  y por eso docker-compose.yml publica UN solo puerto."

echo "[4] Actualizaciones automáticas de seguridad"
apt-get install -y -qq unattended-upgrades >/dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades >/dev/null
unattended-upgrade -d >/dev/null 2>&1 || true   # aplica ya los parches pendientes

echo "[5] Servicios innecesarios en un servidor EC2"
for s in multipathd.service multipathd.socket ModemManager.service udisks2.service; do
  if systemctl is-enabled "$s" >/dev/null 2>&1; then
    systemctl disable --now "$s" >/dev/null 2>&1 && echo "  desactivado: $s"
  fi
done
if [[ "${DESACTIVAR_SNAPD:-no}" == "si" ]]; then
  # ¡NO en EntregaSegura! En Ubuntu el agente de Systems Manager (amazon-ssm-agent)
  # es un snap: sin snapd se pierde el único acceso de administración.
  systemctl disable --now snapd.service snapd.socket snapd.seeded.service >/dev/null 2>&1 && echo "  desactivado: snapd"
fi

echo "[6] Docker: rotación de logs y no-new-privileges por defecto"
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "no-new-privileges": true,
  "icc": false,
  "live-restore": true
}
EOF
systemctl restart docker
systemctl enable docker >/dev/null

echo "[7] Evidencia DESPUÉS"
evidencia despues
echo
echo "Hardening terminado. Comprueba que el acceso de administración sigue funcionando"
echo "(Systems Manager: infra/ssm_ejecutar.sh 'id', o Session Manager en la consola)."
