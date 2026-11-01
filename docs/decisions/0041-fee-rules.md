# ADR 0041: Fee rules

* Status: accepted (2026-11-01, task 0.22a). It refines architecture.md §9 and ADR-0014 (money and numbering); it reverses
  neither.

## Context
* Every service charges by configuration (CLAUDE.md "every service is configuration"): a fee rule, versioned like a form
  or workflow, named by a service version and frozen with the case.
* The fee the counter shows while the request is filled in must be the fee the case keeps, and money is never a float
  (ADR-0014).
* The regional fee schedules are not known yet (docs/README.md B2): the rules must take a bureau's real amounts as data,
  and the questions the schedule leaves open (how a "month" of penalty is counted, which day a corrected request counts
  to, who approves amounts) must be configuration, not code (product owner, 2026-11-01).

## Decision
1. **The rule document** (`feeRuleSchema`, `packages/schemas`): named inputs (an answer of the request through the service
   version's `inputMap['fees.rule']`; a fact of the case is in the format, but refused until cases carry facts at
   filing) and up to 20 lines: `fixed`, `table` (an amount by an
   input's value, an `otherwise` amount), `perUnit` (an amount times a whole quantity, with caps), `percent` (a share of
   earlier lines in basis points). A line may hold a `when` condition.
2. **Money never passes through a formula.** Amounts are santim as text in the rule and `bigint` in the evaluator. A
   formula gives only a condition or a whole quantity (checked before use); a share is rounded half up to the santim,
   once, on its line. Formulas read only the rule's inputs and `asOf`.
3. **Started months are the rule's choice:** `startedMonths(a, b)` counts 30-day months, `startedEthMonths(a, b)` months
   of the Ethiopian calendar (a month is up on the same day of a later month, or the month's last day when it is
   shorter, as Pagume is). `reassessAsOf` (`filing` by default, or `reassessment`) says which day a corrected request's
   fee counts to.
4. **One evaluator** (`evaluateFee`, `packages/form-engine/core`) runs the preview and the filing, on the day in Addis
   Ababa the server sets, over the answers as filing settles them.
5. **Maker-checker.** A rule is written at the region's root; each version is decided once by another person, in a role
   the region's setting `fees.rules.approverRoles` names (default: `bureau_admin` or `finance_officer`, by Ethiopian
   practice). A service version may name only an approved version of an active rule of the region's own. Content
   rejected once is not proposed again as it was. A seed approves only a demo version (placeholder amounts); a real
   schedule waits for a person's decision.
6. **The request form meets the rule** as an effect's input contract, read alone (`standalone`): every input, optional
   ones too, is an unconditional field of the right kind, open to every role and not computed from other fields (the
   preview sends only the inputs, so each must settle the same with or without the rest of the form); locked in the
   builder and against overlays; never Sensitive, by itself or by a container (a preview is not an audited read). The
   form shows the fee in a Fee field that is always shown. A workflow that changes the request must run `fees.assess`
   on those transitions.
7. **The case keeps its fee** in `fees.case_fees` and `case_fee_lines` (class T at the handling unit, append-only):
   number 1 when the request is filed, one more each time a correction changes it, at the case's handling unit then.
   The filing must send the figure it showed (422 `fee_not_shown` without it, for a service with a request form); a
   different figure now refuses it (409 `fee_changed`), so the clerk sees the new fee before the case starts.
8. **`POST /api/v1/fees/preview`** is a read sent as POST: it stores nothing, keeps no idempotency record
   (`@NotReplayable`), and its first call from the form sends no answers (it learns the inputs).

## Consequences
* A bureau's fee schedule is a seed or an approved new version, never a code change; demo rules are marked `demo` and
  shown as such.
* 0.22b's payment order reads the case's newest fee (its lines and total), not the rule.
* Service-version publication is still a single person's step; the money part of it is maker-checker through the fee
  rule's approval (a follow-up for the service version itself).
