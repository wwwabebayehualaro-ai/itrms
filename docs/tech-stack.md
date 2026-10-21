# Technology choices (decided)

The product owner delegated all technical choices on 2026-10-18 and asked for **state-of-the-art, capable tools that can be
used normally**. Licences are recorded but do not decide (ADR-0025). This document answers every **technical** open question
in the other docs. Business questions (fees, receipts, translators, who decides what) stay open in [README.md](README.md).

The fixed stack decisions (ADRs 0001–0009, 0011–0019) stand. Detail changes are recorded in ADRs 0020–0032 (0021 amends 0004; 0032 amends 0001, 0002 and 0027;
0027 refines 0002; 0031 amends several after the design review).

**Version rule:** every dependency is pinned to an exact release that is at least two weeks old when it is added. Upgrades go
through **Renovate** (grouped, monorepo-aware, weekly) with CI as the gate. Versions marked ✔ were checked on the npm
registry or the project page on 2026-10-18.

## 1. Answers to the technical open questions

| # | Question (where it was open) | Decision | Why it is the best fit |
|---|---|---|---|
| T1 | S3 server (ADR-0007, phase-0 Q1) | **SeaweedFS** ≥ 4.30. **ADR-0020** | MinIO's community edition is archived upstream, with no official builds or security fixes. SeaweedFS is actively released, feature-rich (presigned URLs, multipart, versioning, replication, tiering), and runs as one container on one server. Garage is the lighter alternative but lacks versioning |
| T2 | drizzle-kit (ADR-0003) | drizzle-kit ✔ 0.31.x with Drizzle ORM | Current; generates reviewed SQL migrations |
| T3 | PostgreSQL driver | **`pg` (node-postgres)** via Drizzle | The most mature driver; transaction-local `set_config` for RLS; works with PgBouncer later |
| T4 | UUIDv7 on PostgreSQL 16 | Generated in the app with **`uuid`** v7 | PG16 has no native `uuidv7()`; app-side keeps index locality |
| T5 | Images in Next.js | Keep **`next/image` with `sharp`** (default) | Licence no longer a concern; thumbnails of photos and scans load fast on slow links |
| T6 | PDF viewer (replacing `@react-pdf-viewer`, which needs a paid licence and is stale) | **react-pdf** ✔ 11 (pdf.js 6 inside), wrapped as `PdfViewer` in `packages/ui` | The maintained React wrapper of pdf.js; React 19 ready |
| T7 | 2FA (ADR-0004) | **TOTP required** for staff; **passkeys/WebAuthn** offered; no SMS OTP | TOTP works on any phone without network; passkeys are the modern phishing-proof option where devices allow |
| T8 | BFF token storage | **openid-client** ✔ 6 + opaque session cookie + **sessions in Valkey** (through **ioredis** 5, the client BullMQ uses), sealed with AES-256-GCM (node:crypto). **ADR-0021** | Keycloak tokens exceed cookie limits; server-side sessions allow instant revocation |
| T9 | Zod DTOs + OpenAPI | **nestjs-zod** ✔ 5 + `@nestjs/swagger`; API docs UI with **Scalar** ✔ | One Zod schema drives validation and OpenAPI; Scalar is the modern, searchable OpenAPI reference |
| T10 | Web → API client | **openapi-typescript + openapi-fetch** ✔ (replacing axios), wrapped by TanStack Query | Fully typed from the contract, tiny, no codegen runtime |
| T11 | Malware scanning (architecture §14) | **ClamAV** (`clamd` container), from **Phase 1**. **ADR-0022** | The standard open-source scanner; files are quarantined until clean |
| T12 | Monitoring, logs, traces, errors (default profile: Alloy, Prometheus, Loki, Grafana; optional profile: Tempo, GlitchTip; ADR-0031) | **OpenTelemetry SDK** in api/worker/web → **Grafana Alloy** → **Prometheus** (metrics) + **Loki** (logs) + **Tempo** (traces), with **Grafana** dashboards and alerting. Errors: **Sentry SDK → GlitchTip** (self-hosted, Sentry-compatible). **ADR-0023** | The de-facto standard open observability stack; one collector; traces link a slow request to its SQL and jobs; GlitchTip gives error grouping without Sentry's heavy self-hosted footprint |
| T13 | Load testing | **k6** (scripts in `tests/load`) | The most capable scripted load tester (thresholds, scenarios, CI-friendly) |
| T14 | Excel export and import | **ExcelJS** (streaming writer) in the worker; its reader for imports (the org import, task 0.8) | The most capable open library (styles, merged Amharic headers, fonts, large files by streaming). Release cadence is slow, so it is kept behind a small `ExcelWriter` interface |
| T15 | Decimal arithmetic | **decimal.js**; money stays `bigint` santim | Exact BOQ and valuation maths |
| T16 | Dates | **date-fns 4 + @date-fns/tz**; Ethiopian calendar in our own package | Tree-shakeable; clean timezone handling. Switch to Temporal when Node 26 LTS ships it unflagged |
| T17 | Weak connectivity (phase-0 Q10, technical part) | **Online-first PWA**: **Serwist** ✔ 9 (service worker for Next.js), **Dexie** ✔ 4 (IndexedDB drafts and submit queue), **Uppy** ✔ (resumable S3 multipart uploads, client-side image compression). **ADR-0024** | The current toolkit for resilient Next.js PWAs; nothing is lost on a dropped link and nothing is applied twice (Idempotency-Key) |
| T18 | Search | **PostgreSQL** `pg_trgm` + full-text search on folded names. **Meilisearch** is the upgrade path if instant fuzzy search over 10⁶+ records is needed (Phase 2+) | Postgres covers office scale with one service less |
| T19 | Maps (Phase 2) | **MapLibre GL JS** + **PMTiles** (self-hosted Ethiopia extract, OSM data) | Vector maps without an internet tile server |
| T20 | Backups (ADR-0012) | **pgBackRest** (SFTP repo at the second site, PITR) + **restic** to **rest-server** ✔ in `--append-only` mode at the second site | The strongest PostgreSQL backup tool; append-only protects against ransomware on the main server |
| T21 | TLS | The bureau's certificate, or **certbot** with Let's Encrypt where there is public DNS | Standard with Nginx (ADR-0008 fixes Nginx) |
| T22 | Images and delivery | GHCR, images signed with **cosign**; offline sites get `docker save` tarballs + checksum + signature | Verifiable installs on poor links |
| T23 | Secrets | **sops + age**: encrypted env files in a private ops repo, decrypted on deploy into Compose secrets | The standard for encrypted config in git |
| T24 | Runtimes | **Node.js 24 LTS** (move to Node 26 LTS in Phase 1), **pnpm 12** (native binary; build scripts allowed per package in `allowBuilds`), **TypeScript 6.0** (TypeScript 7, the native compiler, once typescript-eslint supports it; it supports `<6.1` today), **Vitest 5**, **Turborepo 2.11**, **Next.js 16 + React 19**, **NestJS 11 + Fastify 5**, **PostgreSQL 16** (fixed), **Valkey 8**, **Keycloak 26**, **BullMQ 5**, **Puppeteer** (Chrome for Testing pinned) | Current LTS lines; Node 24 is supported to April 2028 |
| T25a | Building module packages | One `drizzle.config` listing every module's schema files → one migrations folder; the API **bundled** by Nest's webpack builder with `swc-loader` (workspace packages bundled in, decorator metadata on); `unplugin-swc` in Vitest (ADR-0032) | Correct ordering across schemas; `nest build -b swc` alone compiles only the app's source root, not workspace packages |
| T25 | Boundary enforcement | **dependency-cruiser** in CI + package `exports`; **ESLint 10** (flat config, per-file config lookup; incl. the React Compiler rules) + typescript-eslint (type-aware) + Prettier | Readable boundary rules; keeps the existing lint setup |
| T26 | Rate limiting | **@fastify/rate-limit** with the Valkey store | Shared limits across api replicas |
| T27 | Queue admin UI | **Bull Board** behind `jobs:admin` | Mature; no extra service |
| T28 | Email | **nodemailer** (SMTP); **mailpit** in dev | Standard |
| T29 | E2E sign-in with TOTP | **otplib** | Unattended Playwright journeys |
| T30 | DB in tests | **Testcontainers** (PostgreSQL 16 + ltree, Valkey, SeaweedFS, Keycloak) | Identical locally and in CI |
| T31 | Security scanning | **gitleaks** (secrets), **Trivy** (images and dependencies, SBOM), **Semgrep** CE (code), a **licence report** (not a gate) | Covers what the INSA evaluation asks for |
| T32 | Fee formulas | The engine's safe parser in `packages/form-engine/core`, with a **BigInt santim mode** and explicit rounding | One evaluator in browser and API; no floats |
| T33 | SMS (technical part) | One `SmsGateway` interface: HTTP adapter, GSM-7/UCS-2 segmentation (Ethiopic needs UCS-2, 70 characters per part), delivery receipts, a fake for dev. **The vendor is chosen by the bureau's contract** | The interface is fixed now |
| T34 | Fayda (Phase 3, technical part) | OIDC against the NIDP's eSignet with openid-client | Same library as the BFF |
| T35 | Online payments (Phase 3, technical part) | A `PaymentProvider` interface supporting several providers at once (MoF Directive 1069/2025), HMAC-verified webhooks, idempotent settlement, a daily reconciliation job. **Providers chosen by contract** | Interface now; vendors later |
| T36 | Workflow timers and long-running steps | Our own JSON workflow engine on **BullMQ** delayed jobs + a sweep (architecture §8). **Temporal** was considered and rejected for now | Temporal is the most capable durable-execution engine but adds a cluster and a programming model to run per region. The engine's needs (SLA timers, escalation) fit BullMQ. Revisit if workflows grow long-running integrations |
| T37 | API docs and contract tests | OpenAPI from nestjs-zod → **Scalar** UI (internal) and the typed client; contract drift check in CI | As in the legacy project, modernised |
| T38 | URL state (list filters, sort, paging, tabs) | **nuqs** 2 (typed search parameters for the App Router) | Every list view becomes a shareable deep link without hand-written parsing; type-safe on server and client |
| T39 | Pre-commit hooks | **lefthook** 2 (Prettier, ESLint, gitleaks on staged files) and **`turbo gen`** (`@turbo/gen`) generators for slices | lefthook is a fast single binary with parallel hooks; `turbo gen` is Turborepo's own Plop-based generator, so no extra scaffolding tool |
| T40 | S3 client (dev seeding, contract tests; later the ObjectStore adapter, task 0.15) | **AWS SDK for JavaScript v3**: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` | The reference S3 client: presigned URLs, multipart, signed content length; modular, so only S3 is bundled |
| T41 | Self-hosted fonts (ADR-0029: Noto Sans, Noto Sans Ethiopic, Noto Sans Mono) | **`@fontsource-variable/noto-sans`, `noto-sans-ethiopic`, `noto-sans-mono`** 5 (OFL), imported by `@itrms/ui/styles.css`. The Keycloak sign-in theme serves the same font from its own resources (static `@fontsource/noto-sans-ethiopic` 5.3 WOFF2 files and their OFL in `infra/compose/keycloak/themes/itrms`, task 0.10a) | Variable WOFF2 split per script with `unicode-range`, bundled by Next.js and served from the app, so there are no CDN requests and offline installations work. Versioned and updated by Renovate like any dependency |
| T42 | Theme switching | **next-themes** 0.4 inside `AppearanceProvider` (light, dark, high contrast, system), plus the design system's own density store | Sets the theme class before the first paint (no flash), follows the system setting, syncs tabs; the density uses the same pre-paint approach |
| T43 | CI while GitHub-hosted runners are unavailable | **`pnpm ci:local`** (`tools/ci-local.mjs`, ADR-0034): the `ci.yml` jobs in Docker's Linux engine; Trivy pinned by digest (0.75.0) | The same commands and scanner images as `ci.yml`, from a clean copy of the commit, with a written record; no paid runners and no second pipeline to maintain |
| T44 | Patterns written by form authors (validation, conditions) | **re2js** 2.8 (pure-JavaScript port of Google's RE2) in the form-engine core | Linear-time matching, so an author's pattern can't freeze the browser or the API (ReDoS, SEC-IN-2); no native addon, runs in both; rejects look-around and back-references, which the designer reports |
| T45 | Design-system documentation and component tests | **Storybook** 10 (`@storybook/react-vite`, addons docs, a11y, vitest; Tailwind 4 through `@tailwindcss/vite`) in `packages/ui`; stories run as **Vitest browser tests** (`@vitest/browser-playwright`, headless Chromium) with axe as a gate | One story is the documentation, the accessibility check (in every theme and density) and the screenshot; the Vitest addon runs stories in a real browser without a running Storybook server |
| T46 | Visual regression | **Playwright** 1.63 `toHaveScreenshot` over the built Storybook, in the pinned `mcr.microsoft.com/playwright:v1.63.0-noble` image (the `stories` CI job; `pnpm ci:local --jobs stories --update-visual` makes the baselines) | Screenshots stored in the repository, compared in one Linux image with the bundled Noto fonts, so they mean the same everywhere; no hosted screenshot service |
| T47 | Form builder internals (carried from the legacy web app with the form engine, task 0.5) | **@dnd-kit/core** 6 (drag and drop on the canvas), **Immer** 10 (document edits as recipes), **Zustand** 5 (one builder store with undo/redo), **lodash** 4 (`isEqual` only) in `packages/form-engine` | Already in use and tested by the builder e2e; replacing them is not part of moving the engine. Revisited when the builder is reworked (tasks 0.17–0.18) |
| T48 | API process skeleton (task 0.6) | **NestJS 11** (`@nestjs/common`, `core`, `platform-fastify`; peers **reflect-metadata** 0.2 and **RxJS** 7), **Fastify 5** (the version `platform-fastify` pins), **nestjs-zod** 5, **pino** 9 (redaction), metrics through the OpenTelemetry SDK (**@opentelemetry/sdk-metrics** 2 + **@opentelemetry/exporter-prometheus**, served at `/metrics`), built by **@nestjs/cli** 11 (its webpack builder) with **swc-loader** and **@swc/core**; tests with **unplugin-swc** (`@itrms/config/vitest/nest`) | One bundle per process (T25a); OpenTelemetry instead of prom-client so the same SDK later pushes OTLP to Alloy (ADR-0023). Exact versions: `apps/api/package.json` and `platform/kernel/package.json` (releases at least two weeks old) |
| T49 | Data files (the org seeds and imports, task 0.8) | **yaml** 2 (eemeli/yaml) for YAML seeds; CSV read by a small RFC 4180 reader in the org import; Excel by ExcelJS (T14) | YAML is the readable format for seed data reviewed in pull requests (anchors keep repeated teams short); `yaml` has no dependencies and follows YAML 1.2. A CSV reader is a few lines, so no CSV library |

## 2. The full stack at a glance

| Layer | Tools |
|---|---|
| Monorepo and quality | pnpm 12, Turborepo 2.11 (+ `turbo gen`), TypeScript 6.0, ESLint 10, Prettier, lefthook, dependency-cruiser, Renovate |
| Web | Next.js 16, React 19, next-intl, nuqs, TanStack Query/Table/Form, Zod 4, Tailwind 4, shadcn/ui + Radix, lucide, Recharts, react-pdf, Serwist, Dexie, Uppy, openapi-fetch, openid-client, ioredis, jose (logout tokens), `@sentry/nextjs` → GlitchTip |
| API and worker | NestJS 11, Fastify 5, nestjs-zod, @nestjs/swagger + Scalar, Drizzle ORM + drizzle-kit, pg, jose, uuid, decimal.js, date-fns + @date-fns/tz, pino, OpenTelemetry SDK, @fastify/rate-limit, BullMQ 5, Bull Board, Puppeteer, LiquidJS, qrcode, ExcelJS, yaml, nodemailer, `@sentry/node` → GlitchTip |
| Data | PostgreSQL 16 (ltree, pgcrypto, pg_trgm, btree_gist), Valkey 8, SeaweedFS |
| Identity | Keycloak 26 (TOTP, passkeys) |
| Edge and operations | Nginx, certbot, Docker Engine + Compose, cosign, sops + age, pgBackRest, restic + rest-server, Grafana Alloy, Prometheus, Loki, Tempo, Grafana, GlitchTip, ClamAV (Phase 1) |
| Tests and CI | Vitest (unit and browser mode), Storybook 10, Playwright + axe-core, Testcontainers, fast-check, otplib, k6, gitleaks, Trivy, Semgrep, GitHub Actions |

## 3. Considered and not chosen
| Tool | Why not |
|---|---|
| MinIO (community) | Archived upstream; no official builds or security fixes |
| Garage | Simpler, but no object versioning; SeaweedFS is more complete |
| `@react-pdf-viewer` | Paid commercial licence and stale; react-pdf covers the need |
| Auth.js / NextAuth | Weaker control of Keycloak refresh-token rotation and server-side sessions than openid-client |
| class-validator | A second validation system next to Zod |
| Elasticsearch / OpenSearch | Heavy to run per region; PostgreSQL (later Meilisearch) suffices |
| Full offline sync (PouchDB/CouchDB, ElectricSQL) | Conflict resolution on money and registry records is a risk; revisit with pilot measurements (ADR-0024) |
| Temporal | Powerful but another cluster per region; BullMQ covers current needs (T36) |
| Microservices | ITRMS needs one transaction across case + registry + receipt + audit + outbox, RLS defined once, and one image per regional server. Load is ~10⁶ cases/year per region (a few per second at peak). A modular monolith (ADR-0002, ADR-0027) gives module boundaries without distributed transactions. Extraction stays possible, as for `worker-documents` |
| General-purpose chat (built-in messenger) | It would create an unaudited side channel next to the workflow, raise records-management problems, and compete with Telegram, which staff already use. Instead: case conversation (comments, mentions, live updates) on each case, plus opt-in, content-free Telegram notifications |
| Kafka | Volume is tens to hundreds of events per second at peak; the transactional outbox (PostgreSQL) + BullMQ (retries, delays for SLA timers, dead letters) covers it. Kafka needs a ≥ 3-node cluster and operational skill a bureau does not have, and it would still need the outbox for transactional consistency. If a national event hub is ever needed, only the outbox relay's destination changes (NATS JetStream or Redpanda evaluated first) |
| Self-hosted Sentry | Needs a large stack (Kafka, ClickHouse); GlitchTip gives the same SDK experience on Postgres + Valkey |
