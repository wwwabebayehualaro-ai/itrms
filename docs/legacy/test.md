The backend is running, but the frontend is stopped, so start it first. From Frontend/:

$env:NEXT_PUBLIC_BACKEND_API="http://localhost:8765/"; npm run dev

Then open http://localhost:3000/auth/login. .env.local points at port 8000, so the env override above is needed.

Password for every account: the local demo password set by the legacy seed scripts (not repeated in documentation).

Email: priya.nair@acme-corp.org
Role: submitter
What to try: The best one for checking the form. Fill and submit
Equipment Request.
────────────────────────────────────────
Email: tom.becker@acme-corp.org
Role: submitter
What to try: Same access as Priya. It also shows that Priya's
submission is visible to others in the tenant.
────────────────────────────────────────
Email: maria.santos@acme-corp.org
Role: editor
What to try: Opens the builder and edits templates and submissions.
────────────────────────────────────────
Email: david.chen@acme-corp.org
Role: editor
What to try: Same as Maria.
────────────────────────────────────────
Email: admin@acme-corp.org
Role: admin
What to try: Everything, including deleting submissions and templates.

Where to look
- Live form: in the sidebar, open Submitted Forms → Templates → Equipment Request. Click "New submission".
- Stored data: the grid under the form lists submissions read back from the database. There is already one from my test run (Priya's, with two items). Click Edit to see it repopulate.
- The builder view: sign in as admin or an editor, then open Template Builder → Manage Templates and open Equipment Request.

These accounts are for local development only, so don't reuse that password anywhere real.