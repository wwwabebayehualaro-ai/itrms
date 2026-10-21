# Legacy engine journeys (not run)

These specs drove the Digital File Cabinet engine against the legacy FastAPI backend, signing in with its password
form. Task 0.10a replaced that sign-in with the BFF (Keycloak, an HttpOnly session cookie, no token in the browser), so
they no longer run: `playwright.config.ts` ignores this folder. They come back, rewritten for the BFF sign-in, when the
engine runs against NestJS (phase-0 task "legacy engine e2e journeys pass against NestJS").
