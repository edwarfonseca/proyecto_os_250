# EntregaSegura

Plataforma segura de recepción y análisis automático de entregas académicas para la
**Corporación Educativa Altiplano (CEA)**, una institución ficticia.
Proyecto final de Sistemas Operativos · UPTC Seccional Sogamoso · 2026.

Los estudiantes suben trabajos en texto (`.txt`, `.md`, `.csv`, `.json`, máx. 5 MB). Un
worker en segundo plano calcula la huella SHA-256, las estadísticas del texto y detecta
entregas idénticas. Los docentes revisan las entregas de sus cursos. Ningún estudiante
puede ver el trabajo de otro, y nadie entrega después del cierre sin una prórroga auditada.

## Arquitectura

```
Internet ──:80──► proxy (Nginx sin privilegios) ──► api (Node/Express) ──► db (PostgreSQL 16)
                  único puerto publicado             │                        ▲
                                                     └──► volumen files ◄── worker (Node)
                  red "edge"                         red "internal" (sin salida a Internet)
```

| Servicio | Imagen | Función | Límites |
|---|---|---|---|
| `proxy` | `nginxinc/nginx-unprivileged:stable-alpine` | Frontend estático, reverse proxy, límite de 5 MB, cabeceras de seguridad | 0.25 CPU · 64 MB |
| `api` | `node:22-alpine` | Autenticación, autorización (RBAC + alcance), subidas, auditoría | 0.50 CPU · 256 MB |
| `worker` | `node:22-alpine` | Cola en PostgreSQL con `FOR UPDATE SKIP LOCKED`, análisis, reintentos y recuperación | 0.50 CPU · 256 MB |
| `db` | `postgres:16-alpine` | Usuarios, cursos, entregas, cola de trabajos y auditoría append-only | 0.50 CPU · 384 MB |

El detalle (decisiones D1–D6, modelo de datos y costos) está en [docs/ROADMAP.md](docs/ROADMAP.md).
El diagrama está en [docs/diagrama/arquitectura.md](docs/diagrama/arquitectura.md).

## Levantarlo desde cero (local)

Requisitos: Docker con Compose v2, Python 3 (solo para generar el dataset) y `curl`.

```bash
git clone <url-del-repo> entregasegura && cd entregasegura
./scripts/generar_env.sh        # crea .env con contraseñas aleatorias (permisos 600) y las muestra
docker compose up -d --build    # construye y levanta los 4 servicios
docker compose ps               # los 4 deben aparecer "healthy" (tarda ~30 s)
curl http://localhost/api/health
```

Abre <http://localhost> en el navegador. Si el puerto 80 está ocupado, cambia `HTTP_PORT` en `.env`.

### Usuarios de demostración

Se crean solos al primer arranque (`SEED_DEMO=true`). Las contraseñas están en tu `.env`:
`ADMIN_PASSWORD` para `admin` y `DEMO_PASSWORD` para todos los demás.

| Usuario | Rol | Cursos |
|---|---|---|
| `admin` | Administrador TI | — (gestiona todo, **no ve contenidos**) |
| `doc_ramirez` | Docente | SO-101 Sistemas Operativos |
| `doc_torres` | Docente | BD-201 Bases de Datos |
| `est_ana`, `est_bruno` | Estudiante | SO-101 |
| `est_carla` | Estudiante | SO-101 y BD-201 |
| `est_diego` | Estudiante | BD-201 |

## Pruebas (todas guardan su salida en `docs/evidencias/`)

