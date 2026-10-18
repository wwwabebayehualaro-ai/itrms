// Creates the colleagues the render check expects (idempotent). Needs the tenant admin:
//   python -m app.cli create-tenant --name Acme --slug acme --admin-email admin@acme-corp.org   (ADMIN_PASSWORD = E2E_PASSWORD)
const API = (process.env.E2E_API || 'http://localhost:8765').replace(/\/$/, '');
const PW = process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd';
const USERS = [
  ['maria.santos@acme-corp.org', 'Maria Santos', ['editor']],
  ['david.chen@acme-corp.org', 'David Chen', ['editor']],
  ['priya.nair@acme-corp.org', 'Priya Nair', ['submitter']],
  ['tom.becker@acme-corp.org', 'Tom Becker', ['submitter']],
];
(async () => {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@acme-corp.org', password: PW }) });
  const tok = (await r.json()).access_token;
  for (const [email, full_name, roles] of USERS) {
    const res = await fetch(API + '/auth/users', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ email, full_name, roles, password: PW }) });
    console.log(email, res.status === 201 ? 'created' : res.status === 409 ? 'exists' : 'HTTP ' + res.status);
  }
})();
