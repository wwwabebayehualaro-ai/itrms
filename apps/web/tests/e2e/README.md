# Browser journeys (Playwright)

`pnpm --filter @itrms/web e2e` runs the journeys in this folder against the development stack:

1. `pnpm dev:infra` (Keycloak, Valkey, PostgreSQL, SeaweedFS; writes the apps' local settings);
2. the API built, migrated and seeded (infra/compose/README.md, "App settings");
3. Playwright starts the API (:4000) and the web app (:3000) unless they already run.

CI runs them the same way (`.github/workflows/ci.yml`, job `e2e`), with the worker started beside them.

`keycloak.ts` puts a demo account in a known state through Keycloak's admin API (no second factor, no session) with the
admin password from `infra/compose/.env`: nothing secret is in this folder. Each journey signs its people in anew.

- `sign-in.spec.ts`, `shell.spec.ts`, `i18n.spec.ts`, `registry.spec.ts`: the BFF sign-in, the shell and unit switching,
  languages, the register of persons.
- `forms/`: the form engine on the forms API (task 0.16f): building and publishing a form (a second person approves),
  filling it in, repeating rows with formulas, and the data viewer's modes and export. They act as the demo accounts
  `demo.zone.admin` (writes forms), `demo.zone.head` (approves) and `demo.damot.records` (fills in); each journey makes
  its own forms through the API (`forms/support.ts`) and switches them off afterwards, so they repeat on the same
  database.

- `workflow/`: the inbox and the case page (task 0.20b): Damot Gale's records officer finds a review in "My tasks",
  takes it on and opens the case; on the case page they comment mentioning the office's head and forward it, and the head
  is told (the worker relays the mention), opens the case from the bell and approves it. Each run makes its own workflow
  (by `demo.zone.admin`) and its own cases through the API (`workflow/support.ts`).

`legacy/` holds what is left of the old engine journeys, not run (its README says why).
