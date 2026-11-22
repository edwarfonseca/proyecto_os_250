# Despliegue en AWS (Fase 7) · cómo se hizo y cómo repetirlo

> Solo lo hace **una persona del equipo, en su cuenta**. Los demás trabajan en local.
> Todo se hace desde un PC con el AWS CLI conectado al Learner Lab; **no se usa SSH** (el puerto 22
> está cerrado, ver [infra/security-group.md](../infra/security-group.md)).

## 0. Rutina de cada sesión (memorízala)

```
Start Lab → conectar el CLI → EC2: Start → trabajar → anotar en COSTOS.md → EC2: Stop → End Lab
```
Si la instancia queda *running* al terminar la sesión, el Learner Lab la vuelve a encender sola en la
siguiente, aunque abras el lab para otra materia. **Párala siempre a mano.**

```bash
aws ec2 start-instances --instance-ids <ID>     # encender
aws ec2 stop-instances  --instance-ids <ID>     # apagar
aws ec2 describe-instances --filters Name=tag:Name,Values=entregasegura \
  --query 'Reservations[].Instances[].[InstanceId,State.Name,PublicIpAddress]' --output table
```

## Conectar el AWS CLI de tu PC (una vez por sesión)

1. Learner Lab: **Start Lab** → espera el círculo verde → **AWS Details** → **AWS CLI: Show**.
2. Copia el bloque completo (empieza por `[default]`).
3. En tu PC: `./scripts/conectar_aws_lab.sh`, pega el bloque, pulsa Enter y luego `Ctrl+D`.

El script guarda las credenciales en `~/.aws/credentials` (perfil `default`, permisos 600) con región
`us-east-1`, conserva tus otros perfiles y comprueba la conexión. Las credenciales **caducan al terminar
la sesión del lab**. No las pegues en chats ni las subas a git.

## 1. Security Group

Solo el puerto 80 abierto. Comandos en [infra/security-group.md](../infra/security-group.md).

## 2. Lanzar la instancia (una sola vez)

```bash
AMI=$(aws ssm get-parameters --names /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
      --query 'Parameters[0].Value' --output text)        # Ubuntu 24.04 oficial (Canonical)
aws ec2 run-instances --image-id "$AMI" --instance-type t3.small --key-name vockey \
  --security-group-ids <SG> --iam-instance-profile Name=LabInstanceProfile \
  --credit-specification CpuCredits=standard \
  --metadata-options HttpTokens=required,HttpEndpoint=enabled,HttpPutResponseHopLimit=1 \
  --block-device-mappings 'DeviceName=/dev/sda1,Ebs={VolumeSize=16,VolumeType=gp3,DeleteOnTermination=true}' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=entregasegura}]'
```

| Opción | Por qué |
|---|---|
| `t3.small`, gp3 16 GB, `DeleteOnTermination` | Presupuesto (reglas 1 y 6) |
| `CpuCredits=standard` | Sin cobro extra de CPU (regla 3). Ojo: una t3 *Standard* arranca **sin créditos**; gana ~0,4 por minuto en reposo |
| `LabInstanceProfile` | Permite administrarla con Systems Manager sin abrir el 22 |
| `HttpTokens=required` (IMDSv2) | Hardening: un SSRF no puede robar las credenciales de la instancia |
| `vockey` | Solo para SSH de emergencia (el 22 está cerrado en el Security Group) |

## 3. Administrarla sin SSH

- **Terminal interactiva:** consola de AWS → EC2 → la instancia → **Connect** → **Session Manager** →
  **Connect**. Entra como `ssm-user`; usa `sudo -i` y `cd /opt/entregasegura`.
- **Un comando desde tu PC:** `infra/ssm_ejecutar.sh 'docker compose ps'` (corre como root en
  `/opt/entregasegura` y muestra la salida).

## 4. Docker, código, secretos, hardening y despliegue

```bash
infra/ssm_ejecutar.sh 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq &&
  apt-get install -y -qq docker.io docker-compose-v2 git ufw python3 && systemctl enable --now docker &&
  git clone https://github.com/edwarfonseca/proyecto_os_250.git /opt/entregasegura' 900
infra/ssm_ejecutar.sh './scripts/generar_env.sh >/dev/null && ls -l .env'      # contraseñas nuevas, no se muestran
infra/ssm_ejecutar.sh 'bash infra/hardening_host.sh' 1500                       # usuario, SSH, ufw, parches, servicios, Docker
infra/ssm_ejecutar.sh './scripts/deploy.sh' 1800                                # construye en la EC2 y levanta todo
curl http://<IP-publica>/api/health                                             # desde tu PC
```
Contraseñas de la app en el servidor: `infra/ssm_ejecutar.sh "grep -E '^(ADMIN|DEMO)_PASSWORD' .env"`.

Para actualizar tras un `git push`: `infra/ssm_ejecutar.sh './scripts/deploy.sh' 1800`.

## 5. Comprobar que sobrevive al apagado (crítico)

Stop + Start y, con la **nueva IP**, `curl http://<nueva-IP>/api/health`. Debe responder sin hacer nada:
Docker arranca con el sistema y los contenedores tienen `restart: unless-stopped`.
(Resultado del 21 nov 2026: de vuelta en línea 38 s después del apagado.)

## 6. Pruebas en la nube (Fase 8)

```bash
for t in verificar_hardening prueba_funcional prueba_aislamiento prueba_recuperacion prueba_persistencia; do
  infra/ssm_ejecutar.sh "./scripts/$t.sh | tail -3" 1200
done
infra/ssm_ejecutar.sh './scripts/prueba_carga.sh 1 | tail -25' 1200
infra/ssm_ejecutar.sh './scripts/prueba_carga.sh 2 | tail -25' 1200
infra/traer_evidencias.sh            # copia docs/evidencias/ del servidor a tu PC
```
Antes de la carga, revisa que la instancia tenga créditos de CPU (*Monitoring → CPU credit balance*,
o `aws cloudwatch get-metric-statistics ... CPUCreditBalance`).

## 7. Antes y después de la sustentación (Fase 11)

- **2–3 días antes:** EC2 → *Elastic IPs* → *Allocate* → *Associate* a la instancia. Esa IP no
  cambia entre apagados. Cobra aunque la instancia esté parada, así que no antes.
- **El día D, 30 min antes:** Start Lab → Start EC2 → `docker compose ps` → `curl /api/health` →
  sesiones abiertas de los 3 roles y una pestaña con Session Manager.
- **Después de la nota, en este orden:** `infra/ssm_ejecutar.sh './scripts/backup_db.sh'` y traer
  `backups/` y `docs/evidencias/` → **Terminate** la instancia → **Release** la Elastic IP → borrar el
  snapshot y el Security Group → `scripts/auditoria_aws.sh` para confirmar que no queda nada → anotar
  el saldo final.
