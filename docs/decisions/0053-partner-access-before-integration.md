# ADR-0053: Stakeholders get exports and limited partner accounts first; system integrations follow when a counterpart exists

* Status: accepted (2026-11-11). Source: [discovery 2026-11-11](../discovery/2026-11-11-wolaita-written-answers.md) Q19.

## Context

The zone exchanges data with its stakeholders by **letter, reports and meetings**. Asked which stakeholders have an
electronic system to connect to, it answered **"none"** (Q19.3). As far as the handwriting can be read (low confidence), it wants:
- the traffic police, the insurers, the road fund and revenue/finance linked first;
- **an MoU** for each exchange (Q19.4);
- **limited accounts of their own** for training institutions, inspection centres, garages, insurers and associations
  (Q19.5).

The decision below holds whichever way these readings are confirmed.

The architecture already has ports with fake and real adapters (§16), the outbox, and RLS class P for external parties.

## Decision

1. **First, exports.**
   - Each stakeholder report is a scheduled report: CSV/Excel/PDF, built from the typed tables, masked by the recipient's
     agreement.
   - It is delivered through the outbox as a signed e-mail attachment or an SFTP drop, or downloaded by the recipient.
   - Every delivery is logged with its recipient, its period and a hash.
2. **Second, partner accounts.**
   - A partner organisation (a training institution, inspection centre, garage, insurer or association) gets **its own
     users**, limited to:
     - its own records (class P), such as its trainees, inspections, members or policies;
     - the services it may start, such as a trainee list or an inspection result.
   - The roles are partner roles; they never hold staff permissions.
   - MFA and session rules follow the security standard.
3. **Third, system integrations.** When a counterpart has an interface, a real adapter replaces the fake behind the
   existing port (architecture §16). The adapter phases stay as planned.
4. **Every exchange has an agreement.** An MoU template (purpose, data items, legal basis, retention, security, contacts)
   comes with ITRMS. The data-sharing register lists each active agreement, and a report or account is enabled only
   against one.

## Consequences

- Exports land with the reports tasks (1.16, 2.13). Partner accounts land with the institutions they serve: 1.7 (training
  schools), 1.3 (inspection centres and garages), 1.11 (associations), 2.11 (insurers).
- The data-sharing register and the MoU template go to task 1.17 (data protection).
