# Bitácora de costos AWS

Presupuesto disponible al empezar: **≈ 49 USD** · Meta del proyecto: **< 6 USD** · Tope duro: **10 USD**.

El saldo del Learner Lab **no se actualiza en tiempo real** (viene de AWS Budgets con horas de
retraso): esta bitácora es la alerta temprana. Se llena **en cada sesión** en la nube.

**Semáforo** (gasto acumulado del proyecto): 🟢 < 4 USD · 🟡 4–7 USD, revisar qué corre ·
🔴 > 7 USD, parar y auditar con `scripts/auditoria_aws.sh`.

| Fecha | Saldo inicial (panel) | Hora inicio | Hora fin | Horas EC2 | Qué se hizo | Estado al salir (¿EC2 stopped? ¿EIP?) |
|-------|-----------------------|-------------|----------|-----------|-------------|-------------------------------------|
| 2026-11-21 | Antes: 1,0 USD usados · al cerrar: **1,3 de 50** | 19:30 | 20:15 | 0,4 | Fase 0.2: auditoría de la cuenta (`docs/evidencias/aws_auditoria_inicial_*.txt`): nada activo con costo (solo infraestructura del lab y un stack de ECS vacío de un lab anterior). **Fase 7:** Security Group `entregasegura-sg` (solo 80), EC2 `t3.small` `i-0d2655639177f1265` con disco gp3 16 GB, hardening del host, despliegue, prueba Stop/Start. **Fase 8:** las 7 pruebas en AWS (todas OK). Costo estimado de la sesión: ≈ 0,02 USD. | EC2 **stopped** · disco de 16 GB existe (≈ 0,04 USD/día) · sin EIP |

**Gasto acumulado del proyecto (21 nov 2026): ≈ 0,3 USD → 🟢.** El panel incluye cargos que llegan con
horas de retraso (probablemente del laboratorio anterior con ECS); el costo estimado de la sesión del
21 nov fue ≈ 0,02 USD.

## Precios de referencia (us-east-1)

| Recurso | Precio | Cuándo cobra |
|---|---|---|
| EC2 `t3.small` | ≈ 0.0208 USD/h | Solo mientras está *running* |
| IPv4 pública | 0.005 USD/h | Mientras está asignada (la EIP cobra también con la instancia apagada) |
| EBS gp3 | 0.08 USD/GB-mes | **Siempre**, aunque la instancia esté apagada (16 GB ≈ 1.28 USD/mes) |
| Snapshot EBS | ≈ 0.05 USD/GB-mes | Siempre, hasta que se borre |
