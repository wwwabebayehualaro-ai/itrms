# Form platform: dependable, state-of-the-art form building for every zone

The form builder is what lets a bureau change its services without programmers, and the main reason a zone buys a
configurable system instead of a hard-coded one. It must therefore be **as dependable as code**. A form change must never
break a licence, a fee or a report. This document defines what the form platform guarantees, how forms are governed, and
which field types it provides. Which services use it, and how far, is decided in [delivery-decisions.md](delivery-decisions.md).

## 1. What we start from (legacy engine, proven)
* One field kit for the builder and the renderer: 25 types, including repeating rows (`FormArray`) with per-row rules and
  formulas.
* Conditions (`and`/`or`/`xor`/`not`); a hidden container hides its children, and hidden values are pruned.
* Safe formulas (its own parser, no `eval`); data sources with `{{…}}` bindings; lookups that validate a field
  (`behavior.validation.remote`); computed read-only fields.
* Content-hashed, immutable versions. Every request records the version it was filled in on, and the record page shows the
  form as it was.
* Publish with maker-checker.
* A server-checked form contract (JSON Schema).
* **Server actions with a typed input model**: saving a form fails if it lacks the fields the action needs
  (`form_config.register_check`). This is the seed of §3.
* Designer: undo/redo, an inspector generated from each field type's Zod settings, keyboard shortcuts, live preview.
* A round-trip test proves the builder opens and saves every stored form unchanged.

## 2. Ten guarantees (each one is tested)

| # | Guarantee | How |
|---|---|---|
| G1 | **The server enforces every rule the browser shows** | one validation engine (`packages/forms/core`) runs in the browser and the API; parity case file in CI |
| G2 | **A published form never changes** | immutable versions; open cases keep their version; new cases take the published one |
| G3 | **Stored answers stay readable forever** | `schemaVersion` + upgrade functions; the round-trip test over every stored version in CI; unknown field types are shown, not dropped |
| G4 | **A form edit can't break the code behind it** | **form ↔ effect contracts** (§3): contract fields are locked; publishing fails if a contract is unmet |
| G5 | **Field keys are stable** | keys are immutable after the first publish; labels change freely; "removing" a field hides it in new versions and keeps its data |
| G6 | **Every change is reviewed and reversible** | draft → checks → maker-checker approval → publish with an effective date; rollback = republish a previous version; full history and diff |
| G7 | **Every change is tested before it goes live** | author-defined **form test cases** run on publish (§4); lint rules; impact analysis |
| G8 | **No code, no outside calls** | formulas are a closed grammar; data sources may call only allow-listed internal endpoints through the platform client; no scripts, no external URLs, no HTML injection |
| G9 | **Fast and accessible on office PCs** | a field subscribes only to what it reads; forms of 300 fields render in < 1 s on the reference PC; WCAG 2.2 AA (labels, error summary, keyboard order); Ethiopic typing in every text field |
| G10 | **Works through bad connections** | drafts autosave locally and on the server; the submit queue is idempotent; uploads resume (ADR-0024) |

## 3. Form ↔ effect contracts (the core of dependability)
For C+E services (delivery-decisions.md), the code (an **effect** such as `competency.createPendingLicence`) declares an
**input contract** in its module manifest:

```ts
effects: {
  'competency.createPendingLicence': {
    input: z.object({
      applicant: personRef(),                         // must come from a RegistryLookup(person) field
      licenceCategory: z.enum(LICENCE_CATEGORIES),    // a choice field whose options come from reference data
      educationLevel: z.enum(EDUCATION_LEVELS),
      medicalCertificate: fileRef({ docType: 'medical-certificate' }),
      trainingCompletion: z.object({ school: orgRef('training_school'), completedOn: ethDate() }),
    }),
  },
}
```

* A **service version** maps each contract path to a form field key (usually by the same key; the builder offers the
  mapping). Publishing fails if a contract field is missing, has the wrong type, is optional where required, or is hidden
  by a condition that can be true when the effect runs.
* Contract fields show a **lock icon** in the builder. Their key, type and required-ness can't change. Their label, help,
  layout, order and translations can. Everything around them (extra fields, sections, help texts, local checklists) is
  free.
* The effect receives **validated, typed input** (as legacy server actions did), and never parses raw answers itself.
* Result: a zone can reshape a licence application to match its paper form. It can't remove the medical certificate the
  law requires, or turn the licence category into free text.

## 4. The change lifecycle (governance)

```
draft ─► automatic checks ─► test cases ─► review (maker ≠ checker) ─► staged (training installation) ─► published (effective date) ─► monitored
  ▲                                                                                                                                    │
  └──────────────────────────────────── rollback = publish an earlier version as a new one ◄────────────────────────────────────────────┘
```

* **Automatic checks (lint)**, all at publish:
  * contract met;
  * no unreachable field (a condition that can never be true);
  * no circular formulas;
  * every visible field labelled in `am` and `en`;
  * required fields not hidden without a default;
  * option values unique;
  * the print layout fits A4;
  * no more than 300 fields;
  * data sources only on allow-listed endpoints.
