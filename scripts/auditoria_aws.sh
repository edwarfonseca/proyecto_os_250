#!/usr/bin/env bash
# =====================================================================
# Fase 0.2 y Fase 11 · Inventario de todo lo que puede cobrar en la cuenta.
# SOLO LEE: no crea, no modifica y no borra nada.
# Dónde ejecutarlo: en la terminal del Learner Lab (AWS Details -> la
# terminal ya trae credenciales) o en un PC con las credenciales del lab.
# Uso:  bash auditoria_aws.sh
# =====================================================================
set -uo pipefail
REGIONES="${REGIONES:-us-east-1 us-west-2}"

# El número de cuenta se muestra enmascarado: la salida suele acabar en el repositorio.
CUENTA="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo 'SIN-CREDENCIALES')"
echo "Cuenta: ********${CUENTA: -4}"
for r in $REGIONES; do
  echo
  echo "================ Región $r ================"
  echo "-- Instancias EC2 (running cobra cómputo; stopped solo cobra disco)"
  aws ec2 describe-instances --region "$r" \
    --query 'Reservations[].Instances[].[InstanceId,InstanceType,State.Name,PublicIpAddress,Tags[?Key==`Name`]|[0].Value]' --output table
  echo "-- Volúmenes EBS (cobran SIEMPRE; 'available' = huérfano)"
  aws ec2 describe-volumes --region "$r" --query 'Volumes[].[VolumeId,Size,VolumeType,State]' --output table
  echo "-- Elastic IPs (cobran aunque la instancia esté apagada)"
  aws ec2 describe-addresses --region "$r" --query 'Addresses[].[PublicIp,AllocationId,AssociationId]' --output table
  echo "-- Snapshots propios"
  aws ec2 describe-snapshots --region "$r" --owner-ids self --query 'Snapshots[].[SnapshotId,VolumeSize,StartTime]' --output table
  echo "-- NAT Gateways (MUY caros)"
  aws ec2 describe-nat-gateways --region "$r" --filter Name=state,Values=available --query 'NatGateways[].NatGatewayId' --output text
  echo "-- Load Balancers"
  aws elbv2 describe-load-balancers --region "$r" --query 'LoadBalancers[].LoadBalancerName' --output text 2>/dev/null
  echo "-- Bases de datos RDS"
  aws rds describe-db-instances --region "$r" --query 'DBInstances[].[DBInstanceIdentifier,DBInstanceStatus]' --output text 2>/dev/null
done
echo
echo "================ Global ================"
echo "-- Buckets S3"
aws s3 ls
echo
echo "Listo. Copia esta salida a docs/COSTOS.md o a docs/evidencias/."
