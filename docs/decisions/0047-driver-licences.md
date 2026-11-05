# ADR-0047: Driver licences: the register, the national platform as the record, and what the rules assume

* Status: accepted (2026-11-05, task 0.24a). It builds on ADR-0026, ADR-0031 and ADR-0044. The product owner asked for open questions
  to be decided by the state of the art and the Ethiopian context; the assumptions are marked and are on the list for the product
  owner.

## Context

Licences fall under Proclamation 1074/2018, and MoTL is building a national platform for them (ethiopia-context.md §3). No public
interface is known. ITRMS runs the zone's work around a licence and must never hold a value that competes with the national record.

## Decision

1. **A licence is `pending_national` until the platform accepts it.** It has no number, certificate or place in a print batch before
   that. A refusal voids the record, with the reason, and the case returns for correction. A renewal changes nothing on the licence
   until it is accepted, so a refused or stalled renewal leaves the licence as it was.
2. **The platform is reached only from the worker**, through the outbox, behind the `NationalDriverPlatform` port. Its answer returns
   to the case as an event from a system actor. Requests are identified per case and licence, so a retry gets the same answer and
   makes no second licence. An answer that arrives after the case's wait has timed out moves nothing, and the next approval gets the
   same answer again.
3. **Only what the platform needs goes out:** name, birth year, sex, office and grades. No Fayda number and no full birth date until
   an agreement with the ministry says otherwise.
4. **A licence's number** is the platform's when it issues one, and otherwise comes from the office's gapless counter when the licence
   activates, so a refusal leaves no gap.
5. **The grades are configuration**: `licence_grade_types`, seeded from Art. 12. The rules are pure functions in `contracts`, so a
   screen can warn with the same rule the server decides by. `licence_grades` is what a licence carries.
6. **The full birth date is read for a rule, not shown.** `PersonsService.birthDateForRule` decrypts it for an age rule or the card,
   and records the use as `person.revealed` in the same transaction. The worker's system transactions use it too. The age check needs
   the exact date, so an applicant without one on record is refused with a message saying to add it, not approximated from the birth
   year.
7. **A renewal's card supersedes the last one**, so the old card's QR says superseded.
8. **The training-school register is organisations** of kind `training_school`. An office enters a school's completion list, and an
   application is refused until the applicant is on it (Art. 8, DVC-10).

## Assumptions, for the bureau to confirm

* *A medical examination is current for 6 months.* The proclamation sets no figure. A service's `medical_valid_months` changes it.
* *"Over 55" counts from the 55th birthday.* Art. 19(4) says over 55; this is the reading that gives the shorter term.
* *An early renewal runs from the old expiry, a late one from today.* The proclamation says only "renewed for 4 years".
* *Renewing a temporary licence makes it permanent.* Art. 15(3) makes that depend on the holder's offence and accident record, which
  the national penalty system holds and ITRMS can't read yet. The workflow gets a step for it until it can (the fact
  `renewal.temporary` is there for the guard).
* *The catalogue follows the table in ethiopia-context.md §3.1*, taken from Art. 12 because the schedule wasn't in the published text.
  Its Amharic names are our translation. Both need checking against the Negarit Gazette.
* *Exam results are recorded as the examiner decides them.* No pass mark is assumed; the bureau's marking rules may add one.

## Consequences

* A licence card has no photo yet: `person_sensitive` has no photo reference, and files are class T while a registry record needs one
  readable across the region. It is a follow-up, and the card prints without one until then.
* `licenceStatus` on the port isn't called yet. Reconciling a read copy against the platform needs a real interface first.
* Foreign keys to `parties` are hand-written in the migration: drizzle-kit reads the table files and can't load another slice's NestJS
  entry.
