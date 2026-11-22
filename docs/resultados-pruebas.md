# Resultados de las pruebas

> Primera ronda: **local** (PC del equipo, Docker 29, 4 núcleos), 21 nov 2026.
> La segunda ronda se ejecuta en AWS (EC2 `t3.small`) y se añade aquí.
> La salida completa de cada ejecución está en `docs/evidencias/`.

| Prueba | Script | Local | AWS |
|---|---|---|---|
| Funcional | `prueba_funcional.sh` | ✅ 37/37 | pendiente |
| Aislamiento | `prueba_aislamiento.sh` | ✅ 27/27 | pendiente |
| RN-1 | `demo_rn1.sh` | ✅ 6/6 | pendiente |
| Carga (c=1 y c=2) | `prueba_carga.sh` | ✅ 50/50 en ambas | pendiente |
| Recuperación | `prueba_recuperacion.sh` | ✅ 13/13 | pendiente |
| Persistencia | `prueba_persistencia.sh` | ✅ 4/4 | pendiente |
| Hardening | `verificar_hardening.sh` | ✅ 14/14 | pendiente |

## Prueba de carga: 5 estudiantes × 10 entregas = 50 trabajos

Cada estudiante sube 10 archivos del dataset (uno de ellos de 4,8 MB) y los 5 suben a la vez.
Los tiempos salen de las columnas `creado_en`, `iniciado_en` y `terminado_en` de la tabla `jobs`;
el pico de CPU y RAM sale de `docker stats` muestreado cada segundo.

| Métrica | Concurrencia 1 | Concurrencia 2 | Cambio |
|---|---:|---:|---:|
| Trabajos completados | 50/50 | 50/50 | |
| Tiempo total (primera subida → último terminado) | 6,77 s | 5,66 s | −16 % |
| Rendimiento | 7,39 trabajos/s | 8,83 trabajos/s | +19 % |
| Espera media en cola | 2 522 ms | 2 045 ms | −19 % |
| Tiempo medio por trabajo | 121 ms | 128 ms | +6 % |
| p95 por trabajo | 1 009 ms | 1 002 ms | ≈ |
| Máximo por trabajo (archivo de 4,8 MB) | 1 483 ms | 1 871 ms | +26 % |
| Pico de CPU del worker | 51,6 % | 51,9 % | **techo** |
| Pico de RAM del worker | 93 MiB de 256 | 66 MiB de 256 | |

### Interpretación (lo que se dice en la sustentación)

1. **La CPU del worker toca el techo del 50 % en las dos pruebas.** Ese 50 % es exactamente el
   límite `cpus: "0.50"` del `docker-compose.yml`. El kernel lo aplica con *cgroups* (planificador
   CFS: 50 ms de CPU cada 100 ms). El worker es **CPU-bound**: calcular el SHA-256 y contar palabras
   de 4,8 MB es trabajo de CPU puro.
2. **Duplicar la concurrencia solo mejora un 19 %, no un 100 %.** Los dos hilos se reparten la
   misma media CPU. La ganancia viene de *solapar esperas*: mientras un trabajo espera a la base de
   datos o al disco, el otro usa la CPU. Por eso cada trabajo individual tarda **más** (+6 % de media,
   +26 % el archivo grande), pero el conjunto termina antes.
3. **Para escalar de verdad hay que dar más CPU, no más hilos.** Hay dos opciones: subir el límite
   (`cpus: "1.0"`, que es el Reto 4) o lanzar más réplicas del worker (`docker compose up -d --scale worker=2`).
   La cola con `FOR UPDATE SKIP LOCKED` garantiza que dos workers nunca toman el mismo trabajo.
4. **La RAM sobra.** El pico no pasa de 93 MiB de 256 (36 %). El límite podría bajar a 128 MB sin
   riesgo. La diferencia entre las dos pruebas se debe al recolector de basura de Node, no a la
   concurrencia.
5. **La API no es el cuello de botella.** Las 50 subidas se aceptan en ≈ 1 s. El resto del tiempo
   es cola más procesamiento.

### Qué esperar en AWS

La `t3.small` tiene 2 vCPU con **créditos de CPU**: en modo *Standard* (regla 3 del presupuesto)
puede usar el 100 % mientras tenga créditos, y si se le acaban baja a la línea base del **20 % por
vCPU**. Una prueba de 10 s gasta muy pocos créditos, pero conviene revisar `CPUCreditBalance` en la
pestaña *Monitoring* de la instancia antes de la prueba y anotarlo junto al resultado.

## Recuperación: los tres escenarios

| Escenario | Qué se hizo | Resultado |
|---|---|---|
| Worker detenido | `docker compose stop worker`, subir 3 archivos, `start` | Quedan en `pendiente` y pasan a `completado` al volver |
| Apagado ordenado | `docker compose stop` a mitad de un trabajo de 20 s | El worker recibe `SIGTERM`, espera 8 s y **devuelve el trabajo a la cola** |
| Caída brusca | `docker compose kill -s SIGKILL` a mitad de un trabajo | El trabajo queda `en_ejecucion`; al volver, el worker detecta que superó el umbral (`RECUPERAR_TRAS_SEG`), lo devuelve a `pendiente` y lo completa |

## Validación en 3 capas (prueba funcional)

| Archivo | Capa que actúa | Resultado |
|---|---|---|
| `ensayo_excedido.txt` (6 MB) | Nginx | 413, no llega a la API |
| `programa.exe` | API | 415, extensión no permitida |
| `binario_disfrazado.txt` | Worker | Pasa la API (extensión y tamaño válidos) y el worker lo marca `fallido`: «El archivo no es texto UTF-8 válido» |
| `ensayo_largo.txt` (4,8 MB) | — | Aceptado y procesado en ≈ 0,9 s |
