# ADR-0051: Licence numbers are regional: the region code and one sequence ("06-00001")

* Status: accepted (2026-11-11, product owner). Amends ADR-0047 §4. Source:
  [discovery 2026-11-11](../discovery/2026-11-11-wolaita-written-answers.md) (licence numbers).

## Context

ADR-0047 §4 numbers a licence from the **office's** gapless counter when the national platform has not issued a number.
The zone's answers show today's practice:
- **a region code followed by one sequence:** "06-00001", where 06 is South Ethiopia;
- one sequence for the whole region, not one per office.

This also matches CLAUDE.md: drivers and licences are **regional** records, and only transactions are local.

## Decision

1. **The national platform's number wins** whenever it issues one (unchanged).
2. **Otherwise the number comes from a regional counter:**
   - one gapless sequence per region, in the business transaction (ADR-0014);
   - formatted by the region's pattern; the default is `{regionCode}-{seq:05}`;
   - the region code is a region setting.
3. **The counter's scope and pattern are configuration** (`competency.licence_number`): `region` (default) or `unit`. A
   region that numbers per office keeps doing so. A licence issued under one pattern keeps its number when the pattern
   changes.
4. **No collision with numbers still issued on paper.** While the region's other zones still number licences on paper,
   the region **reserves a range** for ITRMS, and the counter starts at it (a region setting agreed with the bureau). A
   paper licence captured later (ADR-0054) keeps its printed number, which falls outside the reserved range. The unique
   index on the number refuses a collision, and such a capture is flagged to the bureau, never renumbered.
5. **Contention:** one regional counter row is a lock hotspot. Licence activation is low-volume (hundreds a day per
   region), and the lock is held only for the counter's update. It is to be measured in the performance suite (task
   1.6) against the command p95.

## Consequences

- The licence slice reads the counter's scope from settings. Licences already numbered keep their numbers.
- Imported or captured paper licences (task 1.13) keep their printed numbers; the reserved range keeps them apart.
- Lands in task 1.6 (licence family), with a test for the regional sequence under concurrency.