| Script | Qué demuestra |
|---|---|
| `./scripts/prueba_funcional.sh` | Login de los 3 roles, RBAC, subida, ciclo `pendiente → en_ejecucion → completado`, descarga, validación en 3 capas (413, 415, `fallido`), duplicados y reprocesar |
| `./scripts/prueba_aislamiento.sh` | Estudiante B y docente de otro curso reciben 404 sobre la entrega de A; el admin recibe 403 al contenido; todo queda `DENEGADO` en la auditoría |
| `./scripts/demo_rn1.sh` | La regla de negocio RN-1 en vivo: cierre, 403, prórroga y 201 (≈ 1,5 min) |
| `./scripts/prueba_carga.sh 1` y `... 2` | 5 estudiantes × 10 entregas = 50 trabajos con concurrencia 1 y 2: tiempos y pico de CPU/RAM del worker |
| `./scripts/prueba_recuperacion.sh` | Worker detenido, apagado ordenado y `kill -9` a mitad de un trabajo: nada se pierde |
| `./scripts/prueba_persistencia.sh` | `docker compose down` + `up -d`: los datos siguen ahí |
| `./scripts/verificar_hardening.sh` | Sin root, solo lectura, sin capabilities, límites, red aislada, auditoría inmutable, `.env` 600 |
| `./scripts/buscar_secretos.sh` | Que ningún `.env`, llave ni valor real del `.env` esté en **todo** el historial de git |

En la EC2 se ejecutan con `sudo` (el usuario de servicio no pertenece al grupo `docker`).
Los resultados interpretados están en [docs/resultados-pruebas.md](docs/resultados-pruebas.md).

## Seguridad: dónde está cada cosa

| Tema | Archivo |
|---|---|
| Matriz de permisos (única fuente de verdad) | [api/src/permissions.js](api/src/permissions.js) · [docs/matriz-permisos.md](docs/matriz-permisos.md) |
| Comprobación de propiedad y alcance (404 ante recursos ajenos) | [api/src/middleware/scope.js](api/src/middleware/scope.js) |
| Regla de negocio RN-1 | [api/src/middleware/rn1.js](api/src/middleware/rn1.js) |
| Auditoría (una sola función) | [api/src/audit.js](api/src/audit.js) |
| Roles de BD con mínimo privilegio y `audit_log` append-only | [db/migrations/002_roles_grants.sql](db/migrations/002_roles_grants.sql) |
| Validación de archivos | [proxy/nginx.conf](proxy/nginx.conf) · [api/src/upload.js](api/src/upload.js) · [worker/src/processors/analizar.js](worker/src/processors/analizar.js) |
| Hardening de contenedores | [docker-compose.yml](docker-compose.yml) (`x-hardened`) |
| Hardening del host | [infra/hardening_host.sh](infra/hardening_host.sh) · [infra/security-group.md](infra/security-group.md) |

Contraseñas con argon2id · JWT de 1 h en cookie `HttpOnly` + `SameSite=Strict` · rate limit de
5 intentos fallidos por minuto en el login · `helmet` y CSP estricta · IDs UUID (pero la defensa
real es la comprobación de propiedad, no el UUID).

## Operación

```bash
docker compose ps                         # estado
docker compose logs -f worker             # ver el procesamiento en vivo
docker compose restart api                # reiniciar un servicio
docker compose up -d --build api          # aplicar un cambio de código (p. ej. permissions.js)
docker stats --no-stream                  # CPU y RAM de cada contenedor
./scripts/backup_db.sh                    # respaldo de la BD y de los archivos en backups/
```

**Empezar con datos limpios** (borra TODO: usuarios, entregas y auditoría):
`docker compose down -v && docker compose up -d`.

## Despliegue en AWS

Paso a paso en [docs/DESPLIEGUE_AWS.md](docs/DESPLIEGUE_AWS.md). En resumen: una sola EC2
`t3.small` con Ubuntu 24.04, `sudo bash infra/hardening_host.sh` y `sudo ./scripts/deploy.sh`.

## Estructura

```
api/        API (Express 5): src/{app,permissions,audit,upload,seed}.js, middleware/, routes/
worker/     Worker: src/index.js, queue.js, processors/analizar.js
proxy/      Nginx + frontend estático (HTML y JS sin compilación)
db/         migrations/ (esquema, roles y grants, contraseñas de los roles)
dataset/    archivos de prueba + DATASET.md (se regeneran con scripts/generar_dataset.sh)
scripts/    pruebas, despliegue, respaldo y utilidades
infra/      hardening del host y Security Group
docs/       roadmap, matriz de permisos, guía de sustentación, costos y evidencias
```
