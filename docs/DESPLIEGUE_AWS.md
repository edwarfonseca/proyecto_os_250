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

Solo los puertos 80 y 443 abiertos (el 80 solo redirige a HTTPS). Comandos en [infra/security-group.md](../infra/security-group.md).

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

### Nombre fijo: `entregasegura-uptc.duckdns.org` (en vez de Elastic IP)

La IP pública cambia en cada Stop/Start. En lugar de pagar una Elastic IP se usa un subdominio
gratuito de [DuckDNS](https://www.duckdns.org): en cada arranque la EC2 le avisa de su IP nueva y el
nombre la sigue (TTL de 60 s: responde ~1 min después de encenderla).

1. En duckdns.org (entrar con Google o GitHub): escribir el subdominio → **add domain**.
2. En la EC2, por **Session Manager** (sección 3), con el token de DuckDNS a mano:
   ```bash
   sudo bash /opt/entregasegura/infra/configurar_duckdns.sh entregasegura-uptc
   ```
   El script pide el token sin mostrarlo. **No** se pasa por `infra/ssm_ejecutar.sh`: los comandos
   de Run Command quedan guardados en el historial de la consola de AWS.
3. Desde el PC: `curl http://entregasegura-uptc.duckdns.org/api/health` (después de activar HTTPS: `https://`).

Cómo funciona: [infra/configurar_duckdns.sh](../infra/configurar_duckdns.sh) guarda `DUCKDNS_DOMAIN` y
`DUCKDNS_TOKEN` en el `.env` (600, nunca en git) e instala el servicio systemd `entregasegura-duckdns`.
En cada arranque, ese servicio ejecuta [infra/duckdns.sh](../infra/duckdns.sh), que lee la IP de los
metadatos de la instancia (IMDSv2) y se la envía a DuckDNS. Corre como el usuario `entregas`, sin
capabilities y con el sistema de archivos en solo lectura. Ver cómo fue la última actualización:
`infra/ssm_ejecutar.sh 'journalctl -u entregasegura-duckdns -n 5 --no-pager -o cat'`.

Ojo: con la instancia apagada, el nombre sigue apuntando a la última IP, que AWS puede asignar a
otra persona. Usar el nombre solo con la instancia encendida.

### HTTPS con Let's Encrypt (`https://entregasegura-uptc.duckdns.org`)

Requiere el nombre de DuckDNS. Certificado gratuito de 90 días que se renueva solo.

```bash
aws ec2 authorize-security-group-ingress --group-id <SG> --ip-permissions \
  'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description="HTTPS EntregaSegura"}]'
infra/ssm_ejecutar.sh 'PRUEBA=si bash infra/configurar_https.sh' 900   # ensayo con el servidor de pruebas de Let's Encrypt
infra/ssm_ejecutar.sh 'bash infra/configurar_https.sh' 900              # certificado real y HTTPS activo
curl https://entregasegura-uptc.duckdns.org/api/health                     # desde tu PC
```

Cómo funciona ([infra/configurar_https.sh](../infra/configurar_https.sh)):

- **Reto DNS-01.** Para comprobar que el nombre es nuestro, Let's Encrypt pide publicar un código en
  un registro TXT del dominio. El gancho [infra/certbot_ganchos.sh](../infra/certbot_ganchos.sh) lo
  publica en DuckDNS con el token del `.env` y espera a que lo vean sus 9 servidores DNS. No hace
  falta abrir ningún puerto para obtener el certificado. No se envía ningún correo a Let's Encrypt.
- **Renovación.** `certbot.timer` revisa dos veces al día (y al arrancar, si se perdió una revisión)
  y renueva cuando quedan menos de 30 días. El gancho copia el certificado a `/etc/entregasegura/tls`
  (llave `640 root:101`, legible solo por el grupo de Nginx) y recarga Nginx con `HUP`, sin cortar
  conexiones. Los ganchos viven en `/usr/local/lib/entregasegura` (dueño root): un script que root
  ejecuta solo no debe poder modificarlo el usuario `entregas`.
- **Nginx.** El `.env` de la EC2 lleva `COMPOSE_FILE=docker-compose.yml:docker-compose.https.yml`, así que
  el proxy publica también el 443 y usa [proxy/nginx-https.conf](../proxy/nginx-https.conf): TLS 1.2/1.3,
  HTTP/2 y HSTS. Todo el HTTP público, por nombre o por IP, se redirige con 301 a `https://`. Solo
  `http://localhost` desde la propia EC2 sigue en HTTP (lo usan `deploy.sh` y los scripts de prueba).
- **Cookie.** `COOKIE_SECURE=true`: la cookie de sesión solo viaja cifrada.
- **En local no cambia nada:** `http://localhost`, sin certificado.
- **Volver a solo HTTP:** `infra/ssm_ejecutar.sh 'bash infra/configurar_https.sh desactivar' 900`. HSTS
  está en 1 día a propósito: los navegadores que ya entraron insistirán en HTTPS durante 24 h como máximo.

## 5. Comprobar que sobrevive al apagado (crítico)

Stop + Start y `curl https://entregasegura-uptc.duckdns.org/api/health`. Debe responder sin hacer nada:
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

- **Ya no hace falta Elastic IP:** la dirección para el docente y la demo es `https://entregasegura-uptc.duckdns.org`
  (sección 4). Solo si el docente exigiera una IP fija: EC2 → *Elastic IPs* → *Allocate* →
  *Associate*, 2–3 días antes y no antes, porque cobra aunque la instancia esté parada.
- **El día D, 30 min antes:** Start Lab → Start EC2 → `docker compose ps` →
  `curl https://entregasegura-uptc.duckdns.org/api/health` →
  sesiones abiertas de los 3 roles y una pestaña con Session Manager.
- **Después de la nota, en este orden:** `infra/ssm_ejecutar.sh './scripts/backup_db.sh'` y traer
  `backups/` y `docs/evidencias/` → **Terminate** la instancia → **Release** la Elastic IP (si se usó) →
  borrar el subdominio en duckdns.org → borrar el snapshot y el Security Group → `scripts/auditoria_aws.sh` para confirmar que no queda nada → anotar
  el saldo final.
