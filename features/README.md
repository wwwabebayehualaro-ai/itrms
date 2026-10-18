# Feature registry

One folder per feature with a `feature.yaml`: what the feature is, which **delivery path** it takes, who owns it, and where it
lives. This is the hybrid model of the Teller Portal Architecture Strategy (Option 3, see
[`Docs/architecture`](../Docs/architecture/README.md)): complex work is written as code, simple standard forms are built with
the Form Builder, and both run on the same platform.

The files are documentation today (reviewed in pull requests, owned through `CODEOWNERS`). They follow the shape of the
feature contract of Option 4 on purpose, so a validator/generator can read them later without rewriting them.

## 1. Classify the feature (design review)

Answer the questions in order; the first **yes** decides.

| Question | Yes → |
|---|---|
| Does it move money, stock or other balances, or post to a ledger? | **coded** |
| Does it have a lifecycle beyond "submitted → reviewed" (states with rules, reversals, partial steps)? | **coded** |
| Does it call an external system or need exactly-once behavior (idempotency, document numbers, reconciliation)? | **coded** |
| Does it need business rules that are not field validation (limits per role, cross-record checks, calculations the server must trust)? | **coded** |
| Is it data capture with field validation, conditional fields, attachments, maybe one approval step? | **form** |

When unsure, start as a **form** only if a wrong answer cannot cost money or data; otherwise **coded**. A form can graduate to a
coded feature later (its submitted data stays readable).

## 2. Build it

**Form path** (no code)
1. Design the form in the builder (`/dynamic-template/builder`); field rules, conditional visibility, formulas and data sources
   are configuration, never code.
2. Publish it. With `forms.require_approval` on, a second person approves the publish (maker-checker).
3. Add `features/<id>/feature.yaml` (`type: form`, copy `_templates/form.feature.yaml`), pointing at the exported template JSON.
4. The data viewer, saved views, export and approvals inbox work for it out of the box.

**Form + server action** (the form captures, code does the work): when the work is coded by the table above (posting money,
calling a core system) but the screen is plain data capture, build the screen as a form and the work as a *server action* of a
coded module. The module registers `register_server_action(key, permission=..., input_model=..., handler=...)`
(`form_submission/services/server_actions.py`); the form names it under Data sources → On submit → Server action
(`runtime.submit.serverAction`). On submit the server checks the permission, validates the values with the input model and runs
the handler in the same transaction as the request; the request is then locked. Reference: `features/cash-transaction`
(form) + `features/core-banking` (module).

**Coded path**
1. Backend: `Backend/app/modules/<feature>/` with `module.py` (a `ModuleSpec`: routers, menu, flags), `routers/`, `services/`,
   `schemas/`, `models/`; list it in `app/modules/__init__.py`; migration with `enable_rls_sql`. Use the foundation: errors,
   `secure_router` + `require`, `CrudService`, approvals (`approval.register_policy`), document numbers (`numbering.register`),
   idempotency (`Depends(idempotency())`), feature flags.
2. Frontend: `Frontend/app/(main)/(coded)/<feature>/` built only from `@platform/ui` (design system), TanStack Query hooks
   typed with `ApiSchema<...>`, forms with `useZodForm`.
3. `features/<id>/feature.yaml` (`type: coded`, copy `_templates/coded.feature.yaml`).
4. Tests: pytest for the module, Vitest for screens, a Playwright spec for the main journey.

## Never in either path
Your own authentication, authorization, audit, error format, HTTP client, notifications or integration client. If the platform
lacks something, it is added to the platform (platform team review), not to the feature.