* **Test cases:** the author stores sample submissions with expected outcomes ("valid"; "invalid: ዕድሜ ቢያንስ 18…"; "fee =
  1,250.00"). They run in the API with the real engine and fee rules. Bureau templates ship with their test cases, and zone
  overlays must keep them passing.
* **Impact analysis** on publish shows:
  * open cases on the current version (unaffected, kept);
  * saved views, reports and dashboard widgets that use changed or removed keys;
  * bound effects;
  * which zones' overlays are re-applied, and any conflicts.
* **Who may change what:**

| Form tier | Owner | Can change | Examples |
|---|---|---|---|
| Bureau service forms | bureau (`bureau_admin` + form-author role) | everything except contract-locked parts | licence application, bolo checklist |
| Zone/unit overlays | zone or unit admin, where the service's override policy allows | add fields after anchors, help texts, local options, layout | a local question, a zone-specific attachment |
| Unit-local forms | unit admin | everything (C services only, not bound to effects) | campaign reports, club registers, internal checklists |

## 5. Field catalogue (generic + Ethiopia- and domain-specific)

| Group | Types | Status |
|---|---|---|
| Text and numbers | text, textarea, number, masked input, email | have |
| Choices | dropdown, multi-select, radio, checkbox group, switch, tags, autocomplete | have |
| Dates | `EthDate`, `EthDateRange` (Ethiopian entry/display, Gregorian storage, fiscal-year helpers), time | **new** (0.17) |
| Structure | panel, section, fieldset, card, divider, **step** (wizard), `FormArray` (repeating rows), data table | have; step **new** (Phase 1) |
| Money and quantities | `Money` (santim, Birr formatting), `Quantity` (decimal, with unit), `Fee` (server-computed preview) | **new** (0.18) |
| Registries | `RegistryLookup` for person, organisation, vehicle, licence, association, road project; `OrgUnitPicker` | **new** (0.18) |
| Ethiopian identity and contact | `FaydaNumber` (format check, optional verification later), `EthiopianPhone` (+251 9/7, normalised), `EthiopianAddress` (region → zone → woreda → kebele from reference data, plus free detail) | **new** (0.18) |
| Vehicles and licences | `PlateNumber` (national `ETH ABC 1234` and legacy regional formats), `VIN` (check digit where applicable), `LicenceCategory` (Proclamation 1074/2018 categories from reference data) | **new** (0.18 / Phase 1) |
| Evidence | `Document` (typed upload: medical certificate, ID, libre copy; scan status), `Photo` (camera capture, compression, face crop for licence photos), `Signature` (drawn, stored as a file), `GeoPoint` (GPS for field inspections and accidents) | Document 0.18; others Phase 1 |
| Inspection | `Checklist` matrix (items × pass/fail/NA + remark; e.g. bolo technical inspection, school oversight) | **new** (Phase 1) |
| Computed | computed text/number/money (formulas), `Lookup facts` (read-only facts of a picked record) | have / extend |

Every new type is one kit definition (render + builder description + server validation) with its own tests, and is added
to the contract schema.

## 6. Authoring experience (what makes it state-of-the-art for a bureau)
* **Starter templates and reusable blocks:** "Applicant", "Vehicle", "Payment", "Attachments", "Officer remarks", "Approval
  sign-off". A block is a versioned unit, used in many forms; updating it shows the impact on every form that uses it.
* **Live preview** in `am` / `en` / `wal-Latn`, desktop and phone, **with test data**, and a **logic inspector** ("why is
  this field hidden?", with the values that drove the decision).
* **A translation table** per form with "missing" markers; Ethiopic typing in the builder too.
* **A print preview** with the official header (the same layout as the PDF).
* **A diff between versions** (fields added, removed, changed), shown in the review step.
* **Form analytics** (aggregate, no personal data): time to complete, fields with the most validation errors, drafts
  abandoned per step. They show where a form confuses staff or citizens.
* Builder accessibility and keyboard support (the legacy shortcuts are kept).

## 7. Mapping to the legacy gap register and tasks

| Capability | Legacy gap # | Task |
|---|---|---|
| Server-side validation (G1) | 1 | 0.16 |
| Server-controlled status | 2 | 0.19 |
| Access per form/unit | 3 | 0.9, 0.19 |
| Drafts | 4 | 0.20 |
| Conditional required, cross-field rules | 5 | 0.17 |
| Wizard steps | 6 | Phase 1 (1.13a) |
| Workflow per form | 7 | 0.19–0.20 |
| Notifications | 8 | 0.20 |
| Version history, diff, rollback, duplicate, import/export | 9 | 0.18a; config packages Phase 1 |
| Print, PDF, Excel | 10 | 0.17, 0.23 |
| Multi-language | 11 | 0.13, 0.17 |
| New field types | 12 | 0.17, 0.18, Phase 1 |
| Files: storage and scanning | 13 | 0.15, 1.16a |
| Data protection (sensitive fields) | 14 | 0.14, 0.18 (`sensitive` field flag → encrypted, masked) |
| Public forms and prefill | 15 | Phase 3 (citizen self-service) |
| Builder UX, accessibility tests | 16 | 0.4a, 0.18a, Phase 1 |
| Cross-form reports | 17 | `reports` module (Phase 1) |
| **Contracts, key stability, lint, test cases, impact analysis, tiers** | new | **0.18a** |
