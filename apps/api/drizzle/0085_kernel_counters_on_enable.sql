-- Counters set up when a service is enabled (task 1.4b4, ADR-0056). Request code (itrms_app) may insert a fresh counter: its
-- key, unit and pattern only, so it always starts at 0 with no fiscal period, and never changes a pattern. The class T
-- policy (0062) keeps the insert to the person's subtree; creating one is an audited event (numbering.counter_set_up).
GRANT INSERT ("id", "region_id", "unit_id", "key", "pattern") ON "kernel"."number_counters" TO itrms_app;
