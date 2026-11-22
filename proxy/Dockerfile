# Nginx sin privilegios: corre como el usuario 101 y escucha en 8080 (no en 80),
# así no necesita ser root ni ninguna capability.
FROM nginxinc/nginx-unprivileged:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY frontend/ /usr/share/nginx/html/
EXPOSE 8080
