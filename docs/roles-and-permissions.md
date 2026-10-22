# Roles and permissions

Roles are derived from the **Form 15 positions** of Wolaita Zone **[D]** (see [tenant-wolaita.md](tenant-wolaita.md) §3), not
invented. A role is a **bundle of permissions**. It is held **in an org unit** and applies to that unit's subtree (ADR-0011).
Keycloak carries roles as realm roles and the unit as group membership (ADR-0004). The API checks `@Require('resource:action')`
plus the unit scope.

Sources: **[D]** documents · **[N]** [ethiopia-context.md](ethiopia-context.md) · **[A]** assumption.

## 1. Role catalogue

Role keys are `<process>.<function>` for work-process roles, and plain names for cross-cutting roles. Each role also has an
`I18nText` display name (am / en / wal-Latn).

### Cross-cutting
| Role | Typical position (Form 15) | Where held | What it can do |
|---|---|---|---|
| `bureau_admin` | bureau ICT / process owner [A] | region | Configure services (publish service versions), fee rules, templates, languages, org levels; never decides cases |
| `unit_admin` | ICT or HR officer of the unit [A] | zone, woreda, town | Manage users and role assignments **in its subtree** (through Keycloak), unit settings, allowed overrides |
| `unit_head` | department head (መምሪያ ኃላፊ), office head (ጽ/ቤት ኃላፊ) [D] | zone, woreda, town | Read everything in the subtree, final approval steps that name it, dashboards, reports |
| `records_officer` | records / secretary (ሪከርድ፣ ጸሐፊ) [D] | every unit | Intake: create cases for applicants, register persons/organisations, scan papers, back-capture (Phase 1) |
| `cashier` | cashier / finance staff (ገንዘብ ያዥ፣ ሂሳብ ሠራተኛ) [D] | every unit with a till | Record payments, issue receipts, request reversals, close the cashier session |
| `finance_officer` | accountant (ሂሳብ ሠራተኛ) [D] | zone, woreda, town | Approve receipt reversals, cashier-session differences; revenue reports |
| `auditor` | internal audit [A] | any | Read-only on everything in the subtree, including the audit log and exports; cannot reveal masked data without `pii:reveal` |
| `viewer` | — | any | Read-only dashboards and registries (no personal data) |

### Work-process roles
For each process `p`, `p.officer` handles cases and `p.lead` decides the steps that need a lead or director. Rows marked
[D] have matching positions in the scans.

| Process (module) | `.officer` positions | `.lead` positions | Extra roles |
|---|---|---|---|
| `competency` | licensing and control experts (X–XII), data, quality and records staff; at the zone **and** at ፈርጅ-1 towns such as Boditi [D] | competency team leader (XV), at the zone and at Boditi [D] | `competency.examiner` (theory/field exams), `competency.inspector` (bolo technical inspection) [A] |
| `public_transport` | public transport officers (IX–XIII) [D, zone and woreda] | public transport director / team leader [D] | — |
| `freight` | freight competency experts [D] | freight directorate director [D] | — |
| `road_safety` | road traffic safety experts (XI–XII) [D, woreda] | safety team leader (XIV) [D] | `road_safety.ticket_writer` (Phase 2) |
| `road_quality` | quality and road asset engineers, surveyors [D] | road quality team leader (XV) [D] | — |
| `design_contracts` | design engineers, quantity surveyor, draftsman [D] | design and contract directorate director (XV) [D] | `design_contracts.contract_admin` (contract administration engineer IV) [D] |
| `community` | community participation officers [A] | process lead [A] | — |
| `logistics` | supply/procurement officers, storekeeper [D] | logistics director (XIV) [D] | `logistics.machinery_operator` (logs hours only) [D] |
| `hr` | HR officers [A] | HR lead [A] | `hr.payroll_officer` (prepares the payroll list), `hr.payroll_approver` (head who approves it) (ADR-0016) |
| `planning` | planning experts [A] | plan and budget lead [A] | — |

### External participants (from the stakeholder roles in the service list [D])
The service list names bodies outside the office that *submit* work into a process:
* association scheduling committees submit monthly schedules (PT-06);
* training institutes present the trainees who are qualified for the exam (DVC-10);
* health institutions issue medical certificates.

| Role | Holder | Scope | Phase |
|---|---|---|---|
| `org.training_school` | a training institute's account | its own organisation only: submit readiness lists, see its trainees' exam results | 1 (optional; in Phase 0 zone staff enter the lists) |
| `org.association_rep` | an association's scheduling-committee representative | its own association only: submit monthly schedules and renewals, see their status | 1 (optional) |

These are **organisation-scoped** (RLS class P), not unit-scoped, and use a separate Keycloak client. They never see other organisations' data or any case they are not party to.
Whether to offer them is an open question (§5).

A person may hold several roles (e.g. a small woreda office where one person is both records officer and cashier).
Separation of duties is enforced **per case step**, not by forbidding role combinations (§3).

## 2. Permission matrix (Phase 0 resources)

`R` read · `C` create · `U` update · `D` decide (workflow step) · `A` administer · `—` none. The scope is always the holder's
unit subtree. Registries are read region-wide (ADR-0013).

