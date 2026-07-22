FROM nginx:1.27-alpine

COPY public /usr/share/nginx/html
COPY frontend/nginx.conf.template /etc/nginx/backend.conf.template
COPY frontend/configure-nginx.sh /usr/local/bin/configure-nginx.sh

EXPOSE 80

ENTRYPOINT ["/bin/sh", "/usr/local/bin/configure-nginx.sh"]
CMD ["nginx", "-g", "daemon off;"]
