# Entorno reproducible para compilar el informe IEEE (no instala nada en el PC).
FROM texlive/texlive:latest-small
RUN tlmgr install ieeetran pgfplots multirow courier helvetic && tlmgr path add
WORKDIR /doc
