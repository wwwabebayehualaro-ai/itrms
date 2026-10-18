# ADR 0012: Nightly off-site backups, kept inside Ethiopia

* Status: accepted (2026-10-17, fixed; the "inside Ethiopia" rule comes from the data-protection research)

> **Amended by [ADR-0031](0031-design-review-hardening.md)** (2026-10-18), item 13.

## Decision
* **PostgreSQL:** pgBackRest with a weekly full backup, a nightly differential and continuous WAL archiving, which allows
  point-in-time recovery.
* **Object storage:** nightly encrypted restic snapshots over the S3 API.
* **Configuration:** the Keycloak realm export and the Compose configuration without secrets. Secrets go in a separate
  sealed copy.
* **The off-site target is inside Ethiopia:** a second bureau or zone server, or an Ethiopian data centre. Never a foreign
  cloud, because the Personal Data Protection Proclamation 1321/2024 reportedly requires personal data to be stored in the
  country.
* **Retention:** 30 daily and 12 monthly backups.
* **Restore drill:** an automated monthly restore into a scratch stack, with a report of row counts and checksums. A failed
  drill is an incident.

## Licences
pgBackRest: MIT. restic: BSD-2-Clause.
