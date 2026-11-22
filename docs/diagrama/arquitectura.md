# Diagrama de arquitectura

GitHub dibuja este diagrama automáticamente. Para el documento PDF se puede exportar desde
<https://mermaid.live> (pegar el bloque y descargar como PNG o SVG).

```mermaid
flowchart LR
    U["Usuarios<br/>(navegador)"] -->|HTTP :80| SG

    subgraph AWS["AWS us-east-1 · VPC por defecto"]
      SG{{"Security Group<br/>22 (IP admin) · 80"}}
      subgraph EC2["EC2 t3.small · Ubuntu 24.04 · EBS gp3 16 GB · ufw"]
        subgraph EDGE["red Docker: edge"]
          P["proxy<br/>nginx-unprivileged<br/>uid 101 · 0.25 CPU · 64 MB"]
        end
        subgraph INT["red Docker: internal (sin salida a Internet)"]
          A["api<br/>Node/Express · uid 1000<br/>0.5 CPU · 256 MB"]
          W["worker<br/>Node · uid 1000<br/>0.5 CPU · 256 MB"]
          D[("db<br/>PostgreSQL 16<br/>0.5 CPU · 384 MB")]
        end
        VF[("volumen files<br/>/data/originales<br/>/data/resultados")]
        VP[("volumen pgdata")]
      end
    end

    SG -->|":80 → 8080"| P
    P -->|"/api/*"| A
    A -->|"SQL como app_api<br/>INSERT + NOTIFY"| D
    W -->|"LISTEN · SKIP LOCKED<br/>como app_worker"| D
    A --- VF
    W --- VF
    D --- VP
```

`api` está conectada a las dos redes: a `edge` para que el proxy la alcance y a `internal` para
hablar con la base de datos. `worker` y `db` solo están en `internal`.

## Flujo de una entrega

```mermaid
sequenceDiagram
    participant E as Estudiante
    participant N as Nginx
    participant A as API
    participant D as PostgreSQL
    participant W as Worker
    E->>N: POST /api/actividades/:id/entregas (archivo)
    N->>N: ¿≤ 5 MB? (si no, 413)
    N->>A: reenvía
    A->>A: RBAC · matrícula · plazo RN-1 (403/404 + auditoría)
    A->>A: extensión y MIME (si no, 415) · guarda /data/originales/<user>/<uuid>
    A->>D: BEGIN · INSERT submission · INSERT job · NOTIFY · COMMIT
    A-->>E: 201 {estado: pendiente}
    D-->>W: notificación "nuevo_trabajo"
    W->>D: UPDATE ... FOR UPDATE SKIP LOCKED (en_ejecucion)
    W->>W: UTF-8 válido? SHA-256, estadísticas, duplicados
    W->>D: sha256 + estado completado (o fallido / reintento)
    E->>A: GET /api/entregas/:id/resultado
    A-->>E: JSON (sin la marca de duplicado)
```
