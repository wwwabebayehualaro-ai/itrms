#!/bin/sh
# The files' backups (task 0.26b2, ADR-0012, ADR-0031 item 13), in the SeaweedFS image with restic:
#   itrms-files-backup run         the bucket mirrored as plain files (weed filer.backup, as they change) into /mirror, and a
#                                  restic snapshot of the mirror every night to the append-only rest-server
#   itrms-files-backup init        the restic repository, once (an existing one is kept)
#   itrms-files-backup snapshot    a snapshot now
#   itrms-files-backup mirror      the mirror's files: "<size> <sha256> <path>", one a line
#   itrms-files-backup restored    the latest snapshot restored into a scratch folder, listed the same way, then removed
#   itrms-files-backup replica     for each object key on stdin, the copy in the second store (filer.sync): the same line, or
#                                  "missing <key>"
#   itrms-files-backup put <key>   stdin into the bucket at that key (the CI drill's probe file)
# The repository's password and the rest-server's are the container's environment; cron's jobs get them from a root-only file.
set -eu
mode="${1:-run}"
secrets=/run/itrms-files-backup.env
if [ -z "${RESTIC_PASSWORD:-}" ] && [ -f "$secrets" ]; then . "$secrets"; fi
export RESTIC_REPOSITORY="rest:https://restic:8000/itrms/"
export RESTIC_REST_USERNAME=itrms
export RESTIC_REST_PASSWORD="${RESTIC_SERVER_PASSWORD:?}"
export RESTIC_PASSWORD="${RESTIC_PASSWORD:?}"
export RESTIC_CACERT=/run/backup-tls/ca.pem
export RESTIC_CACHE_DIR=/var/cache/restic
mirror=/mirror

# "<size> <sha256> <path relative to the folder>" for every file under a folder
list() (
    cd "$1"
    find . -type f | sort | while IFS= read -r f; do
        printf '%s %s %s\n' "$(stat -c %s "$f")" "$(sha256sum "$f" | cut -c1-64)" "${f#./}"
    done
)

case "$mode" in
    run)
        umask 077
        printf 'RESTIC_PASSWORD=%s\nRESTIC_SERVER_PASSWORD=%s\n' "$RESTIC_PASSWORD" "$RESTIC_SERVER_PASSWORD" > "$secrets"
        mkdir -p /etc/seaweedfs "$mirror"
        # the sink: plain files under /mirror at their object keys (the bucket's path is the source)
        cat > /etc/seaweedfs/replication.toml << EOF
[sink.local]
enabled = true
directory = "$mirror"
is_incremental = false
EOF
        # nightly at 01:30 Addis Ababa time, after the database's backup; to the container's log
        echo '30 1 * * * itrms-files-backup snapshot >> /proc/1/fd/1 2>&1' > /etc/crontabs/root
        crond -b
        # deletions too: a file the application purged (its retention) leaves the mirror, then restic's history ages it out
        exec weed filer.backup -filer=objectstore:8888 -filerPath=/buckets/itrms -doDeleteFiles
        ;;
    init)
        restic cat config > /dev/null 2>&1 || restic init
        ;;
    snapshot)
        restic backup --host itrms --tag files "$mirror"
        ;;
    mirror)
        list "$mirror"
        ;;
    restored)
        scratch=$(mktemp -d)
        restic restore latest --host itrms --target "$scratch" >&2
        list "$scratch$mirror"
        rm -rf "$scratch"
        ;;
    replica)
        tmp=$(mktemp)
        while IFS= read -r key || [ -n "$key" ]; do
            if wget -q -O "$tmp" "http://replica:8888/buckets/itrms/$key"; then
                printf '%s %s %s\n' "$(stat -c %s "$tmp")" "$(sha256sum "$tmp" | cut -c1-64)" "$key"
            else
                printf 'missing %s\n' "$key"
                # what the second store answered, and what its folders hold, once: for the operator's log
                if [ "${2:-}" = --tell ] && [ -z "${told:-}" ]; then
                    told=1
                    wget -O /dev/null "http://replica:8888/buckets/itrms/$key" 2>&1 | tail -n 2 >&2 || true
                    for dir in "${key%/*}" files ''; do
                        wget -q -O - --header 'Accept: application/json' "http://replica:8888/buckets/itrms/$dir/?limit=5" 2>&1 \
                            | cut -c1-600 >&2 || true
                        echo >&2
                    done
                fi
            fi
        done
        rm -f "$tmp"
        ;;
    put)
        key="${2:?a key}"
        dir=$(mktemp -d)
        cat > "$dir/${key##*/}"
        weed filer.copy "$dir/${key##*/}" "http://objectstore:8888/buckets/itrms/${key%/*}/" >&2
        rm -rf "$dir"
        ;;
    *)
        echo "usage: itrms-files-backup run|init|snapshot|mirror|restored|replica|put" >&2
        exit 64
        ;;
esac
