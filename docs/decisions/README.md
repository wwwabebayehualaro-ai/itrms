# Architecture decision records

One short record per fixed decision. `accepted` means the product owner fixed it, so a task must not re-open it. To change
one, write a new ADR that supersedes it. Format: context, decision, consequences, licence notes.

| # | Decision | Status |
|---|---|---|
| [0001](0001-monorepo-pnpm-turborepo.md) | Monorepo: pnpm workspaces + Turborepo | accepted |
| [0002](0002-nestjs-modular-monolith.md) | Backend: NestJS modular monolith on Fastify; FastAPI retired | accepted |
| [0003](0003-postgresql-drizzle.md) | Database: PostgreSQL 16 + Drizzle ORM and migrations | accepted |
| [0004](0004-keycloak.md) | Identity: Keycloak (2FA, groups per org unit), role + tenant guards | accepted |
| [0005](0005-jobs-bullmq-valkey.md) | Background jobs: BullMQ + Valkey | accepted |
| [0006](0006-documents-pdf.md) | Documents: HTML templates → PDF (Puppeteer), QR verification, Noto Sans Ethiopic | accepted |
| [0007](0007-object-storage-minio.md) | Files through the S3 API only | accepted; server choice superseded by 0020 |
| [0008](0008-deployment-compose-per-region.md) | Deployment: Docker Compose + Nginx, one installation per region | accepted |
| [0009](0009-testing-ci.md) | Tests and CI: Vitest, Playwright, GitHub Actions | accepted |
| [0010](0010-licence-policy.md) | Licence policy: permissive only | **superseded by 0025** |
| [0011](0011-tenancy-org-tree-rls.md) | Multi-tenancy: org-unit tree, shared schema, guards + RLS | accepted |
| [0012](0012-backups.md) | Nightly off-site backups (inside Ethiopia) | accepted |
| [0013](0013-regional-registries-local-transactions.md) | Registries are regional, transactions are local | accepted |
| [0014](0014-money-and-numbering.md) | Money as integer santim; gapless document numbers | accepted |
| [0015](0015-time-calendar-languages.md) | Addis Ababa time, Gregorian storage, Ethiopian display; per-tenant languages | accepted |
| [0016](0016-payroll-list-scope.md) | HR prepares the office payroll list; Finance pays | accepted (2026-10-17, replaces "payroll out of scope") |
| [0017](0017-services-as-configuration.md) | Every service is configuration, inherited down the tree | accepted |
| [0018](0018-audit-log.md) | Append-only audit log in the same transaction | accepted |
| [0019](0019-typed-core-jsonb-answers.md) | Typed core tables; form answers in JSONB linked to records and form version | accepted |
| [0020](0020-object-storage-seaweedfs.md) | SeaweedFS as the S3 server (replaces MinIO in 0007) | accepted (2026-10-18) |
| [0021](0021-bff-sessions-in-valkey.md) | BFF sessions server-side in Valkey (amends 0004) | accepted (2026-10-18) |
| [0022](0022-clamav-upload-scanning.md) | ClamAV scans uploads from Phase 1 | accepted (2026-10-18) |
| [0023](0023-observability-stack.md) | OpenTelemetry + Alloy + Prometheus/Loki/Tempo + Grafana; GlitchTip for errors | accepted (2026-10-18) |
| [0024](0024-online-first-pwa.md) | Online-first PWA (Serwist, Dexie, Uppy); no offline case sync | accepted (2026-10-18) |
| [0025](0025-tool-selection-capability-first.md) | Tools chosen capability-first; licences recorded, not a gate (supersedes 0010) | accepted (2026-10-18) |
| [0026](0026-unit-types.md) | Unit types and a settings hierarchy; one pattern for every office | accepted (2026-10-18) |
| [0027](0027-vertical-slice-modules-and-entitlements.md) | Vertical-slice module packages, registries as modules, entitlements (refines 0002) | accepted (2026-10-18) |
| [0028](0028-menu-and-workspace-model.md) | Menus declared by modules, computed per user and unit, bureau overlay; shell and command palette | accepted (2026-10-18) |
| [0029](0029-design-tokens-and-theming.md) | Design tokens, themes, branding within limits, Ethiopic-first typography | accepted (2026-10-18) |
| [0030](0030-hybrid-delivery-builder-and-code.md) | Hybrid delivery: builder for capture and configuration, code for money, registries and complex work | accepted (2026-10-18) |
| [0031](0031-design-review-hardening.md) | Hardening from the 2026-10-18 design review: RLS without bypass, per-unit role assignments, PII encryption, payment verification, wait states, exposure, backups | accepted (2026-10-18) |

All tool choices and the answers to the technical open questions: [`../tech-stack.md`](../tech-stack.md).
