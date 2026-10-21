# Development stack (Docker Compose)

The services ITRMS needs on a developer machine (phase-0 task 0.3). On Windows, Docker runs through WSL2 (Docker Desktop).

```
pnpm dev:infra                   # create .env on first run, start, wait until healthy, seed
pnpm dev:infra --observability   # also Alloy, Prometheus, Loki, Tempo, Grafana, GlitchTip
pnpm dev:infra:check             # prove it works: seeds, storage isolation, telemetry round trip, GlitchTip DB
pnpm dev:infra:status            # container health
pnpm dev:infra:down              # stop; data is kept in Docker volumes
pnpm dev:infra:reset --yes       # stop and delete all local dev data
pnpm test:int                    # integration tests against the stack (S3 contract suite, …)
```

| Service | Address (127.0.0.1 only; port variable in `.env`) | Notes |
|---|---|---|
| PostgreSQL 16 | `15432` (`PG_HOST_PORT`) | database `itrms` with ltree, pgcrypto, pg_trgm, btree_gist; also `keycloak` and `glitchtip` databases; the ITRMS roles (`itrms_owner`, `itrms_app`, `itrms_system`, `itrms_backup`) are created or updated on every `dev:infra` from `platform/kernel/api/db/sql/roles.psql`, passwords in `.env` |
| Valkey 8 (queues) | `16379` (`VALKEY_QUEUES_HOST_PORT`) | BullMQ; append-only, `noeviction` |
| Valkey 8 (sessions) | `16380` (`VALKEY_SESSIONS_HOST_PORT`) | BFF sessions (ADR-0021) |
| Keycloak 26 | <http://localhost:18080> (`KEYCLOAK_HOST_PORT`) | realm `itrms` from `keycloak/realm-itrms.json`: the sign-in flow (password, then TOTP, then a passkey once one is registered), the password policy with the breached-password list (`keycloak/password-blacklists`), the Amharic/English theme (`keycloak/themes/itrms`), the `itrms-web`, `itrms-api` and `itrms-identity-admin` clients; dev users `dev.admin`, `dev.officer`, `dev.cashier` and the API seed's demo users (same ids), each asked to set up TOTP at the first sign-in (password `DEV_USER_PASSWORD`) |
| SeaweedFS 4.48 (S3) | <http://127.0.0.1:18333> (`S3_HOST_PORT`) | buckets `itrms-dev`, `itrms-test` (ADR-0020) |
| Mailpit | <http://127.0.0.1:18025> · SMTP `11025` | catches every outgoing e-mail |
| Grafana | <http://127.0.0.1:13001> | observability profile; Prometheus, Loki and Tempo provisioned |
| GlitchTip | <http://127.0.0.1:18000> | observability profile; Sentry-compatible errors (ADR-0023) |
| OTLP (Alloy) | `14317` gRPC · `14318` HTTP | observability profile |

**Ports:** an ITRMS range, so the stack runs next to a native PostgreSQL or other local stacks. `pnpm dev:infra` checks
the ports first and names any that is taken; set another value in `.env`.

**App settings:** `pnpm dev:infra` also writes the settings the API and the BFF read in development, from `.env`:
`apps/api/.env.http.local` and `apps/api/.env.migrate.local` (`pnpm --filter @itrms/api dev:start | dev:migrate | dev:seed`)
and `apps/web/.env.local` (Next.js). They are git-ignored and owner-only like `.env`. Signing in end to end:

```
pnpm --filter @itrms/api build && pnpm --filter @itrms/api dev:migrate
pnpm --filter @itrms/api dev:seed org seed/org/south-ethiopia.wolaita.yaml
pnpm --filter @itrms/api dev:seed users seed/users/wolaita.demo.yaml
pnpm --filter @itrms/api dev:seed identity      # org units → Keycloak groups, people → their units' groups
pnpm --filter @itrms/web e2e                    # starts the API (:4000) and the web app (:3000)
```

Keycloak's back-channel logout reaches the BFF on the host as `host.docker.internal:3000`.

**Readiness:** `--wait` covers the services with a Docker healthcheck. Loki and Tempo (distroless images), Alloy and
GlitchTip are checked from the host afterwards.

**Secrets:** `infra/compose/.env` is generated with random values on the first `pnpm dev:infra`, is git-ignored and is
readable only by your account (icacls on Windows, mode 600 elsewhere). The keys are listed in `.env.example`. Later runs
only append missing keys, so your port overrides and comments stay. If `.env` is lost while the data volumes exist,
`pnpm dev:infra` refuses to start (the services would not match the new secrets): run `pnpm dev:infra:reset --yes`.

**Storage isolation:** SeaweedFS's master, volume and filer listeners have no authentication, so SeaweedFS sits alone
on the `storage` network and only its S3 port is published. `pnpm dev:infra:check` proves other containers can't reach
the filer. Production adds SeaweedFS JWT security (task 0.26).

**Versions:** every image is pinned by tag and digest to a release at least two weeks old (tech-stack version rule).
Renovate proposes updates. A SeaweedFS update must pass the S3 contract suite
(`platform/integrations/test/integration/s3.contract.int.spec.ts`) unchanged.

**Production** uses its own Compose profile (TLS through Nginx, three hostnames, an egress proxy, backups): task 0.26.
