# ADR-0054: Paper records migrate by capture on touch, campaigns and a backlog factory

* Status: accepted (2026-11-11). Source: [discovery 2026-11-11](../discovery/2026-11-11-wolaita-written-answers.md) Q11.7.

## Context

The zone keeps **all** its vehicle files on paper: roughly 170,000–250,000 of them, about seven in eight of them motorcycles and bajajs. Licences and associations are assumed to be on paper too (the answers cover vehicle files only). A big-bang data entry before go-live would take months, delay the
pilot and import records nobody uses. Task 1.13 plans the tooling (back-capture mode, bulk import, scan attachment,
reconciliation) but not the approach.

## Decision

1. **Capture on touch.**
   - Any service on a vehicle, licence or association that has no electronic record first **back-captures** it: the
     paper file's facts in back-capture mode (original dates, the paper reference, the `migrated` flag) and the scanned
     file attached.
   - **A second person verifies** the capture before the service continues. This extends maker-checker (SEC-AC-6) to record capture.
   - Active records therefore migrate as they are used.
2. **Campaigns.** The plate exchange (1.2c) and the yearly bolo season (1.3) touch most active vehicles. Each campaign has
   a target and a daily count per office on the dashboard.
3. **A backlog factory** works through the remaining files:
   - data-entry clerks, during or outside office hours, through the bulk import or the capture screen;
   - **sampling QA:** a set share of each clerk's records re-checked against the scan; errors are counted per clerk;
   - a target rate agreed with the zone.
4. **Migration status is visible.** Every migrated record shows its source and its verifier. A reconciliation report
   counts captured, verified and missing records per office and per plate code, against the zone's paper counts.

## Consequences

- Task 1.13 moves up, to right after the stationery (1.12a) and DVC-01's booklet change (1.2d), so later vehicle services
  can rely on capture on touch.
- The phase 1 gate's "agreed share of active paper records migrated" is measured by this report.
- To agree with the zone: the backlog target, who enters data, and how far back.
