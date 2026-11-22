#!/usr/bin/env bash
# =====================================================================
# Evidencias de hardening (checklist puntos 2, 3, 4, 10 y 11; en la EC2 también HTTPS).
# Uso:  ./scripts/verificar_hardening.sh       (en la EC2: sudo ./scripts/verificar_hardening.sh)
# =====================================================================
set -uo pipefail
source "$(dirname "$0")/lib.sh"
evidencia hardening
DBNAME="$(leer_env POSTGRES_DB)"

titulo "1. Servicios y puertos publicados (solo el proxy debe tener uno)"
$DC ps --format 'table {{.Name}}\t{{.Status}}\t{{.Ports}}'
PUB="$($DOCKER ps --filter label=com.docker.compose.project=entregasegura --format '{{.Names}} {{.Ports}}' | grep -c -- '->')"
verificar '[[ "$PUB" == 1 ]]' "un único contenedor publica puertos"

titulo "2. Usuario de los procesos (uid ≠ 0)"
for s in api worker proxy; do
  ID="$($DC exec -T "$s" id 2>/dev/null)"
  echo "          $s: $ID"
  verificar '[[ "$ID" != uid=0* ]]' "$s no corre como root"
done
echo "          db: el proceso postgres baja de root al usuario postgres:"
$DC exec -T db sh -c 'ps -o user,pid,comm | head -4' | sed 's/^/            /'

titulo "3. Configuración de seguridad de cada contenedor"
$DOCKER inspect --format '{{.Name}} RO={{.HostConfig.ReadonlyRootfs}} CapDrop={{.HostConfig.CapDrop}} CapAdd={{.HostConfig.CapAdd}} NoNewPriv={{.HostConfig.SecurityOpt}} Mem={{.HostConfig.Memory}} CPU={{.HostConfig.NanoCpus}} Pids={{.HostConfig.PidsLimit}} Restart={{.HostConfig.RestartPolicy.Name}}' $($DC ps -q) | sed 's/^\//          /'
for s in api worker proxy; do
  verificar '[[ "$($DOCKER inspect -f "{{.HostConfig.ReadonlyRootfs}}" "$($DC ps -q "$s")")" == true ]]' "$s: sistema de archivos de solo lectura"
done

titulo "4. El sistema de archivos de solo lectura funciona de verdad"
OUT="$($DC exec -T api sh -c 'touch /app/src/malicioso.js' 2>&1)"
echo "          api> touch /app/src/malicioso.js  ->  $OUT"
verificar '[[ "$OUT" == *"Read-only"* ]]' "la API no puede modificar su propio código"

titulo "5. Aislamiento de red"
OUT="$($DC exec -T worker wget -q -T 4 -O /dev/null http://example.com 2>&1; echo "salida=$?")"
echo "          worker> wget http://example.com  ->  $OUT"
verificar '[[ "$OUT" != *"salida=0"* ]]' "el worker no tiene salida a Internet (red internal)"
if (exec 3<>/dev/tcp/127.0.0.1/5432) 2>/dev/null; then ABIERTO=si; else ABIERTO=no; fi
verificar '[[ "$ABIERTO" == no ]]' "PostgreSQL (5432) no es accesible desde el host"
$DOCKER network inspect entregasegura_internal --format '          red {{.Name}}: internal={{.Internal}}'

