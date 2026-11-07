#!/bin/sh
# The egress proxy's configuration, from ITRMS_EGRESS_ALLOW (hosts or .domains, comma-separated): CONNECT on 443 to those, and
# nothing else (task 0.26a). An empty list allows nothing: an installation with no external service needs no way out.
set -eu
allow=$(printf '%s' "${ITRMS_EGRESS_ALLOW:-}" | tr ',' ' ')
{
    echo 'http_port 3128'
    echo 'acl SSL_ports port 443'
    echo 'acl CONNECT method CONNECT'
    if [ -n "$allow" ]; then
        echo "acl allowed dstdomain $allow"
        echo 'http_access allow CONNECT SSL_ports allowed'
    fi
    echo 'http_access deny all'
    echo 'cache deny all'
    echo 'access_log stdio:/dev/stdout'
    echo 'cache_log /dev/stderr'
    echo 'pid_filename none'
} > /etc/squid/squid.conf
exec squid -N -f /etc/squid/squid.conf
