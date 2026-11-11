# ADR-0050: The libre is the federal booklet; ITRMS records its serial and issues a registration certificate

* Status: accepted (2026-11-11, product owner). Supersedes ADR-0049. Source: the Wolaita Zone's written answers
  ([discovery 2026-11-11](../discovery/2026-11-11-wolaita-written-answers.md), Q11.2–11.3).

## Context

ADR-0049 assumed that no national booklet exists yet, so ITRMS issues the libre as its own numbered document. The zone's
answers say otherwise:
- **The federal Ministry of Transport and Logistics prints the libre** (ሊብሬ) and supplies the plates.
- The zone fills in and hands over the booklet.
- A lost libre is replaced after a police letter and a newspaper notice published 15 days before.

A booklet printed by the ministry is controlled stationery. It has a pre-printed serial, which the office must account for
one by one, like bolo stickers and receipt pads.

## Decision

1. **The libre is the federal booklet.**
   - At registration (DVC-01) and at a libre replacement, the officer issues one booklet from the office's stationery stock
     and records its **serial** on the libre row: `libres.number` = the booklet serial, and `libres.national_reference` =
     the national reference when the national system gives one.
   - ITRMS never invents a libre number.
2. **The booklet comes from controlled stationery** (task 1.12a):
   - received from the ministry or the bureau in serial ranges;
   - allocated down the unit tree;
   - issued to one case;
   - voided or spoiled with a reason;
   - reconciled at closing.
   - A serial is used once. A spoiled booklet is recorded and is never reissued.
3. **ITRMS issues a registration certificate** as the case's verifiable output:
   - an ITRMS document with a QR (ADR-0006, ADR-0045), numbered by the office's counter;
   - it names the vehicle, its owners, its plate and the booklet serial;
   - it does not replace the booklet; it lets anyone verify that the registration happened and which booklet it was
     written in.
4. **The `vehicles.libre` counter** of ADR-0049 is renamed for the registration certificate. The `vehicle-libre` template
   becomes `vehicle-registration-certificate`. The change lands in task 1.2d.

## Consequences

- Task 1.12a (controlled stationery) moves before the next vehicle services. Task 1.2d changes DVC-01's last step to
  "issue a booklet from stock + certificate".
- One libre in force per vehicle (`libres_issued_uq`) stays. A replacement marks the old booklet `replaced` or `lost`.
- If the ministry later issues digital libres, the national reference is recorded and the booklet step is switched off by
  configuration.
- To confirm with a second bureau: whether booklets are allocated region → zone → office (assumed), and the booklet's
  serial format.
