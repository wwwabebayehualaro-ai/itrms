# Expense Report — reference multi-record form

The reference example for building forms with repeatable rows (line items). Seeded by `../demo/seed-demo.cjs`; filled
in a real browser by `tests/e2e/multi-row.spec.ts` (rows, formulas, conditional receipt, the people picker, what is stored).

## What the form demonstrates
| Feature | Where |
|---|---|
| Multi-record rows | `lines` = `FormArray` (min 1 / max 20 rows, `itemLabel` "Expense", add label "Add expense") |
| Row template | date, category (options via the Options editor), description, amount, tax %, line total, receipt no. |
| Per-row formula | `lineTotal` = `{{= round(row.amount * (1 + row.taxRate / 100), 2) }}` |
| Form-level formula | `total` = `{{= round(sum(root.lines, 'lineTotal'), 2) }}` |
| Per-row visibility + required | `receiptNo` shown (and required) only when `row.amount > 50` |
| Current user binding | `employee` = `{{user.name}}` (read-only) |
| API-driven dropdown | `approver` bound to data source `directory` (`GET /auth/directory`, label `full_name`, value `id`) |

Files: `expense-report.template.json` (the saved template), `seed.cjs` (colleagues), `import-template.cjs` (clone as a new
template), `lib.cjs` (Playwright helpers for the scripts in `../`).

A richer example with ~15 field kinds, API-driven options, conditional fields and a full store/read-back proof lives in
[`../equipment-request`](../equipment-request/README.md).

## Use it as a starting point
1. **Clone the template**: `node import-template.cjs --name "Travel Request" --slug travel-request`, then open it in the builder
   (Manage Templates) and change fields. Or in the builder use *Import JSON* with `expense-report.template.json`.
2. **Test it**: copy `tests/e2e/multi-row.spec.ts` and change the labels and the stored values it checks.

## Local test users and registering the form
Dev/test only. All accounts live in tenant `acme` and share the password `Sm0ke-Test-Passw0rd` (the `E2E_PASSWORD` default).

| Email | Role | Can |
|---|---|---|
| `admin@acme-corp.org` | admin | everything, incl. user management |
| `maria.santos@acme-corp.org` | editor | create/edit templates and submissions |
| `david.chen@acme-corp.org` | editor | create/edit templates and submissions |
| `priya.nair@acme-corp.org` | submitter | read templates, create/edit own submissions, upload files |
| `tom.becker@acme-corp.org` | submitter | read templates, create/edit own submissions, upload files |

Set up from scratch (from `Backend/`, with `app/.env` configured, then from this folder):
```bash
alembic upgrade head
ADMIN_PASSWORD='Sm0ke-Test-Passw0rd' python -m app.cli create-tenant --name Acme --slug acme --admin-email admin@acme-corp.org
uvicorn app.main:app --port 8765          # keep running

export E2E_API=http://localhost:8765 E2E_PASSWORD='Sm0ke-Test-Passw0rd'
node seed.cjs                             # the four non-admin users (re-runnable: "exists")
node import-template.cjs                  # registers "Expense Report" in the admin's tenant (re-run: 409 slug_taken)
```
To register the form in another tenant, pass that tenant's admin: `E2E_ADMIN=admin@other.org node import-template.cjs`.

## Run the checks
The browser checks are Playwright specs (`npm run e2e`, see `tests/e2e`); they need the demo data (`../demo/seed-demo.cjs`).
