# ADR 0022: ClamAV scans uploads (from Phase 1)

* Status: accepted (2026-10-18)

## Context
Citizens' documents (medical certificates, IDs, libres) are uploaded and later opened by staff on office PCs. Malware
scanning is expected for government systems and in the INSA evaluation.

## Decision
* **ClamAV** runs as its own container (`clamd` + `freshclam`). The worker streams file bytes to `clamd` over its TCP
  protocol.
* A confirmed upload is `pending_scan`: it cannot be downloaded, rendered or attached to a decision. The worker scans it,
  and the file becomes `clean`, or `infected` (blocked, audited, uploader and admins notified).
* Signature updates come from the official mirrors, or from a local mirror for offline sites.
* Scanning is on by default from Phase 1 and can be turned off per installation. In Phase 0, files are `clean` after the
  type, size and magic-byte checks.

## Consequences
* ClamAV needs about 1.5 GB RAM for signatures, which fits the server sizing (architecture §17).
* Scan latency (seconds) is hidden by the asynchronous flow, and the UI shows "checking file".
