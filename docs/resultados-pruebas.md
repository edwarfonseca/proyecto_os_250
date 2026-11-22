# Resultados de las pruebas

> Dos rondas, 21 nov 2026: **local** (PC del equipo, Docker 29, 4 núcleos) y **AWS** (EC2 `t3.small`,
> Ubuntu 24.04, 2 vCPU, 2 GB, Docker 29.1, us-east-1a). Evidencias: `docs/evidencias/` (las de AWS
> llevan fecha `20261122_0…` porque el servidor está en UTC).

| Prueba | Script | Local | AWS |
|---|---|---|---|
| Funcional | `prueba_funcional.sh` | ✅ 37/37 | ✅ 37/37 |
| Aislamiento | `prueba_aislamiento.sh` | ✅ 27/27 | ✅ 27/27 |
| RN-1 | `demo_rn1.sh` | ✅ 6/6 | ✅ 6/6 |
| Carga (c=1 y c=2) | `prueba_carga.sh` | ✅ 50/50 en ambas | ✅ 50/50 en ambas |
| Recuperación | `prueba_recuperacion.sh` | ✅ 13/13 | ✅ 13/13 |
| Persistencia | `prueba_persistencia.sh` | ✅ 4/4 | ✅ 4/4 |
| Hardening | `verificar_hardening.sh` | ✅ 14/14 | ✅ 19/19 (14 + 5 de HTTPS, 22 nov) |
| Hardening del host | `infra/hardening_host.sh` (evidencias `host_antes` / `host_despues`) | — | ✅ 6 medidas |
| Sobrevive a Stop/Start | manual | — | ✅ en línea 38 s después del apagado |
| HTTPS (`https://entregasegura-uptc.duckdns.org`) | `verificar_hardening.sh` sección 10 | — | ✅ certificado válido, HSTS, 301 desde HTTP, sin TLS 1.1, cookie `Secure` |

Tras activar HTTPS (22 nov 2026) se repitieron en AWS la funcional (37/37), el aislamiento (27/27)
y RN-1 (6/6): todo igual, con la cookie de sesión ya marcada `Secure`.

## Prueba de carga: 5 estudiantes × 10 entregas = 50 trabajos

Cada estudiante sube 10 archivos del dataset (uno de ellos de 4,8 MB) y los 5 suben a la vez.
Los tiempos salen de las columnas `creado_en`, `iniciado_en` y `terminado_en` de la tabla `jobs`;
el pico de CPU y RAM sale de `docker stats` muestreado cada segundo.

| Métrica | Local c=1 | Local c=2 | Cambio local | **AWS c=1** | **AWS c=2** | **Cambio AWS** |
|---|---:|---:|---:|---:|---:|---:|
| Trabajos completados | 50/50 | 50/50 | | 50/50 | 50/50 | |
| Tiempo total (primera subida → último terminado) | 6,77 s | 5,66 s | −16 % | 6,30 s | 6,17 s | −2 % |
| Rendimiento | 7,39 trab/s | 8,83 trab/s | +19 % | 7,94 trab/s | 8,11 trab/s | **+2 %** |
| Espera media en cola | 2 522 ms | 2 045 ms | −19 % | 2 082 ms | 1 920 ms | −8 % |
| Tiempo medio por trabajo | 121 ms | 128 ms | +6 % | 110 ms | 152 ms | **+38 %** |
| p95 por trabajo | 1 009 ms | 1 002 ms | ≈ | 1 026 ms | 1 009 ms | ≈ |
| Máximo por trabajo (archivo de 4,8 MB) | 1 483 ms | 1 871 ms | +26 % | 1 080 ms | 1 977 ms | **+83 %** |
| Pico de CPU del worker | 51,6 % | 51,9 % | techo | 50,5 % | 51,1 % | **techo** |
| Pico de RAM del worker | 93 MiB | 66 MiB | | 99 MiB | 98 MiB | |

En AWS la prueba se lanzó con **4,4 créditos de CPU** disponibles (la instancia no estaba frenada).

### Interpretación (lo que se dice en la sustentación)

1. **La CPU del worker toca el techo del 50 % en las dos pruebas.** Ese 50 % es exactamente el
   límite `cpus: "0.50"` del `docker-compose.yml`. El kernel lo aplica con *cgroups* (planificador
   CFS: 50 ms de CPU cada 100 ms). El worker es **CPU-bound**: calcular el SHA-256 y contar palabras
   de 4,8 MB es trabajo de CPU puro.
2. **Duplicar la concurrencia casi no mejora: +19 % en local y solo +2 % en AWS.** Los dos hilos
   se reparten la misma media CPU, así que cada trabajo individual tarda **más** (en AWS +38 % de
   media y +83 % el archivo grande: dos trabajos a la vez, cada uno con un cuarto de CPU). La poca
   ganancia que queda viene de *solapar esperas*: mientras un trabajo espera a la base de datos o al
   disco, el otro usa la CPU. En el PC local había más esperas que solapar (memoria muy ocupada y
   swap) y por eso ganó más; en la EC2, con el disco y la memoria libres, casi no hay esperas y el
   resultado muestra el límite de CPU en estado puro.
3. **Para escalar de verdad hay que dar más CPU, no más hilos.** Hay dos opciones: subir el límite
   (`cpus: "1.0"`, que es el Reto 4) o lanzar más réplicas del worker (`docker compose up -d --scale worker=2`).
   La cola con `FOR UPDATE SKIP LOCKED` garantiza que dos workers nunca toman el mismo trabajo.
4. **La RAM sobra.** El pico no pasa de 99 MiB de 256 (39 %). El límite podría bajar a 128 MB sin
   riesgo. La diferencia entre las dos pruebas se debe al recolector de basura de Node, no a la
   concurrencia.
5. **La API no es el cuello de botella.** Las 50 subidas se aceptan en ≈ 1 s. El resto del tiempo
   es cola más procesamiento.

### Créditos de CPU en AWS (dato para la sustentación)

La `t3.small` tiene 2 vCPU con **créditos de CPU**: en modo *Standard* (regla 3 del presupuesto)
puede usar el 100 % mientras tenga créditos, y si se le acaban baja a la línea base del **20 % por
vCPU**. Una t3 en modo *Standard* **arranca sin créditos**: tras instalar Docker y construir las
imágenes el saldo era de 0,5. Se esperó ~10 min en reposo (gana ≈ 0,4 créditos/min) hasta tener 4,4
antes de medir. Con 0 créditos el límite real habría sido la línea base de AWS y no el `cpus: 0.50`.

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
