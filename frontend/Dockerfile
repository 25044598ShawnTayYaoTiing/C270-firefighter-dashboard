FROM nginx:1.27-alpine

COPY public /usr/share/nginx/html
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY frontend/validate-backend-url.sh /docker-entrypoint.d/05-validate-backend-url.sh

RUN chmod +x /docker-entrypoint.d/05-validate-backend-url.sh

EXPOSE 80
