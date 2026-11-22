# Despliegue en AWS (Fase 7) · paso a paso

> Solo lo hace **una persona del equipo, en su cuenta**. Los demás trabajan en local.
> Antes de empezar: haz la auditoría de la cuenta (`scripts/auditoria_aws.sh`) y anota el saldo en `docs/COSTOS.md`.

## 0. Rutina de cada sesión (memorízala)

```
Start Lab → EC2: Start instance → anotar IP pública → trabajar → anotar en COSTOS.md → EC2: Stop instance → End Lab
```
Si la instancia queda *running* al terminar la sesión, el Learner Lab la vuelve a encender sola en la
siguiente, aunque abras el lab para otra materia. **Párala siempre a mano.**

## Conectar el AWS CLI de tu PC (opcional, una vez por sesión)

Así puedes usar `aws ...` desde tu terminal en vez de la del lab.
1. Learner Lab: **Start Lab** → espera el círculo verde → **AWS Details** → **AWS CLI: Show**.
2. Copia el bloque completo (empieza por `[default]`).
3. En tu PC: `./scripts/conectar_aws_lab.sh`, pega el bloque, pulsa Enter y luego `Ctrl+D`.

El script guarda las credenciales en `~/.aws/credentials` (perfil `default`, permisos 600) con región
`us-east-1`, conserva tus otros perfiles y comprueba la conexión. Las credenciales **caducan al terminar
la sesión del lab**: en cada sesión nueva se repite. No las pegues en chats ni las subas a git.

## 1. Lanzar la instancia (una sola vez)

En la consola: **EC2 → Instances → Launch instances**.

| Campo | Valor |
|---|---|
| Name | `entregasegura` |
| AMI | **Ubuntu Server 24.04 LTS** (64-bit x86) |
| Instance type | **t3.small** |
| Key pair | **vockey** |
| Network settings → Edit | VPC por defecto · *Auto-assign public IP*: Enable |
| Firewall | *Create security group* · nombre `sg-entregasegura` (reglas abajo) |
| Storage | **16 GiB gp3** · *Delete on termination*: Yes |
| Advanced details → Credit specification | **Standard** (¡no Unlimited!) |

Reglas de entrada del Security Group (detalle en [infra/security-group.md](../infra/security-group.md)):

| Tipo | Puerto | Origen |
|---|---|---|
| SSH | 22 | **My IP** (no `0.0.0.0/0`) |
| HTTP | 80 | Anywhere-IPv4 `0.0.0.0/0` |

## 2. Conectarse por SSH

En el Learner Lab: **AWS Details → Download PEM** (guarda `labsuser.pem`). En tu PC:
```bash
chmod 400 ~/Descargas/labsuser.pem
ssh -i ~/Descargas/labsuser.pem ubuntu@<IP-publica>
```
Si un día deja de conectar, probablemente cambió tu IP de casa: actualiza la regla 22 del
Security Group con *My IP*. **Nunca la abras a todo el mundo.**

## 3. Instalar Docker y traer el código

En la EC2:
```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git ufw python3
sudo systemctl enable --now docker
```

El repositorio es público, así que basta con clonarlo:
```bash
sudo mkdir -p /opt/entregasegura && sudo chown ubuntu:ubuntu /opt/entregasegura
git clone https://github.com/edwarfonseca/proyecto_os_250.git /opt/entregasegura
cd /opt/entregasegura
```
*Si algún día el repositorio pasa a privado*, usa una **deploy key de solo lectura**:
`ssh-keygen -t ed25519 -N '' -f ~/.ssh/entregasegura_deploy`, pega el `.pub` en
**repo → Settings → Deploy keys** (sin *Allow write access*) y clona con
`GIT_SSH_COMMAND="ssh -i ~/.ssh/entregasegura_deploy -o IdentitiesOnly=yes" git clone git@github.com:edwarfonseca/proyecto_os_250.git /opt/entregasegura`.
`scripts/deploy.sh` ya usa esa llave si existe.
*Alternativa sin GitHub:* desde tu PC, `rsync -av --exclude .env --exclude backups -e "ssh -i labsuser.pem" ./ ubuntu@<IP>:/opt/entregasegura/`.

## 4. Secretos, hardening y despliegue

```bash
cd /opt/entregasegura
./scripts/generar_env.sh                 # crea .env (600) y muestra las contraseñas: guárdalas
sudo bash infra/hardening_host.sh        # usuario de servicio, SSH, ufw, actualizaciones, servicios
sudo ./scripts/deploy.sh                 # construye las imágenes en la EC2 y levanta todo
```
**Antes de cerrar la terminal**, abre otra y comprueba que el SSH sigue entrando (el hardening
cambia su configuración; el script valida con `sshd -t`, pero no está de más).

Desde tu PC: `curl http://<IP-publica>/api/health` → `{"status":"ok","db":"ok"}` y abre `http://<IP-publica>`.

## 5. Comprobar que sobrevive al apagado (crítico)

EC2 → *Instance state* → **Stop**, espera, **Start**, y con la **nueva IP**:
```bash
curl http://<nueva-IP>/api/health
```
Debe responder sin hacer nada más: Docker arranca con el sistema (`systemctl enable docker`) y los
contenedores tienen `restart: unless-stopped`.

## 6. Pruebas en la nube (Fase 8)

```bash
cd /opt/entregasegura
sudo ./scripts/verificar_hardening.sh
sudo ./scripts/prueba_funcional.sh
sudo ./scripts/prueba_aislamiento.sh
sudo ./scripts/prueba_carga.sh 1 && sudo ./scripts/prueba_carga.sh 2
sudo ./scripts/prueba_recuperacion.sh
sudo ./scripts/prueba_persistencia.sh
```
Las evidencias quedan en `docs/evidencias/`. Tráelas a tu PC con
`scp -i labsuser.pem 'ubuntu@<IP>:/opt/entregasegura/docs/evidencias/*' docs/evidencias/`.
Antes de la carga, mira *Monitoring → CPU credit balance* de la instancia y anótalo.

## 7. Antes y después de la sustentación (Fase 11)

- **2–3 días antes:** EC2 → *Elastic IPs* → *Allocate* → *Associate* a la instancia. Esa IP no
  cambia entre apagados. Cobra aunque la instancia esté parada, así que no antes.
- **El día D, 30 min antes:** Start Lab → Start EC2 → `sudo docker compose ps` → `curl /api/health` →
  sesiones abiertas de los 3 roles.
- **Después de la nota, en este orden:** `sudo ./scripts/backup_db.sh` y copiar `backups/` y
  `docs/evidencias/` al PC → **Terminate** la instancia → **Release** la Elastic IP → borrar el snapshot →
  `scripts/auditoria_aws.sh` para confirmar que no queda nada → anotar el saldo final.
