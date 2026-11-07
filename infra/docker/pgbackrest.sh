#!/bin/sh
# pgBackRest in the production profile (task 0.26b1, ADR-0012, ADR-0031 item 13): one script for its three places.
#   itrms-pgbackrest postgres ...   the database: its TLS server (the repository host pulls from it), then PostgreSQL itself
#   itrms-pgbackrest backup         the repository host: the encrypted repository, its TLS server, the nightly schedule
#   itrms-pgbackrest drill          a scratch database: the latest backup restored into an emptied volume, recovered to the end
#                                   of the archive, then PostgreSQL with no archiving (a drill never writes to the repository)
#   itrms-pgbackrest restore ...    a real restore into the database's emptied volume (pgBackRest's restore options), then exit
# Mutual TLS: each side presents its certificate (CN postgres, backup or drill), signed by the installation's backup CA, and the
# servers accept only the CNs named in tls-server-auth. Certificates come in /run/pgbackrest-tls and are copied where only the
# side's user reads them.
set -eu
role="$1"
shift
tls=/etc/pgbackrest/tls
mkdir -p "$tls"
# the official image steps down with gosu or su-exec, by version
if command -v gosu > /dev/null; then as=gosu; else as=su-exec; fi

case "$role" in
    backup) me=backup user=pgbackrest ;;
    postgres | restore) me=postgres user=postgres ;;
    drill) me=drill user=postgres ;;
    *)
        echo "usage: itrms-pgbackrest postgres|backup|drill|restore" >&2
        exit 64
        ;;
esac
cp /run/pgbackrest-tls/ca.pem "$tls/ca.pem"
cp "/run/pgbackrest-tls/$me.crt" "$tls/me.crt"
cp "/run/pgbackrest-tls/$me.key" "$tls/me.key"

# every IPv4 address of the container (musl does not resolve '*')
server="tls-server-address=0.0.0.0
tls-server-ca-file=$tls/ca.pem
tls-server-cert-file=$tls/me.crt
tls-server-key-file=$tls/me.key"

if [ "$role" = backup ]; then
    cat > /etc/pgbackrest/pgbackrest.conf << EOF
[global]
repo1-path=/var/lib/pgbackrest
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=${PGBACKREST_CIPHER_PASS:?}
# ADR-0012: thirty days back, to any moment (a weekly full, nightly differentials, the WAL between them)
repo1-retention-full-type=time
repo1-retention-full=30
start-fast=y
log-level-console=info
log-level-file=off
$server
# the database archives its WAL here; the drill restores from here
tls-server-auth=postgres=itrms
tls-server-auth=drill=itrms

[itrms]
pg1-host=postgres
pg1-host-type=tls
pg1-host-ca-file=$tls/ca.pem
pg1-host-cert-file=$tls/me.crt
pg1-host-key-file=$tls/me.key
pg1-path=/var/lib/postgresql/data
pg1-socket-path=/var/run/postgresql
EOF
    chown -R pgbackrest /etc/pgbackrest /var/lib/pgbackrest
    chmod 0600 /etc/pgbackrest/pgbackrest.conf "$tls/me.key"
    # the schedule (Addis Ababa time): a full backup on Sunday night, a differential the other nights; to the container's log
    cat > /etc/crontabs/pgbackrest << 'EOF'
0 1 * * 0 pgbackrest --stanza=itrms --type=full backup >> /proc/1/fd/1 2>&1
0 1 * * 1-6 pgbackrest --stanza=itrms --type=diff backup >> /proc/1/fd/1 2>&1
EOF
    crond -b
    exec "$as" pgbackrest pgbackrest server
fi

cat > /etc/pgbackrest/pgbackrest.conf << EOF
[global]
repo1-host=backup
repo1-host-type=tls
repo1-host-ca-file=$tls/ca.pem
repo1-host-cert-file=$tls/me.crt
repo1-host-key-file=$tls/me.key
log-level-console=info
log-level-file=off
$server
# only the repository host takes backups from here
tls-server-auth=backup=itrms

[itrms]
pg1-path=/var/lib/postgresql/data
pg1-socket-path=/var/run/postgresql
EOF
chown -R postgres /etc/pgbackrest
chmod 0600 "$tls/me.key"

if [ "$role" = drill ]; then
    # the drill always starts from nothing: its own scratch volume, emptied, then the latest backup
    data=/var/lib/postgresql/data
    mkdir -p "$data"
    find "$data" -mindepth 1 -delete
    chown postgres "$data"
    chmod 0700 "$data"
    "$as" postgres pgbackrest --stanza=itrms restore
    exec docker-entrypoint.sh postgres -c archive_mode=off
fi

if [ "$role" = restore ]; then
    exec "$as" postgres pgbackrest --stanza=itrms restore "$@"
fi

# the database: the TLS server the repository host pulls from, beside PostgreSQL
"$as" postgres pgbackrest server &
exec docker-entrypoint.sh "$@"
