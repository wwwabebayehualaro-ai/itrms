# ADR-0057: A vehicle moves between offices by linked cases, and between regions by a verifiable document; its rules are configuration

* Status: accepted (2026-11-17). Sources: Wolaita Zone's written answers 11.5 and its "vehicle data transfer document"
  ([discovery 2026-11-11](../discovery/2026-11-11-wolaita-written-answers.md), [documents](../discovery/2026-11-11-wolaita-documents.md));
  Directive 1050/2025 ([ethiopia-context.md §2](../ethiopia-context.md)); the product owner (2026-11-17: "make it dynamic
  configuration").

## Context

A vehicle whose owner moves is handed from one office to another: today the zone sends the file with a covering letter and a
"vehicle data transfer document" (plate history, vehicle facts, customs and tax numbers, holds or "none"; valid 15 days; fee
2,000 Birr). Each region is its own ITRMS installation (one database), so an office of another region, or one without ITRMS,
cannot receive the record electronically. Directive 1050/2025 gives every vehicle a federal id in a national database that
refuses a second registration in another region; it is rolling out region by region and no inter-region procedure under it is
published. Several of the rules are not yet confirmed by the zone (who charges the fee, whether the receiver re-inspects,
whether an old regional plate must be exchanged).

## Decision

1. **Within a region: linked cases, no paper.** A transfer-out case at the sending office and a transfer-in case at the receiving
   office, linked. On completion the vehicle's handling unit changes (never a copy); the source keeps its own past cases. The
   encumbrance check runs before the handover.
2. **To another region, or an office without ITRMS: a verifiable document.** The sending office issues the transfer document
   (an ITRMS document with a QR code: the zone's sections) and the vehicle is marked transferred out (read-only history). The
   receiving region registers it with a transfer-in case from the document, checked through the public verification page.
   ITRMS installations are not linked to each other.
3. **The rules are configuration, not code**, with defaults from the zone and bureau or region overrides where a rule allows:
   - the document's validity in days (default 15);
   - whether the receiving office re-inspects (default no);
   - whether a vehicle on an old regional plate must take a national plate on arriving from another region (default yes,
     through DVC-12);
   - whether a covering letter is also printed for an office that runs ITRMS (default no);
   - the fee and who charges it, as each service's own fee rule (transfer-out and transfer-in are services: a bureau gives
     either a fee or none);
   - the documents asked for, as each service's forms.
4. **The national registry later.** Once a region works on the federal system, the national registry adapter confirms the
   release at the source and the registration at the destination; the document stays the handover until then.

## Consequences

- Two catalogue services (transfer out, transfer in), not in the source list as separate codes; their numbering follows the
  catalogue's next free DVC codes.
- A region that confirms different rules changes settings or a service version, not code.
- Inter-installation exchange (an API between regions) is a later decision, when two regions run ITRMS.
