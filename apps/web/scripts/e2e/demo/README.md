# Demo data: click through every step

`seed-demo.cjs` stores the three sample forms and 15 realistic requests in the database through the real API (each request is created as the person who
would create it, so owners and audit are real). `check-demo.cjs` walks the result in a browser and saves screenshots to `out/`.

```bash
export E2E_API=http://localhost:8000 E2E_WEB=http://localhost:3000     # the scripts default to :8765
node ../expense-report/seed.cjs     # once: the people (Maria Santos, David Chen, Priya Nair, Tom Becker)
node seed-demo.cjs                  # forms (if missing) + demo requests; re-run any time, it replaces its own requests
node seed-demo.cjs --reset          # remove the demo requests only (forms and anything else stay)
node check-demo.cjs                 # optional: PASS/FAIL + screenshots (needs Playwright)
```
Demo requests are marked `form_metadata.submitted_via = "demo-seed"`; nothing else is ever deleted. All requests get the time of seeding
(the server sets it), so the "Submitted" column shows one time.

Logins (the password you seeded, also passed as `E2E_PASSWORD`): `admin@acme-corp.org` (builder, delete) and `priya.nair@acme-corp.org` (submitter).

## Click path
1. **Manage Templates**: the forms (Equipment Request, Expense Report, Leave Request). Open one in the builder: palette, canvas, settings panel (Field, Settings, Options, Rules, Logic), Data sources, Preview, undo/redo.
2. Sidebar, **Equipment Request**: the hand-built **Report** view (names not ids, currency, tags, files, search, Export CSV).
   **View** opens the request as the form, read-only (repeatable item rows, computed totals). **Edit** and **New request** (computed totals; "Why is it urgent?" appears for Urgent).
3. **Expense Report** and **Leave Request**: no table was built for them; the **data viewer** works out from the fields what can be shown: Table, Cards, Board, Calendar (Leave Request), Pivot, Dashboard, filters, saved views, CSV export. A request opens as a page (form as filled in, history). The journey: `tests/e2e/forms/data-viewer.spec.ts`.
4. As admin, **Delete** a row (only admin can). The table refreshes without a reload.
