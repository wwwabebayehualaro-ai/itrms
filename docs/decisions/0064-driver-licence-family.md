# ADR-0064: The driver licence family

* Status: accepted (2026-11-19); the points marked Z are placeholders to confirm with the zone. Tasks 1.6 and 1.6a–1.6i.
  It applies ADR-0051 (regional licence numbers) and ADR-0052 (health facts on the licence), and builds on ADR-0047 (the
  licence register and the national driver platform) and ADR-0054 (back-capture).

## Context

Only the new licence (DVC-03) and the renewal (DVC-04) run today. The licence is numbered per office
(`{unit}/DL/{seq:06}`), although ADR-0051 decided one regional sequence. The card's own serial is not kept. The blood
group (ADR-0052) has nowhere safe to go: form answers are still stored as plain JSONB (follow-up SEC-PD-1). The rest of
the family (upgrade, replacement, verification letter, suspension and cancellation, international licence, a file from
another region, the paper back-capture and the temporary permit while the region prints) does not exist.

## Decision

1. **One licence per person, carrying its grades.** A new-licence application from a person who holds an active licence
   in the region is refused and pointed to the grade upgrade (from task 1.6f, when the upgrade exists; until then today's
   behaviour stands). Upgrade, renewal, replacement, transfer-in and back-capture keep the licence's number for life.
2. **Numbers.** Only the activation of a new licence takes a number. It comes from the region's one counter on the
   region's root unit, pattern `<region code>-<seq:05>` ("06-00001"), taken in the worker (system actor) when the national
   platform accepts. The national platform's number wins when it gives one. The region code and the first number are
   region settings (`competency.licence_number`, Z); scope `unit` keeps today's per-office numbering. Filing a new licence
   checks that the regional counter exists through a reviewed definer that answers only for that counter and the caller's
   region. A paper number that collides is refused and flagged, never renumbered (ADR-0051 §4).
3. **The card serial** printed on the card sits beside the number, unique in the region, recorded when a printed batch
   comes back (task 1.12a), and searchable.
4. **Health facts are never form answers.** The blood group is recorded by a register command into a field-encrypted
   table (class R), only when the region turns collection on (`competency.card_shows_blood_group`, off by default, Z). It
   is read in clear only through the audited `reveal()`, with a reason and a recent second factor, by the competency lead
   and only for licences handled in the lead's subtree. Lists, search, exports, logs, the QR and the ITRMS card document
   show only that one is on record; only the region's print list (task 1.8) carries the value. Medical conditions from the
   health bureau's report (task 1.6a) follow the same rule.
5. **Services are configuration plus competency effects**, with new codes: DVC-18 grade upgrade, DVC-19 licence
   replacement, DVC-20 verification letter (am or en), DVC-21 suspension and cancellation record, DVC-22 licence file from
   another region, MIG-02 paper back-capture; DVC-08 international licence keeps its code. Every letter takes the office's
   counter and carries a QR.
6. **The national system.** Only new licences, renewals and upgrades go to the national driver platform. A suspension or a
   cancellation is recorded from the deciding authority's reference (a court, the traffic police, the penalty system, a
   licensing body) and never decided by ITRMS. A cancellation revokes the card document; a suspension blocks the other
   licence services and shows in the register, and the QR keeps verifying (showing a suspension on the verification page
   is a follow-up). An international licence is the federal authority's: ITRMS forwards the request and records its
   number. Arrived and back-captured licences are active with their origin's number and no national reference until task
   1.14 reconciles them.
7. **The temporary driving permit.** While the region prints, the renewal, replacement and upgrade issue a permit letter
   with a validity window (`competency.driving_permit_days`, 90, Z). Handing over the card closes it and revokes its
   document.

## Consequences

* The demo's region codes and first numbers are guesses until the zone answers (Z).
* Until SEC-PD-1 lands, no form may ask for a health fact.
* 1.7 (exams), 1.8 (print batches and their distribution), 1.12b (appeals), 1.14 (national adapters and reconciliation),
  1.15 (reminders) and 1.17 (the DPIA) build on this and are not pulled into 1.6.
