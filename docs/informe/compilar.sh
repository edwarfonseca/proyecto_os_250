#!/usr/bin/env bash
# Compila docs/informe/informe.tex -> docs/informe/EntregaSegura_IEEE.pdf usando Docker.
# Uso:  ./docs/informe/compilar.sh
set -euo pipefail
cd "$(dirname "$0")"
IMG=entregasegura-latex:local
docker image inspect "$IMG" >/dev/null 2>&1 || docker build -q -t "$IMG" .
for pasada in 1 2 3 4; do   # se repite hasta que las referencias cruzadas se estabilizan
  docker run --rm -u "$(id -u):$(id -g)" -v "$PWD":/doc -w /doc "$IMG" \
    pdflatex -interaction=nonstopmode -halt-on-error informe.tex > compilacion.log 2>&1 \
    || { tail -40 compilacion.log; exit 1; }
  [[ $pasada -ge 2 ]] && ! grep -q 'Rerun to get' compilacion.log && break
done
mv informe.pdf EntregaSegura_IEEE.pdf
rm -f informe.aux informe.out
echo "PDF: docs/informe/EntregaSegura_IEEE.pdf ($(pdfinfo EntregaSegura_IEEE.pdf 2>/dev/null | awk '/^Pages/{print $2}') páginas)"
grep -E 'Overfull|Warning' compilacion.log | grep -vE 'Font shape|Underfull' | head -10 || true
