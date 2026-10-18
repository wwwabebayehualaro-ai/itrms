# ADR 0010: Licence policy

> **Superseded by [ADR-0025](0025-tool-selection-capability-first.md)** (2026-10-18): tools are chosen capability-first;
> licences are recorded in a report, not a gate.

* Status: accepted (2026-10-17, fixed)

## Decision
* **Allowed:** MIT, ISC, BSD-2/3-Clause, 0BSD, Apache-2.0, PostgreSQL, BlueOak, CC0 and the Unlicense; fonts under the SIL
  OFL; data under CC-BY (e.g. caniuse-lite).
* **Flagged:** GPL, LGPL, AGPL, MPL, SSPL, BSL/BUSL, Elastic, "source-available" and custom licences. A flagged package
  needs a decision recorded in this folder before it is used. MPL is allowed only unmodified, and only for build and test
  tools.
* CI runs a licence check over the lockfile against `licence-allowlist.json` (with `license-checker-rseidelsohn` or a small
  script). A new flagged package fails the build until an exception is recorded.

## Current findings (from `docs/audit.md` §8)
* `@react-pdf-viewer/*`: custom licence. **Remove it** and use `pdfjs-dist` (Apache-2.0).
* `sharp` libvips binaries: LGPL-3.0, an optional dependency of Next.js. Turn off image optimisation or exclude `sharp`.
* `lightningcss`, `axe-core`: MPL-2.0, used for build and test only. Allowed as an exception.
* Not adopted without a decision:
  * MinIO: AGPL-3.0 (ADR-0007).
  * ClamAV: GPL-2.0.
  * Grafana and Loki: AGPL-3.0.
  * Redis 7.4 and later: RSAL/SSPL/AGPL (Valkey is used instead).
