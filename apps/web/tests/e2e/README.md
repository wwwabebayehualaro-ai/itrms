# Browser journeys (Playwright)

`pnpm --filter @itrms/web e2e` runs the journeys in this folder against the development stack:

1. `pnpm dev:infra` (Keycloak, Valkey, PostgreSQL; writes the apps' local settings);
2. the API built, migrated and seeded (infra/compose/README.md, "App settings");
3. Playwright starts the API (:4000) and the web app (:3000) unless they already run.

`sign-in.spec.ts` resets the demo account `demo.dual` in Keycloak (no second factor, no session) through the admin API,
with the admin password from `infra/compose/.env`: nothing secret is in this folder. `legacy/` holds the old engine
journeys, not run (its README says why).
