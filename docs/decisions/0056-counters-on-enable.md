# ADR-0056: Request code sets up a fresh counter when an office is given a service

* Status: accepted (2026-11-17). Source: tasks 1.4b and 1.4b4 (an office given DVC-01 or DVC-13 after the seed could take a
  fee and then find no number series at the step that numbers the certificate or the letter).

## Context

Counters (`kernel.number_counters`, architecture.md §15) were created only by installation work as the owner (migration 0013):
the seeds set one up at every office whose type offered a service when they ran. An office created later, or given a service
later, had none until someone ran the seed again. 1.4b made the filing refuse an office with no series (409 `not_configured`),
which is honest but leaves the office unable to serve.

## Decision

1. **The manifests say what is needed.** A module declares its sequences (`numberSequences`: key, pattern, and the
   capabilities whose offices need it, such as `collects_cash` for the receipt) and, per service it serves, the counters
   the service numbers from (`countersRequired`, by `<module>.<sequence>`). The loader refuses a service the module does not
   serve and a counter no installed module declares.
2. **Office administration sets them up** in its own transaction: when an office is created, when a service is enabled
   for it, and when its override is reset, every counter its effective services and its type's capabilities need is made
   where it has none (`ensureCounter`). Each one made is an audited event (`numbering.counter_set_up`, with the reason).
3. **The grant is narrow** (migration 0085): `itrms_app` may insert only `id`, `region_id`, `unit_id`, `key` and `pattern`.
   A counter it makes therefore starts at 0 with no fiscal period; it never raises a start, changes a pattern or touches a
   counter in use. The class T policy keeps the insert to the person's subtree.
4. **The owner still does the rest:** a migrated register's start (`start_after`) is set with `setUpCounter`.

## Consequences

- An office given a service can finish it; the filing's check stays as the second line.
- A future API that changes a unit's type must set the counters up the same way.
- An office that will take over a paper register must have its start set **before** its first number: a counter made at 0
  and then used would issue numbers the paper register already has (ADR-0054 runbook).
