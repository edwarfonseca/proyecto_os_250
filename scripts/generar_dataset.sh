#!/usr/bin/env bash
# Genera (o regenera) el dataset en dataset/. Es reproducible: siempre
# produce los mismos archivos con el mismo SHA-256.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/generar_dataset.py dataset
