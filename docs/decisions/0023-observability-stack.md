# ADR 0023: Observability with OpenTelemetry, Grafana Alloy, Prometheus, Loki, Tempo, Grafana and GlitchTip

* Status: accepted (2026-10-18)

> **Amended by [ADR-0031](0031-design-review-hardening.md)** (2026-10-18), item 14.

## Context
Each regional installation needs metrics, alerts, dashboards, searchable logs, request traces and grouped errors, run by a
small ops team on one server.

## Decision
* **Instrumentation:** the **OpenTelemetry** Node SDK in `api` and `worker` (auto-instrumentation for Fastify, pg, ioredis
  and BullMQ, plus spans around workflow transitions and effects). Next.js uses its OpenTelemetry hook. pino logs carry the
  trace id.
* **Collection:** one **Grafana Alloy** container receives OTLP and scrapes the exporters (postgres_exporter, redis_exporter
  for Valkey, nginx exporter, node_exporter, Keycloak metrics, cAdvisor), and ships container logs.
* **Storage:**
  * **Prometheus**, metrics, 30 days.
  * **Loki**, logs, 30 days.
  * **Tempo**, traces, 7 days, sampled at 10 % plus every error.
* **Dashboards and alerts:** **Grafana**, with dashboards as code in `infra/observability/`. Alerts go by email and SMS
  through ITRMS's notification adapter. The rules cover:
  * API error rate and p95 latency;
  * queue backlog and dead letters;
  * the SLA sweep not running;
  * disk above 80 %;
  * a backup older than 26 h, or a failed restore drill;
  * certificate expiry.
* **Errors:** the Sentry SDK (`@sentry/node`, `@sentry/nextjs`) reports to a self-hosted **GlitchTip**. Errors are grouped,
  with releases and source maps.
* Everything is internal-only, behind Nginx with Keycloak sign-in for the `ops` role.

## Consequences
* About 3 GB RAM for the whole stack at regional scale, which fits the server sizing (architecture §17; raise the default to
  48 GB RAM if ClamAV and the stack run together).
* A small "system status" page in ITRMS (health, queues, last backup) serves non-technical admins.
