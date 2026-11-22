# Nginx sin privilegios: corre como el usuario 101 y escucha en 8080 (no en 80),
# así no necesita ser root ni ninguna capability. En la EC2 escucha también
# en 8443 (HTTPS), ver docker-compose.https.yml.
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY comun.conf /etc/nginx/entregasegura/comun.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/ /usr/share/nginx/html/
EXPOSE 8080 8443
