#!/usr/bin/env bash
# =====================================================================
# Respaldo: volcado de PostgreSQL (pg_dump) + archivos del volumen "files".
# Deja todo en backups/ (excluido de git: contiene hashes de contraseñas).
# Uso:  ./scripts/backup_db.sh          (en la EC2: sudo ./scripts/backup_db.sh)
# Para copiarlo a tu PC desde la EC2:
#   scp -i labsuser.pem ubuntu@<IP>:/opt/entregasegura/backups/* .
# =====================================================================
set -euo pipefail
source "$(dirname "$0")/lib.sh"
DBNAME="$(leer_env POSTGRES_DB)"
FECHA="$(date +%Y%m%d_%H%M%S)"
umask 077
mkdir -p "$RAIZ/backups"

$DC exec -T db pg_dump -U postgres -d "$DBNAME" --no-owner | gzip > "$RAIZ/backups/db_${FECHA}.sql.gz"
$DOCKER run --rm -v entregasegura_files:/data:ro alpine tar czf - -C /data . > "$RAIZ/backups/files_${FECHA}.tar.gz"

ls -lh "$RAIZ/backups/"*"${FECHA}"*
echo
echo "Para restaurar la base de datos (¡reemplaza los datos actuales!):"
echo "  gunzip -c backups/db_${FECHA}.sql.gz | docker compose exec -T db psql -U postgres -d $DBNAME"
