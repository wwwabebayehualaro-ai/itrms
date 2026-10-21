#!/bin/sh
# Runs once, when the postgres volume is created: the databases and extensions. The ITRMS roles are not made here:
# `pnpm dev:infra` applies platform/kernel/api/db/sql/roles.psql on every start, so older volumes get them too.
# Passwords reach SQL as psql variables (:'var' quotes them), never pasted into the SQL text.
set -eu

psql -v ON_ERROR_STOP=1 --username postgres --dbname itrms \
    -v kc_password="$KEYCLOAK_DB_PASSWORD" \
    -v gt_password="$GLITCHTIP_DB_PASSWORD" <<'SQL'
CREATE EXTENSION IF NOT EXISTS ltree;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER DATABASE itrms SET timezone TO 'UTC';

CREATE ROLE keycloak LOGIN PASSWORD :'kc_password';
CREATE DATABASE keycloak OWNER keycloak;

CREATE ROLE glitchtip LOGIN PASSWORD :'gt_password';
CREATE DATABASE glitchtip OWNER glitchtip;
SQL
