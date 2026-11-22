# Security Group `entregasegura-sg`

Primera capa del firewall (la segunda es `ufw` en el host, ver `hardening_host.sh`).
AWS no permite nombres que empiecen por `sg-`, por eso no se llama `sg-entregasegura` como decía el roadmap.

## Reglas de entrada

| Puerto | Protocolo | Origen | Motivo |
|---|---|---|---|
| 80 | TCP | `0.0.0.0/0` | Acceso público a la aplicación (Nginx). **Es el único puerto abierto.** |

Todo lo demás queda **denegado por defecto**:

- **22 (SSH): cerrado.** La administración se hace con **AWS Systems Manager** (Session Manager en la
  consola web, o `infra/ssm_ejecutar.sh` desde un PC con el AWS CLI). El agente de la instancia sale
  hacia la API de AWS por HTTPS; no hace falta ningún puerto de entrada. La instancia usa el perfil
  `LabInstanceProfile` del laboratorio, que incluye la política `AmazonSSMManagedInstanceCore`.
- **3000 (API):** solo la alcanza Nginx por la red Docker `edge`.
- **5432 (PostgreSQL):** la base solo existe en la red Docker `internal`; ni siquiera se publica en el host.

### Por qué SSH cerrado y no "SSH solo desde mi IP"

El proveedor de internet del administrador usa **CGNAT**: cada conexión sale por una IP distinta de
tres rangos `/24` compartidos con sus demás clientes. Una regla `/32` fallaría a ratos,
y abrir esos rangos dejaría el 22 accesible para todos los clientes del mismo proveedor. Con Systems
Manager el 22 no se abre a nadie y la administración funciona desde cualquier red, incluida la de la
universidad el día de la sustentación.

**Acceso de emergencia:** `sshd` sigue endurecido (solo llave, sin root, solo `ubuntu`) y `ufw` permite
el 22. Si Systems Manager fallara, se añade temporalmente una regla de entrada al Security Group para
la IP del momento, se repara y se vuelve a quitar.

## Reglas de salida

Las de por defecto (todo permitido): la instancia necesita salir a Internet para `apt`, Docker Hub,
`git pull` y para hablar con Systems Manager. Los contenedores `worker` y `db` **no** tienen salida
porque están en una red Docker con `internal: true`.

## Por qué hace falta el Security Group aunque haya ufw

Docker escribe sus propias reglas de `iptables` para los puertos publicados y esas reglas se
evalúan **antes** que las de `ufw`. Un puerto publicado por Docker queda abierto aunque `ufw` diga
que no. Por eso el Security Group, que filtra fuera de la máquina, es la capa principal, y por eso
`docker-compose.yml` publica **un único puerto** (80 → 8080 de Nginx).

## Cómo se creó (AWS CLI)

```bash
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 create-security-group --group-name entregasegura-sg \
      --description "EntregaSegura: SSH solo admin + HTTP publico" --vpc-id "$VPC" \
      --tag-specifications 'ResourceType=security-group,Tags=[{Key=Name,Value=entregasegura-sg}]' \
      --query GroupId --output text)
aws ec2 authorize-security-group-ingress --group-id "$SG" \
  --ip-permissions 'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP EntregaSegura}]'
aws ec2 describe-security-group-rules --filters Name=group-id,Values="$SG" --output table
```
