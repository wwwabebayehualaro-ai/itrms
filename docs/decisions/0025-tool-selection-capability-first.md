# ADR 0025: Tool selection is capability-first; licences are recorded, not a gate

* Status: accepted (2026-10-18). It **supersedes ADR-0010** (permissive-only licence policy).
* Decided by: the product owner ("don't worry about license but also check the SOTA and capable tools which I can use in a
  normal manner").

## Decision
* Tools are chosen for **capability, maturity, active maintenance and fit** for a small ops team on one regional server.
  The licence is recorded for each component; it is **not** a reason to pick a weaker tool.
* Copyleft infrastructure (AGPL/GPL/LGPL/MPL) is used normally as **separate, unmodified services or build tools**: Grafana,
  Loki, ClamAV, k6, sops and the like.
* Still avoided, for practical reasons rather than licence ideology:
  * tools that are **unmaintained**, or have no official builds (e.g. MinIO community edition since its upstream archive);
  * libraries whose terms **require a paid commercial licence** for our use, unless the product owner buys one (e.g.
    `@react-pdf-viewer`), because selling ITRMS to bureaus is commercial use;
  * copying copyleft *library* code into ITRMS's own packages (AGPL/GPL libraries linked into `apps/*` or `packages/*`).
    Using such a library is a product-owner decision, recorded in an ADR.
* CI keeps a **licence report** (not a gate) in the release artefacts. Customers and the INSA evaluation ask for it.

## Consequences
* ADRs that chose a tool only because of its licence are revisited in `docs/tech-stack.md`. The observability stack becomes
  Grafana + Prometheus + Loki + Tempo with Alloy, load testing becomes k6, secrets use sops + age, dependency updates use
  Renovate, and `sharp` image optimisation is back on.
* ADR-0007's MinIO remains replaced by SeaweedFS (ADR-0020), now for **maintenance** reasons.
