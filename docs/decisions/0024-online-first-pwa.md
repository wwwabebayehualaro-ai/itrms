# ADR 0024: Online-first PWA for weak connections; no offline case sync

* Status: accepted (2026-10-18); revisit after the Phase 1 pilot with measured connectivity.

> **Amended by [ADR-0031](0031-design-review-hardening.md)** (2026-10-18), item 8.

## Context
Woreda and town offices reach the regional server over links that may be slow or drop. Full offline operation would need
local issuing and later merging. But receipts, gapless numbers and registry facts need the server's transaction, and merge
conflicts on them are unacceptable.

## Decision
`apps/web` is an **online-first PWA**:
* **Serwist** (service worker for Next.js) caches the app shell, fonts and message catalogues.
* **Dexie** (IndexedDB):
  * form drafts autosave locally every few seconds, and to the server when online;
  * a **submit queue** retries commands with the same `Idempotency-Key` until the server confirms, so nothing is lost or
    applied twice.
* **Uppy**: resumable S3 multipart uploads to SeaweedFS through presigned URLs, with client-side image compression (≤ 1600 px,
  WebP/JPEG) before upload.
* The UI shows the connection state and the pending queue.
* **Performance budget:** ≤ 250 KB of compressed JS per case screen, checked in CI (Next.js bundle analysis).
* Things that need the server's transaction never happen offline: receipt numbers, decisions and registry changes.

## Consequences
* An office without a connection can prepare applications (drafts and documents) but cannot finish them until the link
  returns.
* Phase 1 measures latency and outages at the pilot offices. If offline issuing is truly needed, a separate ADR designs an
  edge node per office, not browser sync.
