# Business continuity and disaster recovery tiers

One installation per region (ADR-0008). Backups go to a second site inside Ethiopia (ADR-0012). This page states the
recovery targets and the two tiers a bureau can choose. The standard tier's figures are those of
[nfr.md](../engineering/nfr.md) and [architecture.md](../architecture.md) §17. The warm standby is the optional standby
ADR-0008 allows. Contract values are agreed with each customer (nfr.md).

## Targets

| | Standard tier (default) | Warm standby tier (optional) |
|---|---|---|
| **RPO** (data that can be lost) | ≤ 15 min (WAL archived continuously by pgBackRest) | ≤ 1 min (streaming replication) |
| **RTO** (time to service) | ≤ 8 h: a cold spare server is installed from the runbook and restored from the second site | ≤ 1 h: the standby at the second site is promoted, DNS or the reverse proxy switched |
| **Files (SeaweedFS)** | `filer.sync` to the second site | `filer.sync` to the standby's store |
| **Extra hardware** | A spare server, kept cold | A second server running at the second site |
| **Drill** | Monthly restore drill to a scratch host (automated on a monthly timer since 0.26b1) | Monthly restore drill + a quarterly switchover rehearsal |

## Warm standby: how it works

- **PostgreSQL:** a streaming replica at the second site, fed by the same pgBackRest repository and WAL archive.
  - It serves no application traffic in normal running. The read-only reporting load may use it if the bureau wants
    (task 3.13).
- **Valkey:**
  - **Queues** are rebuilt from the transactional outbox. The relay enqueues every `pending` event, and its sweep
    re-enqueues events left `enqueued` too long, with the event id as the job id. Every event not yet `done` is therefore
    queued again, and nothing is lost.
  - **Sessions** are not replicated. Staff sign in again after a switchover.
- **Keycloak:** its database is part of the PostgreSQL cluster and fails over with it.
- **Switchover:** a runbook step promotes the replica, points the proxy at the standby's application containers (already
  installed, stopped) and starts them. The old primary is fenced: it is never restarted as a primary without a rebuild.
- **Audit chain:** the hash chain continues on the promoted database. The signed daily digest off-site detects a gap.

## What does not change

- Backups stay **inside Ethiopia**. The database goes off-site through the pgBackRest repository host (pull mode), and files through append-only restic. 30 daily and 12 monthly copies are kept.
- Upgrades still take a backup first and use expand/contract migrations, so the standby is upgraded in step.
