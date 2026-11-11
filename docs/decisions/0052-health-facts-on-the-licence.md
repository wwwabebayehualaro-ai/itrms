# ADR-0052: Blood group and other health facts on the licence are optional, sensitive and printed only by setting

* Status: accepted (2026-11-11, product owner). Source:
  [discovery 2026-11-11](../discovery/2026-11-11-wolaita-written-answers.md) (licence card fields).

## Context

The zone's licence card appears to show the holder's **blood group** (a low-confidence reading, to confirm), and a health certificate is required for a new licence and at
renewal. Under PDP Proclamation 1321/2024, health data is sensitive personal data. Collecting it needs a purpose, and
access needs control.

## Decision

1. **The blood group is an optional field** of data class `sensitive` (ADR-0037; health data under PDP 1321/2024).
   - It is stored field-encrypted (envelope encryption, as for other sensitive PII).
   - It is read only through the audited `reveal()`.
   - It never appears in exports, search or logs.
2. **It is printed on the card only when the region's setting says so** (`competency.card_shows_blood_group`, default
   off). The card's QR payload never carries it.
3. **Health certificates** are attachments of class `sensitive`. Only their validity date and the issuing facility
   are typed facts.
4. **Records of processing:** the DPIA lists the purpose (road safety, emergency care), the retention (the licence's life
   plus the retention period) and the roles that may reveal it.

## Consequences

- Task 1.6 adds the field and the setting, and task 1.17 adds the DPIA and retention entries.
- A region that does not print it never needs to collect it.