In code a permission is `resource:action` with the resource in kebab-case, as the module manifests declare it
(`org-unit:read`, `role-assignment:grant`); the kernel's roles and permissions are in `platform/kernel/module.ts`.

| Resource | bureau_admin | unit_admin | unit_head | records_officer | cashier | finance_officer | competency.officer | competency.lead | competency.examiner | auditor |
|---|---|---|---|---|---|---|---|---|---|---|
| `org_unit` | A | R (own subtree), U (names) | R | R | R | R | R | R | R | R |
| `user` (assignments) | A (region) | A (subtree) | R | — | — | — | — | — | — | R |
| `service_config` (versions, overrides) | A | U (allowed overrides) | R | R | R | R | R | R | R | R |
| `person`, `organisation` | R | R | R | C U R | R | R | C U R | R | R | R |
| `case` (any service) | R | — | R | C R | R | R | R U | R | R | R |
| case step "review" (competency) | — | — | — | — | — | — | D | D | — | — |
| case step "exam" | — | — | — | — | — | — | — | — | D | — |
| case step "approval" (competency) | — | — | D (if named) | — | — | — | — | D | — | — |
| `payment_order` | R | — | R | R | C R | R | C R | R | — | R |
| `payment`, `receipt` | R | — | R | R | C R | R | R | R | — | R |
| `receipt_reversal` | — | — | D | — | C (request) | D | — | — | — | R |
| `driver_licence` (registry) | R | — | R | R | — | — | R (via effects only) | R | R | R |
| `issued_document` | R | — | R | R | R (receipts) | R | R | R | — | R |
| `document_template` | A | — | R | — | — | — | — | — | — | R |
| `audit_log` | R | R (subtree users only) | R | — | — | — | — | — | — | R |
| `pii:reveal` (Fayda id, phone, medical data) | — | — | ✓ | ✓ (at intake) | — | — | ✓ | ✓ | — | — |
| `export` (CSV/Excel) | ✓ | — | ✓ | — | — | ✓ | — | ✓ | — | ✓ |

Registry tables (`driver_licences`, later `vehicles`, `plates` …) are never written through a generic update permission. They
change only through the workflow effects of a case (architecture §8).

## 3. Rules the API enforces
1. **Default deny:** every handler declares `@Require(...)` or `@Public`, and a startup test fails otherwise (ADR-0004).
   Roles come from ITRMS **`role_assignments`** (user × unit × role, valid from/to), resolved for the active unit. Keycloak
   token claims are never used for authorization (ADR-0031). Delegations (a substitute during leave) are time-boxed
   assignments, audited.
2. **Unit scope:** a role applies only in the unit it is held in and below. A task is offered to role holders **of the unit
   the workflow names** (`handling`, `parent`, `region`). With `parent`, the zone `competency.lead` gets the approval
   tasks of Boditi's licence cases. With `handling`, Boditi's own team leader approves. A Damot Gale officer never sees
   Boditi's cases.
3. **Separation of duties:**
   - The actor of a step listed in `separationOfDuties` cannot act on the later step (e.g. the reviewer cannot approve).
   - A cashier cannot approve their own reversal.
   - `reject` is allowed only to the roles listed by the workflow (`rejectRoles`), from non-final states.
   - **Small offices:** when separation of duties leaves nobody eligible in the unit, the task goes to the parent unit
     automatically, and this is recorded.
   - The maker of a configuration change cannot publish it when the bureau turns on maker-checker.
4. **Sensitive resources** (`user`, `service_config`, `audit_log`, `pii:reveal`, payroll in Phase 3) are never granted by
   wildcards.
5. **Every denial is audited** with the actor, unit, resource and reason.
6. **Delegation:** a `unit_admin` can assign only roles that the bureau marked delegable, and only inside its subtree. It can
   never assign `bureau_admin` or `unit_admin` at a higher level.

## 4. Seed for the demo (task 0.10 / 0.25)
| Unit | Users (generated names, not real people) |
|---|---|
| Wolaita Zone department | unit_head, unit_admin, competency.lead, 2 × competency.officer, competency.examiner, cashier, finance_officer, auditor |
| Damot Gale woreda (ምድብ 1) | unit_head, records_officer, road_safety.officer, public_transport.officer (no competency roles: no such positions [D]) |
| Boditi town (ፈርጅ 1) | unit_head, records_officer, cashier (daily revenue collector), competency.lead (team leader), competency.officer (licensing expert, also examiner) |
| South Ethiopia bureau | bureau_admin |
| Wolaita Zone + Damot Gale | `demo.dual` (Boditi cashier, zone records officer) and `demo.multi` (zone competency.officer, Damot Gale records officer): one person in two units, for the unit switcher |
| Test Zone B (tests only) | one user per role, for the isolation matrix |

## 5. Open items
1. Who in the zone holds licensing decisions: the competency directorate director alone, or the department head for some
   services?
2. Do woreda and town cashiers collect licence fees, or only the zone?
3. Who administers users at the zone and at the woreda offices?
4. Should training institutes and association representatives get their own limited accounts (Phase 1), or does zone staff
   keep entering their submissions?
