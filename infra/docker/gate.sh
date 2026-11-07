#!/bin/sh
# A TCP gate (task 0.26a): forwards the ports in GATE_ROUTES ("listen=host:port", comma-separated) and nothing else. The
# production profile puts one between networks so that a service reaches only the one port it needs: the object store's S3
# port for the processes (not its unauthenticated master, volume and filer ports), Keycloak's port on the machine's loopback for
# the operator (not a route out for Keycloak).
set -eu
{
    # the stream module is built into the official image
    echo 'worker_processes 1;'
    echo 'error_log /dev/stderr warn;'
    echo 'pid /tmp/nginx.pid;'
    echo 'events { worker_connections 1024; }'
    echo 'stream {'
    for route in $(printf '%s' "${GATE_ROUTES:?}" | tr ',' ' '); do
        echo "    server { listen ${route%%=*}; proxy_pass ${route#*=}; }"
    done
    echo '}'
} > /etc/nginx/nginx.conf
exec nginx -g 'daemon off;'
