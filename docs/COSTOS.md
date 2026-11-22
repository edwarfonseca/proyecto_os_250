# Bitácora de costos AWS

Presupuesto disponible al empezar: **≈ 49 USD** · Meta del proyecto: **< 6 USD** · Tope duro: **10 USD**.

El saldo del Learner Lab **no se actualiza en tiempo real** (viene de AWS Budgets con horas de
retraso): esta bitácora es la alerta temprana. Se llena **en cada sesión** en la nube.

**Semáforo** (gasto acumulado del proyecto): 🟢 < 4 USD · 🟡 4–7 USD, revisar qué corre ·
🔴 > 7 USD, parar y auditar con `scripts/auditoria_aws.sh`.

| Fecha | Saldo inicial (panel) | Hora inicio | Hora fin | Horas EC2 | Qué se hizo | Estado al salir (¿EC2 stopped? ¿EIP?) |
|-------|-----------------------|-------------|----------|-----------|-------------|-------------------------------------|
| 2026-11-21 | _(pendiente: anotar)_ | 19:30 | — | 0 | Fases 1–6 en local. Fase 0.2: auditoría de la cuenta (`docs/evidencias/aws_auditoria_inicial_*.txt`): ningún recurso activo con costo; solo infraestructura del propio lab y un stack de ECS vacío (clúster INACTIVE) de un lab anterior. | Sin recursos creados |

## Precios de referencia (us-east-1)

| Recurso | Precio | Cuándo cobra |
|---|---|---|
| EC2 `t3.small` | ≈ 0.0208 USD/h | Solo mientras está *running* |
| IPv4 pública | 0.005 USD/h | Mientras está asignada (la EIP cobra también con la instancia apagada) |
| EBS gp3 | 0.08 USD/GB-mes | **Siempre**, aunque la instancia esté apagada (16 GB ≈ 1.28 USD/mes) |
| Snapshot EBS | ≈ 0.05 USD/GB-mes | Siempre, hasta que se borre |
