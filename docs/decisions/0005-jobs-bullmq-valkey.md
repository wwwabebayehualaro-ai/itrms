# ADR 0005: Background jobs with BullMQ on Valkey

* Status: accepted (2026-10-17, fixed)

> **Amended by [ADR-0031](0031-design-review-hardening.md)** (2026-10-18), item 9.

## Context
Reminders, SMS, PDF generation, report exports and SLA timers must not run inside API requests, because of CPU use,
latency and failures in external systems.

## Decision
* **BullMQ** queues on **Valkey**. The `worker` entry point of `apps/api` runs the consumers.
* Side effects are written as **outbox events** in the business transaction. A relay then enqueues them, deduplicated by
  event id.
* Handlers are idempotent and retried with backoff. Jobs that keep failing are parked in a dead-letter list shown to admins.
* Repeatable jobs handle schedules: the SLA sweep, renewal reminders and report snapshots.

## Consequences
* Valkey is not a system of record. Losing it loses only queued work, which the outbox can replay, so backups do not need it.
* Bull Board (MIT) or a small ITRMS admin page shows the queues.

## Licences
BullMQ: MIT. Valkey: BSD-3-Clause. Redis 7.4 and later is not used because of its source-available and AGPL licences.
