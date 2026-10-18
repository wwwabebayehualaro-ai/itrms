# ADR 0016: HR prepares the office's payroll list; Finance pays

* Status: accepted (2026-10-17). It **replaces** the earlier rule "payroll is out of scope; HR only sends monthly changes".

## Context
The product owner clarified the split. Finance pays salaries from the list that the office's payroll function provides.
Finance's own work (payment, accounting, its calculations and controls) is not ITRMS's concern. **The office's payroll list
is.** The service list confirms this with the item "የሰራተኞች በየወሩ ደሞዝ ለፋይናንስ ማስተላለፍ" (forward staff monthly salary to
Finance).

## Decision
In scope (module `hr`, Phase 3):
* A staff register with grade, step, position (Form 15), employment status and the bank account Finance pays into.
* A **monthly payroll list** per office, per Ethiopian month:
  * basic salary from the **versioned salary scale** (the Sept 2025 civil-service scale first);
  * allowances and deductions from configured pay components;
  * absence and unpaid-leave deductions from leave records;
  * arrears and corrections;
  * **income tax and pension**, computed from versioned tables (Proclamation 1395/2025 bands; Pension Proclamation
    1267/2022 rates, still to be verified);
  * totals per office.
* A workflow: HR prepares → checks → the head approves → the list is **sent to Finance**. It goes as a numbered,
  QR-verifiable PDF plus Excel/CSV in Finance's format.
* The approved list is frozen: its lines are immutable, and corrections go into a later month.
* The monthly change report (new hires, promotions, step increases, leave without pay, retirements), plus the civil service
  and pension agency reports.

Out of scope: disbursement, bank transfers, accounting entries, budget control, IFMIS posting and Finance's own
recalculation.

## Consequences
* All rates are configuration with effective dates, because they changed in both 2024 and 2025. The calculation is a pure
  function with golden tests, reviewed by the zone finance office.
* Salaries are sensitive personal data: masked by default, visible only to HR and payroll roles, and every read is audited.
* **Open:** does Finance expect the office to compute tax and pension, or only the gross items? The design supports both
  through a per-installation switch.
