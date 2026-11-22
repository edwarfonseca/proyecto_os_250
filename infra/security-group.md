# Security Group `sg-entregasegura`

Primera capa del firewall (la segunda es `ufw` en el host, ver `hardening_host.sh`).

## Reglas de entrada

| Puerto | Protocolo | Origen | Motivo |
|---|---|---|---|
| 22 | TCP | **IP del administrador /32** | Administración por SSH con llave (`vockey`). Nunca `0.0.0.0/0`. |
| 80 | TCP | `0.0.0.0/0` | Acceso público a la aplicación (Nginx). |
| 443 | TCP | `0.0.0.0/0` | *Solo si se configura HTTPS* (opcional). |

Todo lo demás queda **denegado por defecto**. En particular **no** se abren:

- **5432 (PostgreSQL):** la base solo existe en la red Docker `internal`; ni siquiera se publica en el host.
- **3000 (API):** solo la alcanza Nginx por la red `edge`.

## Reglas de salida

Las de por defecto (todo permitido): la instancia necesita salir a Internet para `apt`, para
descargar imágenes de Docker Hub y para `git pull`. Los contenedores `worker` y `db` **no** tienen
salida porque están en una red Docker con `internal: true`.

## Por qué hace falta el Security Group aunque haya ufw

Docker escribe sus propias reglas de `iptables` para los puertos publicados y esas reglas se
evalúan **antes** que las de `ufw`. Un puerto publicado por Docker queda abierto aunque `ufw` diga
que no. Por eso el Security Group, que filtra fuera de la máquina, es la capa principal, y por eso
`docker-compose.yml` publica **un único puerto** (80 → 8080 de Nginx).

## Con AWS CLI (opcional, en la terminal del Learner Lab)

```bash
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --group-name sg-entregasegura \
      --description "EntregaSegura: SSH admin + HTTP" --vpc-id "$VPC" --query GroupId --output text)
MI_IP=$(curl -s https://checkip.amazonaws.com)
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$MI_IP/32"
aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 describe-security-groups --group-ids "$SG" --output table
```
Ojo: `checkip` desde la terminal del Learner Lab devuelve la IP de *esa* terminal, no la de tu casa.
Para la regla 22 usa tu IP real (búscala en <https://checkip.amazonaws.com> desde tu navegador).
