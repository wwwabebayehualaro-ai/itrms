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
   to the case as an event from a system actor. A request's id is its case, licence and attempt, so a retry, or a new approval after a
   timeout, gets the same answer and makes no second licence. Only a refusal starts a new attempt: the holder may have put right what
   was wrong, and the platform decides afresh.
3. **Only what the platform needs goes out:** name, birth year, sex, office and grades. No Fayda number and no full birth date until
   an agreement with the ministry says otherwise.
4. **A licence's number** is the platform's when it issues one, and otherwise comes from the office's gapless counter when the licence
   activates, so a refusal leaves no gap.
5. **The grades are configuration**: `licence_grade_types`, seeded from Art. 12. The rules are pure functions in `contracts`, so a
   screen can warn with the same rule the server decides by. `licence_grades` is what a licence carries.
6. **The full birth date is read for a rule, not shown.** `PersonsService.birthDateForRule` decrypts it for an age rule and records
   the use as `person.revealed` first, in a transaction of its own as `reveal()` does: a refusal tells something of a person's age, and
   must stay on record when the step rolls back. The age check needs the exact date, so an applicant without one on record is refused
   with a message saying to add it, not approximated from the birth year.
7. **A renewal's card supersedes the last one**, so the old card's QR says superseded, and is filed with the renewal's case and office.
   **Terms never stack:** a renewal opens only near expiry, and the term is applied only to the expiry it was checked against, so a second
   open case on one licence adds nothing. **Only the licence's office renews it** (class R: its subtree writes), since the worker that
   applies an accepted renewal can't check that. Another office needs a transfer first.
8. **The training-school register is organisations** of kind `training_school`. An office enters a school's completion list, and an
   application is refused until the applicant is on it (Art. 8, DVC-10).

9. **The two services are configuration** (task 0.24b): `importLicenceServices` seeds their forms, workflows and fee rules. A renewal's
   fee is worked out when it is filed, from a grade and an expiry on the form, because cases carry no facts yet at filing. They are
   compared with the register on submit, so a wrong one can't lower the fee.

## Assumptions, for the bureau to confirm

* *The documents of Art. 14(2) are attachments, not required ones.* The officer who reviews a case sees the paper, and an office with no
  scanner still works. A bureau's form can require them.
* *A failed exam stays open for a retake*, with no limit on attempts.
* *A fee is paid after the exam and before final approval*, as in architecture.md §8.

* *A medical examination is current for 6 months.* The proclamation sets no figure. A service's `medical_valid_months` changes it.
* *A licence can be renewed from 6 months before it expires.* The proclamation sets no figure. A service's `renewal_window_months`
  changes it.
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
* **A licence card prints no birth date yet.** What a document says is stored in clear for good, and a birth date is kept encrypted, so
  printing it needs a way to supply it at rendering only. The bureau's card layout will say whether it is wanted.
* `licenceStatus` on the port isn't called yet. Reconciling a read copy against the platform needs a real interface first.
* Foreign keys to `parties` are hand-written in the migration: drizzle-kit reads the table files and can't load another slice's NestJS
  entry.
