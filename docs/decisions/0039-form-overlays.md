# ADR 0039: Form overlays

* Status: accepted (2026-10-31, task 0.21f; the product owner decided who authors overlays and the `x_` prefix).
  It refines [ADR-0017](0017-services-as-configuration.md) ("form changes are overlays, never forks") and the three form
  tiers of [ADR-0030](0030-hybrid-delivery-builder-and-code.md).

## Context
* ADR-0017 says a unit changes a bureau form by overlay, not by copy. It did not say who writes an overlay, where it is
  stored, what it may do, or how a case is filed on it.
* A copy of a bureau form would drift from it and would drop the bureau's later fixes. A zone still needs its own
  questions on a licence application.
* Effects read fields of the bureau form (the effect contract). A unit must not be able to break that.

## Decision
1. **What an overlay is:** a unit's additions to a bureau form (a form owned at the region root). Two operations only:
   add fields right after an anchor field (a top-level added field takes the anchor's container), and narrow a choice
   field's options to part of the bureau's (labels stay the bureau's). No operation changes, hides or removes a bureau
   field. A field a service's effect contract locks is never touched.
2. **Reserved keys:** added fields take keys matching `x_…`. A bureau form or a unit-local form may not take a new `x_`
   key (lint rule `key-reserved`; keys already published keep it).
3. **Who writes it:** the office itself, with permission `form:overlay` (held by `bureau_admin` and `unit_admin`). The
   bureau never overlays; it changes its form. A unit's own (unit-local) form takes no overlay.
4. **Publishing:** maker-checker through `form_publications` (SEC-AC-6). A second person with `form:approve` at that
   office or above approves, and the approval re-checks the overlay.
5. **Storage:** `forms.form_overlays` (working copy) and `forms.form_overlay_versions` (immutable), class C at the unit.
6. **Composed versions:** a unit's new case is filed on a composed version, a row of `forms.form_versions` at the filing
   unit with `base_version_id` and `overlay_version_ids` (root side first). It is made once and reused. Open cases keep
   the version they froze. `approved_versions` approves a composed version when its base and every overlay version in it
   are approved.
7. **Which overlays apply:** the published overlays of the units on the filing unit's chain below the form's owner, root
   side first (zone, then woreda), and only where the service version's override policy opens the `formOverlay` family at
   that level (`region` for units directly below the root, `unit` deeper).
8. **Composition never fails:** an operation that no longer fits (anchor gone, key now the bureau's, option dropped, field
   locked) is passed over and reported. An overlay that would make the form unsound (a new lint error) is passed over
   whole. A new bureau version re-applies the overlays, and the publish check's impact lists each overlay and its
   conflicts.

## Consequences
* A zone adds a question without a fork. The bureau's fixes reach every unit at its next version.
* A bureau can never be surprised by a unit: effect inputs, required fields and labels are out of an overlay's reach.
* Every case on an overlay carries a composed version, so its answers stay checkable against exactly what was shown.
* Deferred: an overlay editor screen (the API only for now), overlay fields in the data viewer and filter index, columns
  in repeating sections (needs the stable rows of task 0.21g), layout changes, adding at the top of a form, overlay
  drafts at the counter, and an explicit delete (publish an empty overlay).
