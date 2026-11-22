# Guía de sustentación y retos

Todo lo de esta guía funciona igual en local y en la EC2. En la EC2 no hay SSH: se entra por la
consola de AWS → EC2 → la instancia → **Connect → Session Manager → Connect**, y luego
`sudo -i` y `cd /opt/entregasegura` (como root no hace falta anteponer `sudo`).

## Atajos para la terminal

```bash
cd /opt/entregasegura            # en la EC2 (en local: la carpeta del repo)
source <(grep -E '^(ADMIN|DEMO)_PASSWORD=' .env)   # carga las contraseñas en la sesión (EC2: sudo -s antes)
B=http://localhost               # o http://entregasegura-uptc.duckdns.org desde tu PC

# Iniciar sesión como alguien (guarda la cookie en /tmp/<usuario>.jar)
entrar() { curl -s -c /tmp/$1.jar -H 'Content-Type: application/json' \
  -d "{\"username\":\"$1\",\"password\":\"$2\"}" $B/api/auth/login; echo; }
entrar admin "$ADMIN_PASSWORD"; entrar doc_ramirez "$DEMO_PASSWORD"; entrar est_ana "$DEMO_PASSWORD"

# Hacer una petición como alguien, mostrando el código HTTP
como() { u=$1; shift; curl -s -w '  -> HTTP %{http_code}\n' -b /tmp/$u.jar "$@"; }
como est_ana $B/api/admin/usuarios          # -> 403

# Entrar a la base de datos
docker compose exec db psql -U postgres -d entregasegura
```

## Checklist docente (14 puntos, 30–60 s cada uno)

| # | Punto | Qué mostrar y decir | Comando |
|---|---|---|---|
| 1 | Despliegue | La app en `http://entregasegura-uptc.duckdns.org` (DuckDNS sigue a la IP pública en cada arranque); en la consola EC2: región `us-east-1`, tipo `t3.small` | `curl http://entregasegura-uptc.duckdns.org/api/health` |
| 2 | Contenedores | 4 servicios y el papel de cada uno | `docker compose ps` |
| 3 | Linux y procesos | SO, servicio Docker, procesos dentro del worker (corren como `node`, no root) | `cat /etc/os-release` · `systemctl status docker` · `docker top entregasegura-worker-1` |
| 4 | Recursos | **Interpretar un dato**: «el worker usa X MB de 256 MB; en la prueba de carga tocó el techo de 50 % de CPU, que es su límite de 0.5 CPU» | `docker stats --no-stream` · `free -h` · `df -h` |
| 5 | Usuarios | Login con estudiante y docente | Dos ventanas (una de incógnito) |
| 6 | Autorización | Docente crea actividad ✅ · estudiante intenta lo mismo ❌ 403 | UI · `./scripts/prueba_funcional.sh` (sección 3) |
| 7 | Aislamiento | Estudiante B pide el ID de la entrega de A → 404 (no 403: no confirmamos que exista) | `./scripts/prueba_aislamiento.sh` |
| 8 | Procesamiento | Subir un archivo y ver `pendiente → en_ejecucion → completado` | UI + `docker compose logs -f worker` |
| 9 | Persistencia | Reiniciar BD y worker; los datos siguen | `docker compose restart db worker` · `./scripts/prueba_persistencia.sh` |
| 10 | Hardening | Sin root, solo lectura, sin capabilities, `.env` 600 | `./scripts/verificar_hardening.sh` · `ls -l .env` |
| 11 | Red | **Solo el 80 abierto** en el Security Group; el 22 cerrado porque se administra con Session Manager; BD y worker en red `internal` sin salida | Security Group · `ss -tulpn` · `ufw status` · `./scripts/verificar_hardening.sh` (sección 5) |
| 12 | Auditoría | Usuario, acción, recurso, resultado, IP y fecha | Pestaña *Auditoría* del admin, o `SELECT ts, username, accion, resultado, ip FROM audit_log ORDER BY ts DESC LIMIT 10;` |
| 13 | Autenticidad | RN-1 en vivo: cierre, 403, prórroga, 201 | `./scripts/demo_rn1.sh` o botón «Crear (cierra en 1 minuto)» en la UI |
| 14 | Repositorio | Dockerfiles, compose, `.env.example`, ningún secreto versionado (revisa **todo el historial**, no solo los archivos actuales) | GitHub · `./scripts/buscar_secretos.sh` |

### Preguntas que el jurado suele hacer (y la respuesta corta)

- **¿Por qué la cola está en PostgreSQL y no en Redis?** El estado del trabajo y la cola son la misma
  fila: no puede pasar que Redis diga «procesado» y la BD diga «pendiente». Además es un contenedor
  menos en 2 GB de RAM. `FOR UPDATE SKIP LOCKED` hace que dos workers nunca tomen el mismo trabajo.
  *En contra:* no escala a miles de trabajos por segundo; se mitiga con `LISTEN/NOTIFY` más un sondeo cada 3 s.
- **¿Por qué 404 y no 403 ante una entrega ajena?** Un 403 confirma que el ID existe y permite
  enumerar. El intento sí se registra como `DENEGADO`.
- **¿Los UUID son la protección?** No. Eso sería seguridad por oscuridad. La protección es
  `esDuenoDeEntrega()` en `scope.js`.
- **¿Por qué el admin no puede leer las entregas?** Separación de funciones: quien administra la
  infraestructura no necesita ver los datos académicos. Mínimo privilegio aplicado al propio admin.
