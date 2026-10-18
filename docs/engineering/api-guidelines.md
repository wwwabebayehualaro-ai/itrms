# API guidelines

Conventions for every endpoint of `apps/api` and every module. The OpenAPI contract is generated from the Zod schemas
(nestjs-zod), and a drift check runs in CI.

## 1. Shape
* Base path `/api/v1`. A breaking change means `/api/v2` for the affected resources, with at least two releases of overlap
  and a deprecation header (`Deprecation`, `Sunset`) on the old one.
* Resources are plural nouns in kebab-case: `/api/v1/driver-licences/{id}`, `/api/v1/cases/{id}/transitions`.
* Commands that aren't plain CRUD are sub-resources: `POST /cases/{id}/transitions`,
  `POST /payment-orders/{id}/payments`, `POST /documents/{id}/revocations`.
* JSON in camelCase. Ids are UUIDv7 strings. Never expose internal numeric ids.

## 2. Reading
* Lists are always paged: `?page[size]=50&page[cursor]=…` (cursor-based; max size 100). The response is
  `{ data, page: { nextCursor, size } }`. Totals only where cheap (`?count=estimate|exact`).
* Filtering: `?filter[status]=approved&filter[createdAt][gte]=2026-09-11`. Only allow-listed fields; unknown filters → 400.
* Sorting: `?sort=-createdAt,number` (allow-listed). Search: `?q=` (through the scoped search functions).
* Sparse fields and includes only where measured to help: `?include=applicant`.

## 3. Writing
* Every POST requires `Idempotency-Key` (architecture §15). PUT/PATCH use `If-Match` with the row version (optimistic
  locking → 409 `stale_version`).
* Request bodies are validated by Zod; unknown properties are rejected (no mass assignment).
* State changes on cases happen only through `transitions`; there is no generic status field to PATCH.

## 4. Errors
RFC 9457 `application/problem+json`: `type`, `title` (i18n key resolved to the user's language), `status`, `code` (stable
snake_case, documented per module), `detail`, `errors[{ path, code, message }]`, `traceId`. Common codes:

| HTTP | code | When |
|---|---|---|
| 400 | `invalid_query` | unknown filter, bad paging |
| 401 | `unauthenticated` | no or expired session |
| 403 | `forbidden` | permission or unit scope (no detail about the record) |
| 404 | `not_found` / `feature_disabled` | missing, outside scope, or module not available here |
| 409 | `stale_version`, `idempotency_in_progress`, `invalid_transition`, `duplicate_reference` | conflicts |
| 422 | `validation_failed`, `idempotency_mismatch`, `not_eligible` | business or field validation |
| 429 | `rate_limited` | with `Retry-After` |

## 5. Data formats
* **Money:** `{ "amountSantim": "123450", "currency": "ETB" }`. Amounts are strings carrying integers, so no JS float
  rounding is possible on either side.
* **Dates:** business dates as `YYYY-MM-DD` (Gregorian); timestamps as RFC 3339 with offset. Ethiopian dates are a display
  concern of the client (`packages/ethiopian-calendar`), never sent as the stored value.
* **Text:** `I18nText` as `{ "am": "…", "en": "…", "wal-Latn": "…" }` for data names. Personal names are separate Ethiopic
  and Latin fields.
* **Sensitive fields** are never returned by default; `GET /persons/{id}/sensitive?reason=…` is the audited reveal.

## 6. Security and operations
* Every route declares `@Require('resource:action')` or `@Public()` (startup test).
* Responses carry `X-Request-Id`. Problem bodies carry the trace id, so users can quote it to support.
* Rate limits per user and per IP on sign-in, search, exports and public verification.
* Exports and reports over the size limit return `202 Accepted` with a job resource and notify the user when ready.
* Service accounts (other government systems) use the same API, scoped to their unit and permission subset.
