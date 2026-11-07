#!/bin/sh
# The files' backups (task 0.26b2, ADR-0012, ADR-0031 item 13), in the SeaweedFS image with restic:
#   itrms-files-backup run              the stored files (the bucket's files/, never quarantine/) mirrored as plain files into
#                                       /mirror as they change (weed filer.backup), and a restic snapshot of the mirror every
#                                       night to the append-only rest-server
#   itrms-files-backup init             the restic repository, once (an existing one is kept; any other error is shown)
#   itrms-files-backup snapshot         a snapshot now
#   itrms-files-backup mirror           for each object key on stdin, the mirror's copy: "<size> <sha256> <key>", or
#                                       "missing <key>"
#   itrms-files-backup replica          the same, for the copy in the second store (filer.sync)
#   itrms-files-backup restored         the same, for the latest snapshot restored into a scratch folder (removed after, also
#                                       when the restore fails)
#   itrms-files-backup restore <dir>    a real restore: the latest snapshot into <dir> (the files under <dir>/mirror/files)
#   itrms-files-backup put <key>        stdin into the bucket at that key (the CI drill's probe file)
# The repository's password and the rest-server's are the container's environment; cron's jobs get them from a root-only file.
set -eu
mode="${1:-run}"
secrets=/run/itrms-files-backup.env
if [ -z "${RESTIC_PASSWORD:-}" ] && [ -f "$secrets" ]; then . "$secrets"; fi
export RESTIC_REPOSITORY="rest:https://restic:8000/itrms/"
export RESTIC_REST_USERNAME=itrms
export RESTIC_REST_PASSWORD="${RESTIC_SERVER_PASSWORD:?}"
export RESTIC_PASSWORD="${RESTIC_PASSWORD:?}"
export RESTIC_CACERT=/run/files-tls/ca.pem
export RESTIC_CACHE_DIR=/var/cache/restic
mirror=/mirror

# a value in single quotes for a file that is sourced: an operator's password may hold any character
quote() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }

# for each key on stdin, the file under a folder at that key: "<size> <sha256> <key>", or "missing <key>"
check() {
    while IFS= read -r key || [ -n "$key" ]; do
        if [ -f "$1/$key" ]; then
            printf '%s %s %s\n' "$(stat -c %s "$1/$key")" "$(sha256sum "$1/$key" | cut -c1-64)" "$key"
        else
            printf 'missing %s\n' "$key"
        fi
    done
}

case "$mode" in
    run)
        umask 077
        printf 'RESTIC_PASSWORD=%s\nRESTIC_SERVER_PASSWORD=%s\n' "$(quote "$RESTIC_PASSWORD")" \
            "$(quote "$RESTIC_SERVER_PASSWORD")" > "$secrets"
        mkdir -p /etc/seaweedfs "$mirror/files"
        # the sink: plain files under /mirror at their object keys
        cat > /etc/seaweedfs/replication.toml << EOF
[sink.local]
enabled = true
directory = "$mirror/files"
is_incremental = false
EOF
        # nightly at 01:30 Addis Ababa time, after the database's backup; to the container's log
        echo '30 1 * * * itrms-files-backup snapshot >> /proc/1/fd/1 2>&1' > /etc/crontabs/root
        crond -b
        # deletions too: a file the application purged (its retention) leaves the mirror, then restic's history ages it out
        exec weed filer.backup -filer=objectstore:8888 -filerPath=/buckets/itrms/files -doDeleteFiles
        ;;
    init)
        # restic's exit code 10: no repository there yet; anything else (the network, TLS, the password) is the error itself
        status=0
        restic cat config > /dev/null 2>&1 || status=$?
        if [ "$status" = 10 ]; then
            restic init
        elif [ "$status" != 0 ]; then
            restic cat config > /dev/null
        fi
        ;;
    snapshot)
        restic backup --host itrms --tag files "$mirror"
        ;;
    mirror)
        check "$mirror"
        ;;
    restored)
        scratch=$(mktemp -d)
        trap 'rm -rf "$scratch"' EXIT INT TERM
        restic restore latest --host itrms --target "$scratch" >&2
        check "$scratch$mirror"
        ;;
    restore)
        restic restore latest --host itrms --target "${2:?a folder}"
        ;;
    replica)
        tmp=$(mktemp)
        trap 'rm -f "$tmp"' EXIT INT TERM
        while IFS= read -r key || [ -n "$key" ]; do
            if wget -q -O "$tmp" "http://replica:8888/buckets/itrms/$key"; then
                printf '%s %s %s\n' "$(stat -c %s "$tmp")" "$(sha256sum "$tmp" | cut -c1-64)" "$key"
            else
                printf 'missing %s\n' "$key"
            fi
        done
        ;;
    put)
        key="${2:?a key}"
        dir=$(mktemp -d)
        trap 'rm -rf "$dir"' EXIT INT TERM
        cat > "$dir/${key##*/}"
        weed filer.copy "$dir/${key##*/}" "http://objectstore:8888/buckets/itrms/${key%/*}/" >&2
        ;;
    *)
        echo "usage: itrms-files-backup run|init|snapshot|mirror|replica|restored|restore <dir>|put <key>" >&2
        exit 64
        ;;
esac
