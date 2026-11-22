# Informe de laboratorio 1 · Procesos e hilos

**Curso:** SO-101 Sistemas Operativos  
**Institución:** Corporación Educativa Altiplano (ficticia)  
**Autor:** estudiante de prueba (dataset sintético)

## 1. Objetivo

El núcleo asigna la prioridad de cada tarea dentro de un límite de recursos. El hilo principal registra los marcos de memoria antes de cada cambio de contexto. El núcleo supervisa las secciones críticas sin provocar inanición. La tabla de páginas protege los marcos de memoria antes de cada cambio de contexto.

## 2. Marco teórico

### 2.1 Procesos

El hilo principal registra los marcos de memoria para evitar interbloqueos. El servidor supervisa las secciones críticas sin provocar inanición. El núcleo asigna las secciones críticas para evitar interbloqueos. El manejador de interrupciones supervisa la prioridad de cada tarea sin provocar inanición. La memoria virtual comparte la prioridad de cada tarea de forma atómica. El controlador protege la prioridad de cada tarea de forma atómica. El núcleo aísla la prioridad de cada tarea sin provocar inanición. El controlador registra las secciones críticas antes de cada cambio de contexto. La memoria virtual registra los marcos de memoria dentro de un límite de recursos.

### 2.2 Hilos

El hilo principal aísla la prioridad de cada tarea sin provocar inanición. El hilo principal comparte las secciones críticas para evitar interbloqueos. La memoria virtual despierta las secciones críticas sin provocar inanición. El hilo principal asigna las secciones críticas sin provocar inanición. La tabla de páginas comparte los marcos de memoria dentro de un límite de recursos. El controlador registra los marcos de memoria dentro de un límite de recursos. El manejador de interrupciones registra las secciones críticas sin provocar inanición. La memoria virtual registra las secciones críticas dentro de un límite de recursos. El núcleo asigna las secciones críticas de forma atómica.

### 2.3 Planificación

El controlador protege los marcos de memoria de forma atómica. El hilo principal asigna los marcos de memoria dentro de un límite de recursos. El servidor asigna la prioridad de cada tarea sin provocar inanición. El controlador registra la prioridad de cada tarea dentro de un límite de recursos. La memoria virtual comparte los marcos de memoria de forma atómica. El núcleo protege la prioridad de cada tarea dentro de un límite de recursos. El manejador de interrupciones asigna los marcos de memoria sin provocar inanición. El servidor aísla los marcos de memoria antes de cada cambio de contexto. La tabla de páginas despierta las secciones críticas dentro de un límite de recursos.

### 2.4 Sincronización

La memoria virtual comparte la prioridad de cada tarea dentro de un límite de recursos. El servidor protege los marcos de memoria sin provocar inanición. El controlador supervisa las secciones críticas antes de cada cambio de contexto. El servidor supervisa los marcos de memoria para evitar interbloqueos. El hilo principal protege los marcos de memoria sin provocar inanición. El controlador aísla los marcos de memoria para evitar interbloqueos. La tabla de páginas registra las secciones críticas antes de cada cambio de contexto. La tabla de páginas registra la prioridad de cada tarea para evitar interbloqueos. El manejador de interrupciones protege los marcos de memoria antes de cada cambio de contexto.

## 3. Procedimiento

1. El núcleo supervisa las secciones críticas dentro de un límite de recursos.
2. El manejador de interrupciones comparte las secciones críticas antes de cada cambio de contexto.
3. La memoria virtual despierta la prioridad de cada tarea sin provocar inanición.
4. El manejador de interrupciones aísla los marcos de memoria antes de cada cambio de contexto.
5. El manejador de interrupciones protege la prioridad de cada tarea sin provocar inanición.
6. El controlador protege la prioridad de cada tarea para evitar interbloqueos.
7. La memoria virtual registra la prioridad de cada tarea dentro de un límite de recursos.

## 4. Resultados

| Prueba | Hilos | Tiempo (ms) | CPU (%) |
|---|---|---|---|
| P01 | 2 | 396 | 24 |
| P02 | 4 | 535 | 92 |
| P03 | 8 | 527 | 88 |
| P04 | 1 | 359 | 54 |
| P05 | 2 | 742 | 62 |
| P06 | 4 | 825 | 44 |
| P07 | 8 | 320 | 32 |
| P08 | 1 | 82 | 48 |
| P09 | 2 | 202 | 96 |
| P10 | 4 | 624 | 38 |

## 5. Análisis

El servidor comparte las secciones críticas para evitar interbloqueos. El hilo principal aísla las secciones críticas dentro de un límite de recursos. La tabla de páginas supervisa la prioridad de cada tarea sin provocar inanición. El manejador de interrupciones protege los marcos de memoria antes de cada cambio de contexto. La memoria virtual asigna los marcos de memoria dentro de un límite de recursos. La tabla de páginas comparte las secciones críticas de forma atómica. La tabla de páginas asigna los marcos de memoria para evitar interbloqueos. El hilo principal asigna las secciones críticas de forma atómica. El núcleo asigna los marcos de memoria sin provocar inanición. La tabla de páginas despierta los marcos de memoria de forma atómica. El manejador de interrupciones protege los marcos de memoria antes de cada cambio de contexto. El manejador de interrupciones comparte las secciones críticas para evitar interbloqueos. La memoria virtual aísla la prioridad de cada tarea sin provocar inanición. La tabla de páginas protege la prioridad de cada tarea para evitar interbloqueos. El servidor asigna los marcos de memoria para evitar interbloqueos. El manejador de interrupciones asigna la prioridad de cada tarea para evitar interbloqueos.

## 6. Conclusiones

- El manejador de interrupciones asigna las secciones críticas antes de cada cambio de contexto.
- El hilo principal despierta las secciones críticas sin provocar inanición.
- El núcleo supervisa las secciones críticas para evitar interbloqueos.
- La tabla de páginas despierta las secciones críticas antes de cada cambio de contexto.

## 7. Referencias

- Silberschatz, Galvin y Gagne. *Operating System Concepts*.
- Tanenbaum y Bos. *Modern Operating Systems*.
