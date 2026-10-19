# Data viewer: real-browser checks

Drive the viewer of the seeded demo forms (Expense Report, Leave Request) against the real API and PostgreSQL, and compare every number on screen with the API.
No mocks. Prerequisites as in `../demo/README.md` (backend :8765, `next dev` :3000, Playwright, `node ../demo/seed-demo.cjs` once).

| Script | Proves |
|---|---|
| `run.cjs` | table, search, filter builder, URL = shareable view, server-side sort, CSV export, open a request |
| `modes.cjs [mode...]` | cards, board (menu move and a real pointer drag), calendar, pivot (totals, drill-down), dashboard (tiles, bars, table view) |
| `record.cjs` | a request as a page: read-only form, history, "form changed" notice, edit moves it to the current form, status, Back keeps the view (restores the form it changes) |
| `views.cjs` | saved views: admin shares a default, a submitter sees it and saves a private one, `?v=<id>` links |

Env: `E2E_WEB`, `E2E_API`, `E2E_PASSWORD`, `E2E_OUT` (screenshots, `out/` is git-ignored).
