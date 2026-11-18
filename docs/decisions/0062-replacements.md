# ADR-0062: Replacing a lost, stolen or damaged libre, bolo sticker or plate

* Status: accepted (2026-11-18); the points marked Z are placeholders to confirm with the zone. Tasks 1.5, 1.5b and 1.5c.

## Context

The bureau's service DVC-06 replaces a lost libre, bolo or plate. A lost or stolen item needs a police letter; a lost libre also
needs a newspaper notice 15 days before it is replaced (the zone's written answers). The old item must read lost, and its QR
document must read superseded.

## Decision

1. **One service, DVC-06.** The request names the item (libre, bolo or plate) and the reason (lost, stolen or damaged). The flow
   branches on that fact, because the three share review, payment and approval.
2. **Police letter.** A lost or stolen item needs the letter's number and date. Its scan, like the newspaper clipping, is attached
   where the office can scan; it is not required, since not every office can (Z). A damaged item is handed in instead, confirmed
   by the officer.
3. **Newspaper notice (a lost or stolen libre).** The request records the newspaper and the day it was published. The case waits
   in a notice step and moves on no earlier than the publication day plus `competency.libre_notice_days`: 15 calendar days by
   default (Z), a sensitive setting. The date is checked by the effect when the case moves on, and again when the new libre is
   given. The workflow engine counts business days only and cannot wait for a computed date.
4. **The register.**
   - **Libre:** a new libre replaces the old one, which reads lost (lost or stolen) or replaced (damaged). Its booklet comes from
     stock as for a new libre.
   - **Bolo:** the same bolo keeps its year and last day; a new sticker comes from stock.
   - **Plate:** a new national plate comes from the office's stock, with a new number (Z), and the old one ends lost, stolen or
     damaged.
5. **Documents.** The registration certificate is superseded by one for the new libre or the new plate. The bolo document is
   reissued with the new sticker. The old QR reads superseded.
6. **Holds** block a libre or a plate replacement, not a bolo sticker: checked at filing and on every step up to handing over
   the new libre's booklet or the plate.
7. **The old certificate is superseded wherever it was issued.** A vehicle that moved between offices keeps a certificate issued
   by its first office, which the replacing office cannot read. A reviewed command supersedes it within the region, named by the
   new libre that replaces the old one. The ownership transfer's revocation uses the same command.
8. **One replacement of a vehicle at a time**, claimed against transfers, exchanges and other replacements.
9. **Fees:** a replacement fee by item, plus the plate's own price when a plate is handed over. The amounts are demo
   placeholders (Z).

## Consequences

- `competency.replacements` records each replacement (migration 0092). The plate end reasons gain stolen and damaged.
- A correction of a document may name the record that replaced the old one as its subject.
