# Matriz de permisos y contrato de la API

La autorización tiene **dos capas** y las dos viven en el servidor:

1. **RBAC** ([api/src/permissions.js](../api/src/permissions.js)): ¿el *rol* puede intentar esta acción?
   Si no, la respuesta es **403** y queda `DENEGADO` en la auditoría.
2. **Alcance o propiedad** ([api/src/middleware/scope.js](../api/src/middleware/scope.js)): ¿*este recurso*
   le pertenece? (su entrega, el curso que dicta, un curso donde está matriculado). Si no, la respuesta es **404**,
   la misma que si el ID no existiera, para no confirmar que existe. También queda `DENEGADO`.

## Matriz

| Acción | Admin TI | Docente | Estudiante |
|---|:---:|:---:|:---:|
| Crear y desactivar usuarios, asignar rol | ✅ | ❌ | ❌ |
| Crear cursos, asignar docente, matricular | ✅ | ❌ | ❌ |
| Crear una actividad con fecha límite | ❌ | ✅ *(sus cursos)* | ❌ |
| Subir una entrega | ❌ | ❌ | ✅ *(regla RN-1)* |
| Eliminar o reemplazar una entrega propia | ❌ | ❌ | ✅ *(solo antes del cierre)* |
| Ver y descargar una entrega y su resultado | ❌ *(solo metadatos)* | ✅ *(sus cursos)* | ✅ *(solo las propias)* |
| Ver la marca `posible_duplicado` | ❌ | ✅ *(sus cursos)* | ❌ |
| Otorgar prórroga | ❌ | ✅ *(sus cursos)* | ❌ |
| Reprocesar un trabajo fallido | ✅ | ✅ *(sus cursos)* | ❌ |
| Ver la auditoría completa | ✅ | ❌ | ❌ |
| Ver la trazabilidad de una entrega | ✅ | ✅ *(sus cursos)* | ❌ |
| Ver el estado de servicios y de la cola | ✅ | ❌ | ❌ |

## Contrato de la API

Todas las rutas (salvo `health` y `login`) exigen la cookie de sesión. "Alcance" indica la comprobación de la capa 2.

| Método | Ruta | Permiso (capa 1) | Alcance (capa 2) |
|---|---|---|---|
| GET | `/api/health` | público | — |
| POST | `/api/auth/login` | público (rate limit 5 fallos/min) | — |
| POST | `/api/auth/logout` | sesión | — |
| GET | `/api/auth/me` | sesión | — |
| GET | `/api/admin/usuarios[?rol=]` | `usuario:listar` | — |
| POST | `/api/admin/usuarios` | `usuario:crear` | — |
| PATCH | `/api/admin/usuarios/:id` | `usuario:modificar` | no puede desactivarse a sí mismo |
| POST | `/api/admin/cursos` | `curso:crear` | el docente debe tener rol docente |
| POST | `/api/admin/cursos/:id/matriculas` | `curso:matricular` | el usuario debe tener rol estudiante |
| DELETE | `/api/admin/cursos/:id/matriculas/:studentId` | `curso:matricular` | — |
| GET | `/api/admin/auditoria[?resultado=&usuario=&accion=&recurso=&limit=]` | `auditoria:ver` | — |
| GET | `/api/admin/auditoria/denegados` | `auditoria:ver` | — |
| GET | `/api/admin/estado` | `sistema:estado` | — |
| GET | `/api/cursos` | `curso:listar` | admin: todos · docente: los suyos · estudiante: matriculados |
| GET | `/api/cursos/:id/estudiantes` | `curso:ver_estudiantes` | admin o docente del curso |
| GET | `/api/cursos/:id/actividades` | `actividad:listar` | admin, docente del curso o matriculado |
| POST | `/api/cursos/:id/actividades` | `actividad:crear` | docente del curso |
| POST | `/api/actividades/:id/entregas` | `entrega:subir` | **RN-1**: matriculado (404) y dentro del plazo (403) |
| POST | `/api/actividades/:id/prorrogas` | `prorroga:otorgar` | docente del curso; estudiante matriculado |
| GET | `/api/entregas[?actividad=]` | `entrega:listar_propias` / `listar_curso` / `metadatos` | estudiante: las suyas · docente: sus cursos · admin: todas (metadatos) |
| GET | `/api/entregas/:id` | `entrega:metadatos` | dueño, docente del curso o admin |
| GET | `/api/entregas/:id/archivo` | `entrega:descargar` | dueño o docente del curso |
| GET | `/api/entregas/:id/resultado` | `resultado:ver` | dueño o docente del curso; `posible_duplicado` solo al docente |
| PUT | `/api/entregas/:id` | `entrega:reemplazar` | dueño + **RN-1** |
| DELETE | `/api/entregas/:id` | `entrega:eliminar` | dueño + **RN-1** |
| POST | `/api/entregas/:id/reprocesar` | `trabajo:reprocesar` | admin o docente del curso; solo si está `fallido` |
| GET | `/api/entregas/:id/trazabilidad` | `trazabilidad:ver` | admin o docente del curso |

## Roles de base de datos (D5)

| Rol de BD | Permisos |
|---|---|
| `app_api` | `SELECT, INSERT, UPDATE, DELETE` en las tablas de negocio · **solo `INSERT, SELECT`** en `audit_log` |
| `app_worker` | `SELECT, UPDATE` en `jobs` · `SELECT` en `submissions` y `UPDATE` **solo de la columna `sha256`** · **solo `INSERT`** en `audit_log` |
| `postgres` | Solo migraciones. La aplicación nunca lo usa. |

Además, un *trigger* impide `UPDATE`, `DELETE` y `TRUNCATE` sobre `audit_log` incluso al superusuario
(tendría que desactivar el trigger primero, y eso queda registrado en el log de PostgreSQL porque
la base arranca con `log_statement=ddl`; se ve con `docker compose logs db | grep statement`).
