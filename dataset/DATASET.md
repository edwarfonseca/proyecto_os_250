# Dataset sintético de EntregaSegura

Todos los archivos se generan con `./scripts/generar_dataset.sh` (Python, sin dependencias).
El generador usa un pseudoaleatorio con semilla fija, así que **siempre produce los mismos bytes**:
los SHA-256 de esta tabla se pueden verificar en cualquier máquina con `sha256sum dataset/*`.
No contiene datos personales reales: nombres y notas son inventados.

Los dos archivos grandes (`ensayo_largo.txt` y `ensayo_excedido.txt`) no se suben a git (`.gitignore`);
se regeneran con el script.

| Archivo | Tipo | Tamaño (bytes) | Propósito | Resultado esperado | SHA-256 |
|---|---|---:|---|---|---|
| `informe_laboratorio.md` | Markdown | 6,211 | Caso normal | 201 → `completado` | `0001684dfa4de8f8603c8fdc9a7fdf4e0e9d8f583005c6d74921e7cb0d564e8e` |
| `notas_parcial_sintetico.csv` | CSV | 41,374 | Estadísticas de filas y columnas (800 filas × 8 columnas, nombres inventados) | 201 → `completado`, `csv.filas=800`, `csv.columnas=8` | `7b7204f3cd1c1b5addd081ae5282e93d747afbf8a6432284986d1d9f2f9b3599` |
| `algoritmo_ordenamiento.txt` | Texto (código) | 1,833 | Caso normal, código fuente | 201 → `completado` | `7b78417dba590ec82933046bc444a8179ac13028831a2195574dba50388c5c42` |
| `informe_copia.md` | Markdown | 6,211 | **Idéntico** a `informe_laboratorio.md`: dispara `posible_duplicado` si lo sube otro estudiante de la misma actividad | 201 → `completado`; el docente ve `posible_duplicado: true` | `0001684dfa4de8f8603c8fdc9a7fdf4e0e9d8f583005c6d74921e7cb0d564e8e` |
| `metadatos_entrega.json` | JSON | 379 | Prueba del analizador de JSON | 201 → `completado`, `json.json_valido=true` | `68a70407b426468ce858e2d23e463939df0a7be9cfc69e05db9bf485f6e2aa2d` |
| `ensayo_largo.txt` | Texto | 4,800,000 | Cerca del límite: se acepta y mide el rendimiento | 201 → `completado` (≈ 0,9 s en local) | `be7c84db2591adaca3184f0352547a6c3f28b0d62cf1cbbc37c3039ed7c90f84` |
| `ensayo_excedido.txt` | Texto | 6,000,000 | Supera los 5 MB | **413** (lo rechaza Nginx, no llega a la API) | `8d5aeca4e6ef764701387ba5f5b1b489d4d856482e0ceb1bd3f7f684dfcd4729` |
| `binario_disfrazado.txt` | Binario (cabecera `MZ` de ejecutable) | 51,200 | Bytes que no son UTF-8 válido con extensión `.txt` | 201 → **`fallido`**: «El archivo no es texto UTF-8 válido» | `e270fca03d6936fa184248a68ad43db10392a4ffb77dbf229f31cbede8e0c600` |

Además, `prueba_funcional.sh` crea en el momento un `programa.exe` para comprobar que la API
rechaza extensiones no permitidas con **415**.

## Validación en tres capas

| Capa | Dónde | Qué comprueba | Respuesta |
|---|---|---|---|
| 1 | Nginx (`client_max_body_size 5m`) | Tamaño del cuerpo | 413 |
| 2 | API (`api/src/upload.js`) | Extensión (`.txt .md .csv .json`), MIME declarado y tamaño | 415 / 413 |
| 3 | Worker (`worker/src/processors/analizar.js`) | Que el contenido sea UTF-8 válido y sin bytes nulos | trabajo `fallido` con el motivo |
