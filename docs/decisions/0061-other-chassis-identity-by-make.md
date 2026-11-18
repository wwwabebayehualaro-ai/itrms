# ADR-0061: An 'other' chassis number is told apart by its make

* Status: accepted (2026-11-18) as a placeholder, to confirm with the zone; task 1.13j.

## Context

A vehicle built before 1981, or one whose number is not VIN-shaped, has an 'other' chassis number, declared as such by the
officer. Two such vehicles of different makes can carry the same folded chassis text. Today the chassis key is unique per region,
so the second vehicle is refused and the paper register cannot be migrated whole.

## Decision

1. **A real VIN (ISO 3779) stays unique per region on its key alone.** An 'other' chassis number is unique per region on its key
   **plus its make**, folded (NFKC, upper case, letters and digits only). The zone has not yet confirmed that the make is enough.
2. **A real VIN and an 'other' number with the same key still conflict**, whatever the make: the rule holds in the application,
   under the chassis lock every filing takes.
3. **Every path follows the same rule:** registration (DVC-01), back-capture (MIG-01), the paper-register import and the arrival
   (DVC-17). It also applies to the open-case claims, whose facts carry the make key for an 'other' chassis. A case filed before
   this rule claims on the chassis alone, which is the cautious side.
4. **A shared chassis text is a notice, not a refusal.** When a vehicle of another make carries the same 'other' text, DVC-01 and
   DVC-17 show it to the lead at approval. An arrival matching a vehicle that left the region but has another make is a new
   vehicle with that notice.
5. **The make key is a written column**, computed by the application like the chassis key, so claims and lookups fold exactly as
   the stored key does.

## Consequences

- A make typed two ways ("Toyota", "Toyta") could register one vehicle twice. The notice is the guard until a make catalogue
  exists (follow-up).
- A search by chassis can find two vehicles; the lists show make and model.
