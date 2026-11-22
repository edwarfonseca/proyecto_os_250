# Roadmap · Proyecto Final de Sistemas Operativos
## Plataforma segura de procesamiento en la nube · Caso: Gestión Académica

> Docente: Mgtr. Fredy Alarcón · UPTC Seccional Sogamoso · 2026
> Fecha de sustentación: `____ / ____ / 2026` ← complétala y ajusta los días de cada fase hacia atrás.

---

## Índice

0. [Reglas de oro del presupuesto AWS](#0-reglas-de-oro-del-presupuesto-aws)
1. [El caso: identidad, roles y regla de negocio](#1-el-caso-identidad-roles-y-regla-de-negocio)
2. [Arquitectura objetivo y decisiones técnicas](#2-arquitectura-objetivo-y-decisiones-técnicas)
3. [Plan por fases (paso a paso)](#3-plan-por-fases-paso-a-paso)
4. [Plan de costos detallado](#4-plan-de-costos-detallado)
5. [Mapa: requisito → dónde se cumple](#5-mapa-requisito--dónde-se-cumple)
6. [Preparación de los retos sorpresa](#6-preparación-de-los-retos-sorpresa)
7. [Anexos](#7-anexos)

---

## 0. Reglas de oro del presupuesto AWS

Partes de **≈ 49 USD disponibles** (50 − 1 ya gastado). La meta es que el proyecto completo cueste **menos de 6 USD** y poner un **tope duro de 10 USD**. El resto queda para otros laboratorios y para practicar para la certificación.

La estrategia se resume en una frase: **todo se desarrolla en local con Docker Compose (0 USD) y AWS solo se usa para desplegar, probar y sustentar.**

| # | Regla | Por qué |
|---|-------|---------|
| 1 | **Una sola instancia EC2 `t3.small`** para todo el proyecto, y **solo en tu cuenta**. Tus compañeros trabajan en local. | Cada instancia extra cobra cómputo, disco e IP pública. |
| 2 | **Apaga la instancia manualmente** (EC2 → Stop) al terminar cada sesión de trabajo. | En el Learner Lab, una instancia que sigue *running* cuando termina la sesión **se vuelve a encender sola** al iniciar la siguiente sesión. Así, si abres el lab para otra materia, te cobraría sin que te des cuenta. |
| 3 | Al lanzar la instancia, configura **Credit specification = Standard** (no *Unlimited*). | Las `t3` vienen en modo *Unlimited* y cobran CPU extra si superan su línea base durante mucho tiempo, que es justo lo que pasa en la prueba de carga. |
| 4 | **Nada de servicios administrados caros**: RDS, NAT Gateway, Load Balancer (ALB/NLB), EKS/ECS, ElastiCache ni SageMaker. | PostgreSQL, el proxy y la cola corren en contenedores dentro de la misma EC2. Un NAT Gateway o un ALB pueden costar más que todo el proyecto. |
| 5 | **No uses Elastic IP durante el desarrollo.** Asígnala solo 2–3 días antes de sustentar y libérala justo después. | Una IP elástica cobra aunque la instancia esté apagada. |
| 6 | Disco **gp3 de 16 GB**, sin snapshots automáticos. Haz **un solo** snapshot manual de la versión candidata. | El EBS cobra 24/7, incluso con la instancia apagada. |
| 7 | **Construye las imágenes en la propia EC2** (`docker compose build`). No uses ECR. | Evitas pagar almacenamiento de imágenes. |
| 8 | **Rotación de logs de Docker** (`max-size: 10m`, `max-file: 3`). No uses CloudWatch Logs. | Los logs sin rotación llenan el disco, y CloudWatch cobra por ingesta. |
| 9 | Región **us-east-1** únicamente. | Así no olvidas recursos en otra región. |
| 10 | Registra cada sesión en `docs/COSTOS.md` (plantilla en el anexo). | El saldo del Learner Lab **no se actualiza en tiempo real** (viene de AWS Budgets con retraso), así que tu bitácora es la alerta temprana. |

**Semáforo de presupuesto** (revísalo al inicio de cada sesión en el panel del lab):

| Gasto acumulado del proyecto | Acción |
|---|---|
| < 4 USD | 🟢 Normal |
| 4 – 7 USD | 🟡 Revisa qué está corriendo (Fase 0.2) y reduce las horas en la nube |
| > 7 USD | 🔴 Para y audita recursos. Algo está cobrando de más |

---

## 1. El caso: identidad, roles y regla de negocio

### 1.1 Identidad del caso (sello de autenticidad)

- **Organización ficticia:** *Corporación Educativa Altiplano (CEA)*, una institución de educación técnica con 3 programas.
- **Plataforma:** **EntregaSegura**, para la recepción y el análisis automático de entregas académicas.
- **Necesidad concreta:** los estudiantes entregan trabajos en archivos de texto (informes, código, datos CSV). Los docentes necesitan recibirlos con hora certificada, obtener un análisis automático (huella SHA-256, estadísticas y detección de entregas idénticas) y tener la garantía de que **ningún estudiante vea el trabajo de otro** ni pueda modificar una entrega después del cierre.
- **Incidentes previos (motivación):** un estudiante descargó la entrega de un compañero cambiando el ID en la URL, se subieron entregas fuera de plazo sin dejar rastro y un archivo enorme saturó el servidor.

### 1.2 Roles (los tres niveles obligatorios)

| Rol del enunciado | Rol en EntregaSegura | Perfil |
|---|---|---|
| Administrador | **Administrador TI** | Gestiona usuarios, roles, cursos y matrículas, supervisa servicios y consulta la auditoría. |
| Operador | **Docente** | Crea actividades con fecha límite en *sus* cursos, revisa entregas, otorga prórrogas y reprocesa trabajos fallidos. |
| Usuario | **Estudiante** | Sube entregas a actividades de los cursos en que está matriculado y consulta sus propios resultados. |

> **Decisión de diseño (defiéndela en la sustentación):** el Administrador TI **no puede leer el contenido de las entregas**. Solo ve metadatos y auditoría. Es *separación de funciones*: quien administra la infraestructura no necesita ver los datos académicos. Esto demuestra mínimo privilegio aplicado al propio administrador, que es el punto donde la mayoría de grupos falla.

### 1.3 Matriz de permisos

| Acción | Admin TI | Docente | Estudiante |
|---|:---:|:---:|:---:|
| Crear y desactivar usuarios, asignar rol | ✅ | ❌ | ❌ |
| Crear cursos, asignar docente, matricular | ✅ | ❌ | ❌ |
| Crear una actividad con fecha límite | ❌ | ✅ *(sus cursos)* | ❌ |
| Subir una entrega | ❌ | ❌ | ✅ *(regla RN-1)* |
| Eliminar o reemplazar una entrega propia | ❌ | ❌ | ✅ *(solo antes del cierre)* |
| Ver y descargar una entrega y su resultado | ❌ *(solo metadatos)* | ✅ *(sus cursos)* | ✅ *(solo las propias)* |
| Otorgar prórroga | ❌ | ✅ *(sus cursos)* | ❌ |
| Reprocesar un trabajo fallido | ✅ | ✅ *(sus cursos)* | ❌ |
| Ver la auditoría completa | ✅ | ❌ | ❌ |
| Ver la trazabilidad de una entrega | ✅ | ✅ *(sus cursos)* | ❌ |
| Ver el estado de servicios y de la cola | ✅ | ❌ | ❌ |

### 1.4 Regla de negocio propia (la que el docente aprueba)

> **RN-1 · Cierre de entregas con prórroga auditada**
> Un estudiante solo puede subir, reemplazar o eliminar una entrega si **(a)** está matriculado en el curso de la actividad y **(b)** la fecha límite no ha pasado. Pasado el cierre, el servidor rechaza la operación (HTTP 403) y la registra como `DENEGADO` en la auditoría. La única excepción es una **prórroga individual** que otorga el docente *de ese curso* a *ese estudiante* con una nueva fecha límite. La prórroga también queda auditada (quién la dio, a quién y hasta cuándo).

**Cómo se comprueba en vivo (30 s):** se crea una actividad que cierra en 1 minuto, se espera, el estudiante intenta subir y recibe 403. El docente otorga una prórroga, el estudiante vuelve a subir y recibe 201. Al final se muestran los tres eventos en la auditoría.

**Regla complementaria (elemento de procesamiento):** si dos entregas de la *misma actividad* tienen el mismo SHA-256, el resultado se marca como `posible_duplicado`. **Solo el docente** ve esa marca.

### 1.5 Elemento de auditoría propio

1. Tabla `audit_log` **append-only**: el rol de BD de la aplicación tiene `INSERT` y `SELECT`, pero **no** `UPDATE` ni `DELETE`, así que ni la aplicación puede borrar su propio rastro.
2. **Reporte de trazabilidad por entrega**: la línea de tiempo completa de una entrega (subida, encolado, procesamiento, descargas, intentos denegados y prórrogas) con usuario, acción, IP y fecha.
3. **Reporte de accesos denegados** para el Admin: todos los intentos `DENEGADO` agrupados por usuario. Sirve para detectar a alguien probando IDs ajenos.

---

## 2. Arquitectura objetivo y decisiones técnicas

### 2.1 Diagrama lógico

```
                     Internet
                        │  :80 (y :443 opcional)
          ┌─────────────▼──────────────────────────────────────────┐
          │ AWS us-east-1 · VPC por defecto · Security Group        │
          │ EC2 t3.small · Ubuntu Server 24.04 LTS · EBS gp3 16 GB  │
          │                                                         │
          │  Docker Engine                                          │
          │  ┌────────── red "edge" ───────────┐                    │
          │  │  proxy (nginx-unprivileged)     │  ← único puerto    │
          │  │  sirve el frontend estático     │    publicado       │
          │  │  y hace reverse proxy a /api ──►│ api (Node/Express) │
          │  └─────────────────────────────────┘     │              │
          │  ┌────────── red "internal" (internal: true, sin salida)┐│
          │  │  api ──► db (PostgreSQL 16) ◄── worker (Node)        ││
          │  │   │        cola de trabajos         │                ││
          │  │   └──► volumen "files" ◄────────────┘                ││
          │  │        /data/originales/<user>/  /data/resultados/   ││
          │  │   volumen "pgdata"                                   ││
          │  └──────────────────────────────────────────────────────┘│
          └─────────────────────────────────────────────────────────┘
```

### 2.2 Servicios (4 contenedores)

| Servicio | Imagen base | Función | Puertos | Límites |
|---|---|---|---|---|
| `proxy` | `nginxinc/nginx-unprivileged:alpine` | Frontend estático, reverse proxy, límite de tamaño del body, cabeceras de seguridad | `80:8080` (el **único** publicado) | 0.25 CPU · 64 MB |
| `api` | `node:22-alpine` | Autenticación, autorización, subida, consultas y auditoría | ninguno (solo red interna) | 0.50 CPU · 256 MB |
| `worker` | `node:22-alpine` | Toma trabajos de la cola, los procesa y guarda resultados | ninguno | **0.50 CPU · 256 MB** (el límite que se explica en la sustentación) |
| `db` | `postgres:16-alpine` | Usuarios, cursos, entregas, cola y auditoría | ninguno | 0.50 CPU · 384 MB |

En total quedan menos de 1 GB reservado sobre los 2 GB de la `t3.small`, lo que deja margen para el sistema operativo y para Docker.

### 2.3 Decisiones técnicas y criterio crítico

**D1 · Decisión de arquitectura del sello: cola de trabajos en PostgreSQL con `FOR UPDATE SKIP LOCKED` (en lugar de Redis + BullMQ)**

```sql
-- El worker reclama un trabajo de forma atómica; dos workers nunca toman el mismo
UPDATE jobs SET estado = 'en_ejecucion', iniciado_en = now(), intentos = intentos + 1
WHERE id = (
  SELECT id FROM jobs
  WHERE estado = 'pendiente'
  ORDER BY creado_en
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *;
```
- **A favor:** el estado del trabajo y la cola son *la misma fila*, así que no hay inconsistencia del tipo "Redis dice procesado pero la BD dice pendiente". Además hay un contenedor menos (≈100 MB de RAM menos en una instancia de 2 GB), las transacciones ACID son gratis y los estados se consultan con SQL para la auditoría.
- **En contra (dilo tú antes que el jurado):** no escala a miles de trabajos por segundo y el *polling* genera carga. Se mitiga con `LISTEN/NOTIFY` para despertar al worker y un sondeo de respaldo cada 3 s.
- **Alternativa descartada:** Redis + BullMQ. Es mejor a gran escala, pero para este volumen añade un servicio, memoria y un segundo lugar donde vive el estado.

**D2 · Almacenamiento: volumen Docker en EBS (no S3)**
- Los archivos se guardan como `/data/originales/<user_id>/<uuid>.<ext>`. **El nombre original del usuario nunca se usa como ruta** (se guarda solo en la BD), lo que evita *path traversal*.
- Para defenderla: S3 sería más durable, pero añade credenciales y latencia, y en el Learner Lab el uso de IAM está restringido. Queda documentado como mejora futura.

**D3 · Autorización en dos capas, siempre en el servidor**
1. **RBAC**: `permissions.js` es una matriz `rol → acciones` y el middleware `authorize('entrega:descargar')` la consulta.
2. **Alcance o propiedad (ABAC)**: después del RBAC se comprueba si el recurso pertenece al usuario o si el docente dicta el curso. **La mayoría de los fallos de aislamiento ocurre aquí, no en el RBAC.**
- Ante un recurso ajeno se responde **404, no 403**, para no confirmar que el ID existe (evita enumeración). En la auditoría sí se registra `DENEGADO`.
- Los IDs son UUID, pero **eso no es la defensa** (sería seguridad por oscuridad). La defensa es la comprobación de propiedad. Dilo explícitamente.

**D4 · Contraseñas y sesión**
- `argon2id` (librería `argon2`) o `bcrypt` con coste 12.
- JWT de vida corta (1 h) en una cookie `HttpOnly`, `SameSite=Strict` y `Secure` si hay HTTPS.
- `express-rate-limit` en `/api/auth/login` (5 intentos por minuto) y `helmet` para las cabeceras.

**D5 · Roles de base de datos con mínimo privilegio**

| Rol de BD | Permisos |
|---|---|
| `app_api` | CRUD en tablas de negocio, `INSERT/SELECT` en `audit_log` |
| `app_worker` | `SELECT/UPDATE` en `jobs` y `submissions`, `INSERT` en `audit_log` |
| `postgres` | Solo migraciones. **Nunca** lo usa la aplicación. |

**D6 · Procesamiento (reproducible y observable)**
- **Archivos permitidos:** `.txt`, `.md`, `.csv`, `.json` de **5 MB como máximo**.
- **Validación en tres capas:** Nginx (`client_max_body_size 5m`), la API (extensión, MIME y tamaño) y el worker (UTF-8 válido; si no lo es, el trabajo pasa a `fallido` con el motivo).
- **Resultado (JSON):** SHA-256, líneas, palabras, caracteres, top 10 de palabras, filas y columnas si es CSV, `posible_duplicado` y tiempo de procesamiento en ms.
- **Estados:** `pendiente → en_ejecucion → completado | fallido`, con `CHECK` en la BD.
- **Reintentos y recuperación:** 3 intentos con *backoff*. Al arrancar, el worker devuelve a `pendiente` los trabajos que llevan más de 5 minutos en `en_ejecucion` (o los marca `fallido` si ya agotaron los intentos). Esto es lo que demuestra el Reto 5.

### 2.4 Modelo de datos (resumen)

```
users(id, username UNIQUE, password_hash, rol CHECK IN ('admin','docente','estudiante'), activo, creado_en)
courses(id, codigo, nombre, docente_id → users)
enrollments(course_id, student_id)  PK compuesta
assignments(id, course_id, titulo, fecha_limite)
extensions(assignment_id, student_id, nueva_fecha_limite, otorgada_por, creado_en)
submissions(id UUID, assignment_id, student_id, nombre_original, ruta, tamano, mime, sha256, creado_en)
jobs(id UUID, submission_id, estado CHECK(...), intentos, error, ruta_resultado,
     creado_en, iniciado_en, terminado_en)
audit_log(id BIGSERIAL, ts, user_id, username, rol, accion, recurso_tipo, recurso_id,
          resultado CHECK IN ('PERMITIDO','DENEGADO','ERROR'), ip, detalle JSONB)
```
Índices clave: `jobs(estado, creado_en)` (cola), `submissions(assignment_id, sha256)` (duplicados) y `audit_log(user_id, ts)`.

### 2.5 Estructura del repositorio

```
entregasegura/
├── README.md                 ← cómo levantar todo desde cero (lo evalúan)
├── docker-compose.yml
├── .env.example              ← variables SIN valores reales
├── .gitignore / .dockerignore  ← incluyen .env, *.pem, node_modules
├── proxy/      Dockerfile, nginx.conf, frontend/ (build estático)
├── api/        Dockerfile, src/{app.js, permissions.js, audit.js, db.js,
│               middleware/{auth.js, authorize.js, scope.js}, routes/...}
├── worker/     Dockerfile, src/{index.js, queue.js, processors/...}
├── db/         migrations/001_schema.sql, 002_roles_grants.sql, seed/
├── dataset/    ≥ 5 archivos sintéticos + DATASET.md
├── scripts/    deploy.sh, backup_db.sh, prueba_funcional.sh,
│               prueba_aislamiento.sh, prueba_carga.sh, verificar_hardening.sh
├── infra/      hardening_host.sh, security-group.md
└── docs/       COSTOS.md, matriz-permisos.md, diagrama/, evidencias/
```

---

## 3. Plan por fases (paso a paso)

> Cada fase indica qué hacer, qué demuestra al terminar (**DoD**, *definition of done*), qué ítems del checklist docente cubre y **cuánto cuesta en AWS**. Las fases 1 a 6 son **100 % locales**.

---

### FASE 0 · Preparación y aprobación del caso · *Día 1* · 💰 0 USD

**0.1 Enviar el caso al docente.** Es obligatorio: él aprueba el contexto y la regla. Hay un borrador del mensaje en el Anexo A.

**0.2 Auditar tu cuenta AWS antes de crear nada.** El dólar ya gastado sugiere que puede quedar algo del laboratorio integrador. Desde la terminal del Learner Lab (AWS CLI):
```bash
for r in us-east-1 us-west-2; do
  echo "== $r =="
  aws ec2 describe-instances --region $r --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name]' --output table
  aws ec2 describe-volumes   --region $r --query 'Volumes[].[VolumeId,Size,State]' --output table
  aws ec2 describe-addresses --region $r --query 'Addresses[].[PublicIp,AssociationId]' --output table
  aws ec2 describe-snapshots --region $r --owner-ids self --query 'Snapshots[].[SnapshotId,VolumeSize]' --output table
  aws ec2 describe-nat-gateways --region $r --filter Name=state,Values=available --query 'NatGateways[].NatGatewayId'
  aws elbv2 describe-load-balancers --region $r --query 'LoadBalancers[].LoadBalancerName'
  aws rds describe-db-instances --region $r --query 'DBInstances[].DBInstanceIdentifier'
done
aws s3 ls
```
- Si algo es del laboratorio integrador y todavía lo necesitan, **déjalo apagado** (no *running*).
- Si ya se calificó: **termina la instancia, borra volúmenes huérfanos, libera las EIP y vacía y borra los buckets**.
- Anota el saldo exacto que muestra el panel en `docs/COSTOS.md`.

**0.3 Organizar el equipo.** Crear el repo privado en GitHub y repartir responsables (ver la tabla). **Todos** deben conocer todo, porque los retos son individuales.

| Responsable principal | Área |
|---|---|
| Integrante A | API, autenticación, autorización, auditoría |
| Integrante B | Worker, cola, procesamiento, dataset y pruebas |
| Integrante C | Docker, Nginx, AWS, hardening del host |
| (D si existe) | Frontend mínimo y documentación |

**DoD:** caso enviado o aprobado, cuenta limpia y saldo anotado, repo creado con `.gitignore` que excluye `.env` y `*.pem`.

---

### FASE 1 · Diseño · *Días 1–2* · 💰 0 USD

- [ ] Cerrar la matriz de permisos (§1.3) y pasarla a `docs/matriz-permisos.md`.
- [ ] Escribir `db/migrations/001_schema.sql` con constraints (`CHECK`, `FK`, `UNIQUE`) e índices.
- [ ] Escribir `002_roles_grants.sql` con los roles `app_api` y `app_worker` y `REVOKE UPDATE, DELETE ON audit_log`.
- [ ] Definir el contrato de la API (lista de endpoints con método, ruta, permiso y alcance).
- [ ] Hacer un primer boceto del diagrama (draw.io o Excalidraw, a partir de §2.1).

**DoD:** las migraciones corren sin errores en un PostgreSQL local y hay un endpoint por cada fila de la matriz.

---

### FASE 2 · Esqueleto Docker Compose local · *Días 2–3* · 💰 0 USD

- [ ] `docker-compose.yml` con los 4 servicios, las redes `edge` e `internal` (`internal: true`) y los volúmenes `pgdata` y `files`.
- [ ] Dockerfiles *multi-stage* con `USER node` (no root) y `npm ci --omit=dev`.
- [ ] Endpoints `/api/health` en la API y *healthchecks* en todos los servicios.
- [ ] `restart: unless-stopped` y rotación de logs en todos los servicios:
  ```yaml
  x-logging: &logging
    driver: json-file
    options: { max-size: "10m", max-file: "3" }
  ```
- [ ] Solo `proxy` tiene `ports:`. `db` **no** publica el 5432.

**DoD:** `docker compose up -d` levanta todo, `curl localhost/api/health` responde OK y `docker compose ps` muestra 4 servicios *healthy*.
**Checklist cubierto:** Contenedores, Red (en parte).

---

### FASE 3 · Usuarios, autenticación y autorización · *Días 3–5* · 💰 0 USD

- [ ] Registro de usuarios **solo por el Admin**, login, logout y hash `argon2id`.
- [ ] Script de *seed* que crea las cuentas demo leyendo contraseñas desde `.env` (nunca escritas en el código).
- [ ] `permissions.js` como la **única fuente de verdad** de la matriz, más el middleware `authorize(accion)`.
- [ ] Middleware `scope.js` con `esDuenoDeEntrega`, `esDocenteDelCurso` y `estaMatriculado`.
- [ ] Rate limit en el login y `helmet`.
- [ ] `audit.js` con una sola función `audit(req, accion, recurso, resultado, detalle)`, llamada en **todos** los permitidos y denegados importantes.

**Datos demo:** 1 admin, 2 docentes, 4 estudiantes, 2 cursos, 2 actividades.

**DoD:** un script con `curl` demuestra que (1) un estudiante recibe 403 en `/api/admin/usuarios`, (2) un docente recibe 404 en una entrega de un curso que no dicta y (3) ambos quedan en `audit_log` como `DENEGADO`.
**Checklist cubierto:** Usuarios, Autorización, Auditoría (en parte).

---

### FASE 4 · Archivos, cola y worker · *Días 5–8* · 💰 0 USD

- [ ] `POST /api/actividades/:id/entregas` con `multer` (límite 5 MB), validación de extensión y MIME, nombre UUID, inserción de `submission` y `job` **en una sola transacción** y luego `NOTIFY nuevo_trabajo`.
- [ ] Worker con `LISTEN`, *polling* de respaldo, reclamo con `SKIP LOCKED`, procesador, resultado JSON en `/data/resultados/<user>/<job>.json` y transición de estados.
- [ ] Recuperación al arrancar (trabajos colgados), reintentos y estado `fallido` con el motivo.
- [ ] Concurrencia configurable con `WORKER_CONCURRENCY` (se usa en la prueba de carga).
- [ ] `GET /api/entregas/:id` (estado) y `GET /api/entregas/:id/resultado` (descarga), ambos con comprobación de alcance.
- [ ] Logs estructurados con `pino` a stdout: `job_id`, `estado`, `ms` y `error`.

**DoD:** subir un archivo, ver `pendiente → en_ejecucion → completado` y descargar el resultado. Un `.exe` renombrado a `.txt` con bytes no UTF-8 termina en `fallido` con su motivo.
**Checklist cubierto:** Procesamiento, Persistencia (en parte).

---

### FASE 5 · Regla de negocio, auditoría y frontend mínimo · *Días 8–10* · 💰 0 USD

- [ ] RN-1 completa: verificación de matrícula, fecha límite y prórroga en el servidor. Endpoint `POST /api/actividades/:id/prorrogas` para el docente del curso.
- [ ] Detección de duplicados por SHA-256 en la misma actividad, visible solo para el docente.
- [ ] Reportes: trazabilidad por entrega y accesos denegados.
- [ ] **Frontend mínimo** (React + Vite compilado a estático y servido por Nginx) con 5 pantallas: login, mis entregas (estudiante), entregas del curso (docente), usuarios y cursos (admin) y auditoría y estado (admin). *La interfaz no da nota: que sea funcional, no bonita.*

**DoD:** la demostración de RN-1 de §1.4 funciona de principio a fin en local.
**Checklist cubierto:** Autenticidad, Auditoría.

---

### FASE 6 · Hardening de contenedores y observabilidad local · *Días 10–11* · 💰 0 USD

- [ ] En `api` y `worker`: `read_only: true` con `tmpfs: /tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]` y `pids_limit: 100`.
- [ ] Límites `deploy.resources.limits` en todos los servicios (§2.2), con el del worker documentado.
- [ ] Endpoint `/api/admin/estado` con conteo de trabajos por estado, tiempo medio de procesamiento y último error.
- [ ] Script `scripts/verificar_hardening.sh` que imprime evidencias:
  ```bash
  docker compose exec api id              # uid≠0
  docker compose exec worker id
  docker inspect --format '{{.Name}} RO={{.HostConfig.ReadonlyRootfs}} Caps={{.HostConfig.CapDrop}} Mem={{.HostConfig.Memory}} CPU={{.HostConfig.NanoCpus}}' $(docker compose ps -q)
  docker compose ps --format 'table {{.Name}}\t{{.Ports}}'
  ```
- [ ] **Congelar la versión candidata local** con un tag de git `v0.9-local`.

**DoD:** todo funciona con el hardening activo (es normal que algo falle por `read_only` al principio, así que esta fase existe para corregirlo en local, gratis).

---

### FASE 7 · Despliegue en AWS y hardening del host · *Días 11–12* · 💰 ≈ 0.30 USD

> Primera vez que gastas. Ve con la lista y no improvises en la consola.

**7.1 Lanzar la instancia (una sola vez)**
- Región `us-east-1`, AMI **Ubuntu Server 24.04 LTS**, tipo **t3.small** y key pair `vockey`.
- Disco **gp3 de 16 GB**, con *Delete on termination* activado.
- *Advanced details* → **Credit specification: Standard**.
- Security Group `sg-entregasegura`:

| Puerto | Origen | Motivo |
|---|---|---|
| 22/tcp | **Tu IP/32** (no `0.0.0.0/0`) | Administración por SSH |
| 80/tcp | 0.0.0.0/0 | Acceso a la aplicación |
| (443/tcp) | 0.0.0.0/0 | Solo si haces HTTPS |

> Tu IP de casa puede cambiar. Si el SSH deja de conectar, actualiza la regla 22 con tu IP nueva. **No la abras a todo el mundo.**

**7.2 Hardening del host** (`infra/hardening_host.sh`): las 5 medidas documentadas superan las 3 exigidas.
1. **Usuario de servicio** `entregas` sin sudo, dueño de `/opt/entregasegura`, con `.env` en `chmod 600` y `chown entregas:entregas`.
2. **SSH:** `PasswordAuthentication no`, `PermitRootLogin no` y `AllowUsers ubuntu`.
3. **Firewall de doble capa:** Security Group más `ufw` (`default deny incoming`, `allow 22`, `allow 80`).
4. **Actualizaciones:** `unattended-upgrades` activo, con evidencia `apt list --upgradable` antes y después.
5. **Servicios innecesarios desactivados:** revisar `systemctl list-unit-files --state=enabled` y deshabilitar lo que no se use (por ejemplo `snapd` si no se necesita). Evidencia con `ss -tulpn`.

> ⚠️ **Punto crítico que el jurado puede preguntar:** pertenecer al grupo `docker` equivale a tener root en el host. Por eso el usuario `entregas` **no** está en el grupo `docker`; el despliegue lo ejecuta el admin con `sudo`. Los *procesos* de la aplicación sí corren sin privilegios, porque los contenedores usan `USER node`. Rootless Docker se documenta como mejora futura (limitación honesta).

**7.3 Desplegar**
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git ufw
sudo systemctl enable --now docker            # arranca solo al encender la instancia
git clone <repo> /opt/entregasegura && cd /opt/entregasegura
cp .env.example .env && nano .env              # valores reales SOLO aquí
sudo docker compose up -d --build
```
- Verificar desde tu PC con `curl http://<IP-publica>/api/health`.
- **Apagar o reiniciar la instancia y comprobar que todo vuelve solo.** Esto es crítico porque el Learner Lab la apaga en cada fin de sesión.

**7.4 Rutina de cada sesión en la nube**
```
Start Lab → EC2 Start → anotar IP pública → trabajar → anotar en COSTOS.md → EC2 Stop → End Lab
```

**DoD:** la app responde desde la IP pública, sobrevive a *stop/start* de la instancia y `ss -tulpn` en el host muestra solo los puertos 22 y 80.
**Checklist cubierto:** Despliegue, Linux y procesos, Red, Hardening.

---

### FASE 8 · Dataset y pruebas técnicas · *Días 12–13* · 💰 ≈ 0.25 USD

**8.1 Dataset propio** (`dataset/` más `DATASET.md` con nombre, tipo, tamaño, SHA-256 y resultado esperado):

| Archivo | Tipo | Tamaño aprox. | Propósito |
|---|---|---|---|
| `informe_laboratorio.md` | Markdown | 8 KB | Caso normal |
| `notas_parcial_sintetico.csv` | CSV | 40 KB | Estadísticas de filas y columnas (nombres inventados) |
| `algoritmo_ordenamiento.txt` | Texto (código) | 3 KB | Caso normal, código fuente |
| `informe_copia.md` | Markdown | 8 KB | **Idéntico** al primero, para disparar `posible_duplicado` |
| `ensayo_largo.txt` | Texto | 4.8 MB | Cerca del límite: se acepta y mide el rendimiento |
| `ensayo_excedido.txt` | Texto | 6 MB | **Rechazado** por tamaño (413) |
| `binario_disfrazado.txt` | Binario | 50 KB | **Fallido** por no ser UTF-8 válido |

Se generan con un script (`scripts/generar_dataset.sh`) para que sean reproducibles. No contienen datos personales reales.

**8.2 Pruebas** (todas como scripts reproducibles con su salida guardada en `docs/evidencias/`):

| Prueba | Script | Qué demuestra |
|---|---|---|
| Funcional | `prueba_funcional.sh` | Login de 3 roles, subida, ciclo de estados y descarga |
| Aislamiento | `prueba_aislamiento.sh` | Estudiante A pide la entrega de B (404) y el docente pide la de otro curso (404); ambos quedan `DENEGADO` en la auditoría |
| Carga | `prueba_carga.sh` | **5 estudiantes × 10 entregas = 50 trabajos** con el dataset. Se mide el tiempo total, el promedio por trabajo (desde los timestamps de la BD) y el pico de CPU y RAM del worker (`docker stats`). **Se corre con `WORKER_CONCURRENCY=1` y con `=2` y se comparan los resultados.** Este dato es el que se interpreta en la sustentación. |
| Recuperación | manual + log | `docker compose stop worker` a mitad de la carga, luego `start`; los trabajos pendientes se completan y los colgados se recuperan |
| Persistencia | manual | `docker compose down` (sin `-v`) y `up -d`: usuarios, entregas y resultados siguen ahí |

> 💡 Afina y depura la prueba de carga **en local** y solo córrela en AWS cuando ya funcione. En la nube basta con 2 ejecuciones (concurrencia 1 y 2).

**DoD:** las 5 pruebas pasan en AWS y sus evidencias están guardadas.
**Checklist cubierto:** Recursos, Aislamiento, Persistencia, Procesamiento.

---

### FASE 9 · Ensayo general y retos · *Días 13–15* · 💰 ≈ 0.40 USD

- [ ] **Ensayo del checklist de 14 puntos cronometrado** (30–60 s por punto; ver §5). Haced al menos 2 ensayos completos: el primero en local y el segundo en AWS.
- [ ] **Cada integrante practica los 6 retos** (§6), primero en local. En AWS, cada uno hace al menos 2 en una sola sesión.
- [ ] **Snapshot manual único** del EBS (versión candidata) más el tag `v1.0`.
- [ ] Respaldo de la BD con `scripts/backup_db.sh` (`pg_dump`), copiado a tu PC.

---

### FASE 10 · Documentación · *Cuando todo funcione* · 💰 0 USD

*(Se hace al final, como pediste; la estructura sale directo de este roadmap.)*

- [ ] Documento técnico en PDF de 6–10 páginas: contexto (§1), arquitectura y diagrama (§2), decisiones D1–D6, roles y matriz, hardening (7.2), almacenamiento, monitoreo, pruebas (8.2) con resultados interpretados, sello de autenticidad y limitaciones.
- [ ] README probado por **otro integrante** desde cero en local (si él lo logra, está bien escrito).
- [ ] Evidencias de seguridad: capturas y comandos de `docs/evidencias/`.
- [ ] Verificar que no haya secretos versionados:
  ```bash
  git log -p | grep -iE 'password|secret|token|BEGIN .*PRIVATE' || echo "OK"
  ```

---

### FASE 11 · Sustentación y cierre de costos · *Día D* · 💰 ≈ 0.70 USD

- [ ] **2–3 días antes:** pasarle al docente la dirección `https://entregasegura-uptc.duckdns.org`. *(Sustituye a la Elastic IP: el nombre de DuckDNS sigue a la IP sola y no cuesta nada; ver `docs/DESPLIEGUE_AWS.md`.)*
- [ ] **El día D, 30 min antes:** Start Lab, Start EC2, `docker compose ps` y `curl /api/health`, y tener abiertas en pestañas las sesiones de los 3 roles.
- [ ] **Después de la nota, en este orden:**
  1. Bajar el último respaldo (`pg_dump` y `docs/evidencias`).
  2. **Terminar** la instancia (no solo detenerla).
  3. **Borrar** el subdominio en duckdns.org (y **liberar** la Elastic IP, si al final se usó).
  4. Borrar el snapshot y comprobar que no quedan volúmenes huérfanos.
  5. Repetir el comando de auditoría de la Fase 0.2 y verificar que todo queda vacío.
  6. Anotar el saldo final.

---

## 4. Plan de costos detallado

Precios de lista en us-east-1 (verifica en el panel del lab; el Learner Lab no aplica la capa gratuita):

| Recurso | Precio | Cuándo cobra |
|---|---|---|
| EC2 `t3.small` | ≈ 0.0208 USD/h | Solo mientras está *running* |
| IPv4 pública | 0.005 USD/h | Mientras está asignada (la EIP cobra también con la instancia apagada) |
| EBS gp3 | 0.08 USD/GB-mes | **Siempre**, aunque la instancia esté apagada |
| Snapshot EBS | ≈ 0.05 USD/GB-mes | Siempre, hasta que lo borres |

**Estimación del proyecto** (≈ 4 semanas desde el primer despliegue):

| Concepto | Cálculo | USD |
|---|---|---|
| EC2 en ejecución | ~50 h × 0.0208 | 1.04 |
| IPv4 automática | ~50 h × 0.005 | 0.25 |
| EBS 16 GB | 16 × 0.08 × 1 mes | 1.28 |
| Elastic IP los últimos 4 días | 96 h × 0.005 | 0.48 |
| Snapshot (~4 GB usados, 2 semanas) | 4 × 0.05 × 0.5 | 0.10 |
| Margen por imprevistos (×1.5) | | ≈ 1.6 |
| **Total esperado** | | **≈ 3 – 5 USD** |

**Horas en la nube por fase:** F7 unas 8 h, F8 unas 6 h, F9 unas 12 h, F11 unas 4 h, más un colchón de unas 20 h para depurar, lo que da unas 50 h.

**Lo que NO cuesta nada:** desarrollar, depurar y practicar retos en local, que es el 80 % del trabajo.

---

## 5. Mapa: requisito → dónde se cumple

### Checklist docente (14 puntos), con guion de 30–60 s cada uno

| # | Punto | Qué mostrar | Comando o evidencia |
|---|---|---|---|
| 1 | Despliegue | La app abierta en la IP pública y la consola EC2 (región y tipo) | Navegador + `curl http://IP/api/health` |
| 2 | Contenedores | 4 servicios y la función de cada uno | `docker compose ps` |
| 3 | Linux y procesos | SO y proceso principal | `cat /etc/os-release`, `systemctl status docker`, `docker top entregasegura-worker-1` |
| 4 | Recursos | CPU, RAM y disco, **interpretando un dato** ("el worker usa X MB de 256 MB") | `docker stats --no-stream`, `free -h`, `df -h` |
| 5 | Usuarios | Login con estudiante y docente | Dos navegadores o ventanas de incógnito |
| 6 | Autorización | Docente crea actividad (✅) y estudiante intenta lo mismo (❌ 403) | UI + respuesta de la API |
| 7 | Aislamiento | Estudiante A pide el ID de la entrega de B y recibe 404 | `curl` con la cookie de A |
| 8 | Procesamiento | Subir un archivo y ver el ciclo de estados | UI + `docker compose logs -f worker` |
| 9 | Persistencia | `docker compose restart db worker` y los datos siguen ahí | Antes y después |
| 10 | Hardening | Contenedores sin root, `read_only`, permisos de `.env` | `scripts/verificar_hardening.sh`, `ls -l .env` |
| 11 | Red | Solo 22 y 80 abiertos, con justificación | Security Group + `sudo ss -tulpn` + `sudo ufw status` |
| 12 | Auditoría | Log con usuario, acción y fecha | Pantalla de auditoría o `SELECT ... FROM audit_log ORDER BY ts DESC LIMIT 10` |
| 13 | Autenticidad | Demostración de RN-1 (cierre, 403, prórroga, 201) | §1.4 |
| 14 | Repositorio | Dockerfiles, compose, `.env.example` y ausencia de secretos | GitHub + `git log -p \| grep` |

### Mínimos técnicamente demostrables del enunciado

| Mínimo | Fase |
|---|---|
| App desplegada y accesible | F7 |
| Autenticación individual | F3 |
| Tres roles diferenciados | F3 |
| Restricción efectiva entre usuarios | F3 y F8 |
| Procesamiento en segundo plano | F4 |
| Persistencia | F2, F4 y F8 |
| Logs de auditoría | F3 y F5 |
| Hardening básico | F6 y F7 |
| Dos retos individuales evaluables | F9 |

---

## 6. Preparación de los retos sorpresa (25 % de la nota)

El diseño está pensado para que **cada reto sea un cambio pequeño en un solo lugar**. Ese es el verdadero objetivo de centralizar los permisos, la auditoría y los límites.

| Reto | Dónde se cambia | Cambio esperado | Cómo se verifica |
|---|---|---|---|
| 1 · Nuevo usuario | UI admin o `POST /api/admin/usuarios` | Crear `est_prueba` con rol estudiante | Login y luego `GET /api/admin/usuarios` responde 403; se ve en la auditoría |
| 2 · Cambio de permisos | `api/src/permissions.js` | Añadir la acción a `docente` y **no** a `estudiante`, luego `docker compose up -d --build api` | Docente 200, estudiante 403 |
| 3 · Aislamiento | `api/src/middleware/scope.js` | Restaurar o añadir la comprobación `submission.student_id === req.user.id` | `curl` cruzado responde 404 |
| 4 · Recursos | `docker-compose.yml` → `worker.deploy.resources.limits` | Cambiar la memoria o la CPU y ejecutar `docker compose up -d worker` | `docker inspect ... Memory/NanoCpus` y `docker stats` |
| 5 · Recuperación | — | `docker compose stop worker`, subir 3 archivos (quedan `pendiente`) y `start worker` | Pasan a `completado`; se ve en `logs worker` |
| 6 · Auditoría | Ruta concreta (por ejemplo, eliminar entrega) | Añadir una línea `await audit(req, 'entrega:eliminar', ...)` | Fila nueva en `audit_log` |

**Entrenamiento:** cada integrante hace los 6 retos en local **sin mirar notas** y contra reloj (meta: menos de 5 min por reto). Si no termina, practica decir *qué intentó, dónde está el problema y cómo lo resolvería*, porque eso también se evalúa.

**Comandos que todos deben saber de memoria:**
```bash
docker compose ps | logs -f <svc> | restart <svc> | up -d --build <svc> | exec <svc> sh
docker stats --no-stream ; docker inspect <ctr>
psql: \dt  \du  SELECT * FROM audit_log ORDER BY ts DESC LIMIT 5;
sudo ss -tulpn ; sudo ufw status ; free -h ; df -h ; systemctl status docker
```

---

## 7. Anexos

### Anexo A · Borrador del mensaje al docente

> Profesor Fredy, buen día. Para el proyecto final de Sistemas Operativos nuestro equipo propone el siguiente caso:
> **Contexto:** Gestión académica. *EntregaSegura*, la plataforma de recepción y análisis de entregas de la Corporación Educativa Altiplano (ficticia).
> **Roles:** Administrador TI (gestiona usuarios, cursos y auditoría, sin acceso al contenido de las entregas), Docente (operador de sus cursos) y Estudiante.
> **Regla de negocio:** un estudiante solo puede subir, reemplazar o eliminar entregas si está matriculado y antes de la fecha límite. Pasado el cierre, el servidor deniega y audita la operación, salvo una prórroga individual otorgada por el docente del curso, que también queda auditada.
> **Procesamiento:** SHA-256, estadísticas del texto y detección de entregas idénticas dentro de una misma actividad.
> **Decisión de arquitectura:** cola de trabajos en PostgreSQL con `FOR UPDATE SKIP LOCKED`, desplegada con Docker Compose en EC2 (AWS Academy).
> Quedamos atentos a su aprobación o a los ajustes que considere. Integrantes: ________.

### Anexo B · Plantilla de `docs/COSTOS.md`

```markdown
| Fecha | Saldo inicial (panel) | Hora inicio | Hora fin | Horas EC2 | Qué se hizo | Estado al salir (EC2 stopped? EIP?) |
|-------|-----------------------|-------------|----------|-----------|-------------|-------------------------------------|
| 2026-11-21 | 49.00 | — | — | 0 | Auditoría inicial de la cuenta | Sin recursos activos |
```

### Anexo C · Fragmento base de `docker-compose.yml`

```yaml
x-logging: &logging
  driver: json-file
  options: { max-size: "10m", max-file: "3" }

x-hardened: &hardened
  read_only: true
  tmpfs: [/tmp]
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  pids_limit: 100
  restart: unless-stopped
  logging: *logging

services:
  proxy:
    build: ./proxy
    ports: ["80:8080"]
    networks: [edge]
    depends_on: { api: { condition: service_healthy } }
    deploy: { resources: { limits: { cpus: "0.25", memory: 64M } } }
    restart: unless-stopped
    logging: *logging

  api:
    <<: *hardened
    build: ./api
    env_file: .env
    networks: [edge, internal]
    volumes: [files:/data]
    depends_on: { db: { condition: service_healthy } }
    deploy: { resources: { limits: { cpus: "0.50", memory: 256M } } }
    healthcheck: { test: ["CMD", "wget", "-qO-", "http://localhost:3000/api/health"], interval: 15s }

  worker:
    <<: *hardened
    build: ./worker
    env_file: .env
    networks: [internal]
    volumes: [files:/data]
    depends_on: { db: { condition: service_healthy } }
    deploy: { resources: { limits: { cpus: "0.50", memory: 256M } } }   # ← Reto 4

  db:
    image: postgres:16-alpine
    env_file: .env
    networks: [internal]
    volumes: [pgdata:/var/lib/postgresql/data, ./db/migrations:/docker-entrypoint-initdb.d:ro]
    deploy: { resources: { limits: { cpus: "0.50", memory: 384M } } }
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER}"], interval: 10s }
    restart: unless-stopped
    logging: *logging

networks:
  edge: {}
  internal: { internal: true }   # sin salida a Internet: el worker y la BD quedan aislados

volumes:
  pgdata: {}
  files: {}
```

### Anexo D · Cronograma resumido

| Fase | Días | Lugar | Costo AWS |
|---|---|---|---|
| 0 Preparación y aprobación | 1 | Local + consola | 0 |
| 1 Diseño | 1–2 | Local | 0 |
| 2 Esqueleto Compose | 2–3 | Local | 0 |
| 3 Autenticación y roles | 3–5 | Local | 0 |
| 4 Archivos, cola y worker | 5–8 | Local | 0 |
| 5 RN-1, auditoría y frontend | 8–10 | Local | 0 |
| 6 Hardening de contenedores | 10–11 | Local | 0 |
| 7 Despliegue y hardening del host | 11–12 | **AWS** | ~0.30 |
| 8 Dataset y pruebas | 12–13 | Local → **AWS** | ~0.25 |
| 9 Ensayo y retos | 13–15 | Local → **AWS** | ~0.40 |
| 10 Documentación | al final | Local | 0 |
| 11 Sustentación y limpieza | Día D | **AWS** | ~0.70 |
| EBS, IP y snapshot (fijos) | todo el período | — | ~1.9 |
| **Total** | **≈ 15 días hábiles** | | **≈ 3–5 USD** |
