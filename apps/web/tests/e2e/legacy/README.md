# Legacy journeys (not run)

What is left of the Digital File Cabinet journeys, which signed in with the legacy FastAPI backend's password form:
`smoke.spec.ts` and `feature-flags.spec.ts` visit the legacy platform screens (feature flags, document numbers) that
still call the legacy backend. `playwright.config.ts` ignores this folder; they go when those screens move to the API
(task 0.26).

The form engine's journeys (builder, publishing, filling in, repeating rows, the data viewer's modes) were rewritten for
the BFF sign-in and the forms API in task 0.16f: `../forms/`.
