#!/bin/sh
# The files' backup repository (task 0.26b2, ADR-0031 item 13): restic's rest-server, append-only, over TLS (its certificate from
# the backups' CA), one user with its own repository. Clients can add snapshots but never remove or rewrite one; the retention
# (ADR-0012: 30 daily, 12 monthly) runs here, on the repository's own disk, every night at 04:00 Addis Ababa time.
set -eu
umask 077
mkdir -p /etc/rest-server /data
cp /run/backup-tls/restic.crt /etc/rest-server/tls.crt
cp /run/backup-tls/restic.key /etc/rest-server/tls.key
htpasswd -B -b -c /etc/rest-server/htpasswd itrms "${RESTIC_SERVER_PASSWORD:?}" 2> /dev/null
printf 'RESTIC_PASSWORD=%s\n' "${RESTIC_PASSWORD:?}" > /etc/rest-server/retention.env
cat > /etc/crontabs/root << 'EOF'
0 4 * * * . /etc/rest-server/retention.env && export RESTIC_PASSWORD && [ -f /data/itrms/config ] && restic -r /data/itrms forget --host itrms --keep-daily 30 --keep-monthly 12 --prune >> /proc/1/fd/1 2>&1
EOF
crond -b
exec rest-server --path /data --listen :8000 --append-only --private-repos \
    --htpasswd-file /etc/rest-server/htpasswd \
    --tls --tls-cert /etc/rest-server/tls.crt --tls-key /etc/rest-server/tls.key