titulo "6. Auditoría inmutable (append-only)"
API_PW="$(leer_env APP_API_DB_PASSWORD)"
OUT="$($DC exec -T -e PGPASSWORD="$API_PW" db psql -h 127.0.0.1 -U app_api -d "$DBNAME" -c 'DELETE FROM audit_log' 2>&1)"
echo "          app_api> DELETE FROM audit_log  ->  $OUT"
verificar '[[ "$OUT" == *"permission denied"* ]]' "la aplicación (app_api) no puede borrar la auditoría"
# Se escribe un registro propio (queda a la vista como "verificacion:inmutabilidad") y se
# intenta alterar ESE registro: así la prueba no depende de que la tabla ya tenga datos.
$DC exec -T db psql -U postgres -d "$DBNAME" -qc "INSERT INTO audit_log (username, rol, accion, resultado, detalle) VALUES ('verificador', 'sistema', 'verificacion:inmutabilidad', 'PERMITIDO', '{\"script\": \"verificar_hardening.sh\"}')" >/dev/null
OUT="$($DC exec -T db psql -U postgres -d "$DBNAME" -c "UPDATE audit_log SET accion='alterado' WHERE id = (SELECT max(id) FROM audit_log WHERE accion='verificacion:inmutabilidad')" 2>&1)"
echo "          postgres> UPDATE audit_log ...  ->  $(echo "$OUT" | head -1)"
verificar '[[ "$OUT" == *"solo inserción"* ]]' "ni el superusuario puede modificarla sin quitar el trigger"
echo "          Permisos sobre audit_log:"
$DC exec -T db psql -U postgres -d "$DBNAME" -At -c "SELECT grantee || ': ' || string_agg(privilege_type, ', ') FROM information_schema.role_table_grants WHERE table_name='audit_log' AND grantee LIKE 'app_%' GROUP BY grantee" | sed 's/^/            /'

titulo "7. Secretos"
PERM="$(stat -c '%a' "$RAIZ/.env")"
ls -l "$RAIZ/.env" | sed 's/^/          /'
verificar '[[ "$PERM" == 600 ]]' ".env con permisos 600"
verificar 'git -c safe.directory="$RAIZ" -C "$RAIZ" check-ignore -q .env' ".env está excluido de git (.gitignore)"

titulo "8. Recursos (dato para interpretar)"
$DOCKER stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.PIDs}}' $($DC ps -q)
free -h | sed 's/^/          /'
df -h / | sed 's/^/          /'

if command -v ufw >/dev/null 2>&1; then   # solo en el servidor (EC2 con ufw)
  titulo "9. Host: puertos TCP en escucha y firewall"
  (sudo -n ss -tlnp 2>/dev/null || ss -tln) | sed 's/^/          /'
  (sudo -n ufw status verbose 2>/dev/null || echo "          (ufw: ejecuta el script con sudo para ver el estado)") | sed 's/^/          /'
fi

if [[ "$(leer_env COMPOSE_FILE)" == *https* ]]; then   # solo en la EC2 con HTTPS activado
  titulo "10. HTTPS (Let's Encrypt)"
  FQDN="$(leer_env DUCKDNS_DOMAIN).duckdns.org"
  R=(--resolve "$FQDN:443:127.0.0.1")
  CAB="$(curl -sSI "${R[@]}" "https://$FQDN/" 2>&1)"
  verificar 'curl -fsS "${R[@]}" "https://$FQDN/api/health" >/dev/null' "https://$FQDN responde con un certificado válido"
  verificar 'grep -qi "^strict-transport-security:" <<<"$CAB"' "HSTS activado"
  RED="$(curl -sSI -H "Host: $FQDN" http://127.0.0.1/ | grep -i '^location:' | tr -d '\r')"
  echo "          http://$FQDN -> ${RED#*: }"
  verificar '[[ "$RED" == *"https://$FQDN/"* ]]' "HTTP público redirige a HTTPS"
  TLS11="$(echo | timeout 5 openssl s_client -connect 127.0.0.1:443 -servername "$FQDN" -tls1_1 2>&1 | grep -c '^ *Protocol *: *TLSv1.1' || true)"
  verificar '[[ "$TLS11" == 0 ]]' "TLS 1.1 y anteriores rechazados"
  verificar '[[ "$(leer_env COOKIE_SECURE)" == true ]]' "cookie de sesión con la marca Secure (COOKIE_SECURE=true)"
  echo | timeout 5 openssl s_client -connect 127.0.0.1:443 -servername "$FQDN" 2>/dev/null \
    | openssl x509 -noout -subject -issuer -enddate | sed 's/^/          /'
fi

resumen