- **¿El usuario `entregas` está en el grupo docker?** No: pertenecer al grupo `docker` equivale a ser
  root en el host. El despliegue lo hace el admin con `sudo`; los procesos de la app corren como
  `node` (uid 1000) dentro de contenedores sin capabilities. Rootless Docker queda como mejora futura.
- **¿Puede la aplicación borrar su rastro?** No. `app_api` solo tiene `INSERT` y `SELECT` en
  `audit_log`, y un trigger bloquea `UPDATE`/`DELETE` incluso al superusuario (`verificar_hardening.sh`, sección 6).
- **¿Cómo administran el servidor si el 22 está cerrado?** Con AWS Systems Manager: el agente de la
  instancia sale hacia la API de AWS por HTTPS, así que no hay ningún puerto de administración
  abierto a Internet. Además funciona desde cualquier red (el ISP del equipo cambia de IP en cada
  conexión, y una regla "solo mi IP" fallaba). `sshd` sigue endurecido como acceso de emergencia.
- **¿Qué es IMDSv2 y por qué lo activaron?** El servicio de metadatos de la EC2 entrega credenciales
  temporales. Con IMDSv2 obligatorio hace falta un token previo, así que una vulnerabilidad SSRF en
  la app no basta para robarlas.
- **¿ufw protege los puertos de Docker?** No: Docker escribe sus propias reglas de iptables y las
  salta. Por eso el Security Group es la capa principal y el compose publica un solo puerto.

## Los 6 retos sorpresa

Meta: cada uno en **menos de 5 minutos, sin mirar notas**. Si no sale, explicar qué se intentó,
dónde está el problema y cómo se resolvería: eso también se evalúa.

### Reto 1 · Nuevo usuario

```bash
como admin -H 'Content-Type: application/json' \
  -d '{"username":"est_prueba","nombre":"Estudiante de prueba","password":"ClaveSegura2026","rol":"estudiante"}' \
  $B/api/admin/usuarios                              # -> 201
entrar est_prueba ClaveSegura2026                    # -> 200
como est_prueba $B/api/admin/usuarios                # -> 403
```
También se puede hacer desde la pestaña *Usuarios* del admin. En la auditoría aparecen `usuario:crear`
(PERMITIDO) y el intento del nuevo usuario (DENEGADO).

### Reto 2 · Cambio de permisos

Ejemplo: «que el docente pueda ver el estado del sistema».
1. En [api/src/permissions.js](../api/src/permissions.js), añadir `'sistema:estado',` a la lista `docente` (no a `estudiante`).
2. `docker compose up -d --build api`
3. Verificar:
```bash
entrar doc_ramirez "$DEMO_PASSWORD"; entrar est_ana "$DEMO_PASSWORD"   # el reinicio no invalida sesiones, pero así es seguro
como doc_ramirez $B/api/admin/estado     # -> 200
como est_ana $B/api/admin/estado         # -> 403
```

### Reto 3 · Aislamiento

Si el docente rompe o quita la comprobación de propiedad, se restaura en
[api/src/middleware/scope.js](../api/src/middleware/scope.js):
```js
function esDuenoDeEntrega(user, entrega) {
  return user.rol === 'estudiante' && entrega.student_id === user.id;
}
```
Luego `docker compose up -d --build api` y `./scripts/prueba_aislamiento.sh` (todo en 404).

### Reto 4 · Recursos

1. En [docker-compose.yml](../docker-compose.yml), servicio `worker`, cambiar por ejemplo a
   `limits: { cpus: "0.25", memory: 128M, pids: 100 }`.
2. `docker compose up -d worker` (recrea solo el worker).
3. Verificar:
```bash
docker inspect entregasegura-worker-1 --format 'Mem={{.HostConfig.Memory}} CPU={{.HostConfig.NanoCpus}}'
# Mem=134217728 (128 MB) CPU=250000000 (0.25 CPU)
docker stats --no-stream entregasegura-worker-1      # la columna LIMIT muestra 128MiB
```
Interpretación: con 0.25 CPU la prueba de carga tardará aproximadamente el doble (el worker es CPU-bound).

### Reto 5 · Recuperación

```bash
docker compose stop worker
# subir 3 archivos desde la UI (o con el script): quedan en "pendiente"
docker compose start worker
docker compose logs -f worker      # se ven "trabajo reclamado" y "trabajo completado"
```
Automático y con los tres escenarios (incluido `kill -9`): `./scripts/prueba_recuperacion.sh`.

### Reto 6 · Auditoría

Ejemplo: «auditar cada vez que alguien consulta los metadatos de una entrega».
En [api/src/routes/entregas.js](../api/src/routes/entregas.js), ruta `GET /:id`, antes del `return res.json(...)`:
```js
  await audit(req, 'entrega:metadatos', rec(e.id), 'PERMITIDO');
```
`docker compose up -d --build api`, consultar una entrega y verificar:
```sql
SELECT ts, username, accion, recurso_id, resultado FROM audit_log
 WHERE accion = 'entrega:metadatos' ORDER BY ts DESC LIMIT 5;
```

## Comandos que todos deben saber de memoria

```bash
docker compose ps | logs -f <svc> | restart <svc> | up -d --build <svc> | exec <svc> sh
docker stats --no-stream ; docker inspect <contenedor>
psql: \dt  \du  \dp audit_log  SELECT * FROM audit_log ORDER BY ts DESC LIMIT 5;
sudo ss -tulpn ; sudo ufw status ; free -h ; df -h ; systemctl status docker
```
