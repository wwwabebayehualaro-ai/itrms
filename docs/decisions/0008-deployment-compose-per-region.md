# ADR 0008: Docker Compose + Nginx, one installation per region

* Status: accepted (2026-10-17, fixed)

## Context
Customers are regional bureaus with their own server or a hosted machine, few operations staff and sometimes poor internet.
Data must stay in Ethiopia (PDP Proclamation 1321/2024), and each region owns its data.

## Decision
* **One installation per region**: a Docker Compose project with `nginx`, `web`, `api`, `worker`, a one-shot `migrate`,
  `keycloak`, `postgres`, `valkey`, object storage and `backup`. Zones and woredas reach it over the network.
* **Nginx** terminates TLS, serves static assets, sets security headers and rate limits, and routes `/`, `/api`, `/auth`
  (Keycloak) and `/files` (presigned object access).
* CI builds, signs and versions the images (semver). They reach a site by registry pull or as an offline tarball.
* Upgrade order: backup → `migrate` → rolling restart of `api`, `worker` and `web`.
* Rollback is the previous image, plus a restore if a migration was not backwards-compatible. Migrations follow the
  expand/contract pattern to avoid that case.

## Consequences
* No Kubernetes. One server class is sized for a region (architecture §17), and a warm standby is optional per contract.
* Cross-region work such as transfers goes through an integration API between installations (Phase 3), never a shared
  database.
* An installation runbook and a health dashboard are deliverables of Phase 1.
* The production deployment passes an INSA security evaluation before the pilot (see `docs/ethiopia-context.md` §6).

## Licences
Docker Engine and Compose: Apache-2.0. Nginx: BSD-2-Clause. Docker Desktop is proprietary, so use it on dev machines only and
only where its licence terms allow. Rancher Desktop or Docker Engine in WSL are alternatives.
