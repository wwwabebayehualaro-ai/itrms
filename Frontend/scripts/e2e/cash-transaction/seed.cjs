// Sets up the cash deposit / withdrawal demo through the real API: accounts in the simulated core, a teller and a supervisor,
// and the form (built with the form engine; its server action posts the transaction). Re-runnable: what exists is kept.
//   E2E_API=http://localhost:8000 node seed.cjs
// Needs the tenant of ../expense-report/seed.cjs (admin@acme-corp.org).
const fs = require('fs');
const path = require('path');
const API = (process.env.E2E_API || 'http://localhost:8765').replace(/\/$/, '');
const PW = process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd';

const ACCOUNTS = [
  { number: '1000000000001', holder_name: 'Abebe Kebede', branch: 'Head office', currency: 'ETB', status: 'ACTIVE', opening_balance: 250000 },
  { number: '1000000000002', holder_name: 'Sara Tesfaye', branch: 'Bole branch', currency: 'ETB', status: 'ACTIVE', opening_balance: 1200 },
  { number: '1000000000003', holder_name: 'Dawit Alemu', branch: 'Piassa branch', currency: 'USD', status: 'ACTIVE', opening_balance: 8500 },
  { number: '1000000000004', holder_name: 'Hana Girma', branch: 'Bole branch', currency: 'ETB', status: 'DORMANT', opening_balance: 4300 },
  { number: '1000000000005', holder_name: 'Yonas Bekele', branch: 'Head office', currency: 'ETB', status: 'BLOCKED', opening_balance: 900 },
  { number: '1000000000006', holder_name: 'Meron Haile', branch: 'Piassa branch', currency: 'ETB', status: 'ACTIVE', opening_balance: 560000 }
];
const PEOPLE = [
  { email: 'teller@acme-corp.org', full_name: 'Tigist Teller', roles: ['teller'] },
  { email: 'supervisor@acme-corp.org', full_name: 'Samuel Supervisor', roles: ['teller_supervisor'] }
];

const call = async (url, opt) => { for (let i = 0; ; i++) { try { return await fetch(url, opt); } catch (e) { if (i >= 3) throw e; await new Promise((r) => setTimeout(r, 600)); } } };
const json = async (r) => { if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`); return r.json(); };

(async () => {
  const r = await call(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@acme-corp.org', password: PW }) });
  if (!r.ok) throw new Error(`login: HTTP ${r.status} (is the tenant seeded? node ../expense-report/seed.cjs)`);
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + (await r.json()).access_token };

  for (const a of ACCOUNTS) {
    const res = await call(API + '/core-banking/accounts', { method: 'POST', headers: H, body: JSON.stringify(a) });
    if (res.status === 409) continue;
    await json(res);
    console.log('account', a.number, a.holder_name, a.status);
  }

  for (const p of PEOPLE) {
    const res = await call(API + '/auth/users', { method: 'POST', headers: H, body: JSON.stringify({ ...p, password: PW }) });
    if (res.status === 409) continue;
    await json(res);
    console.log('user', p.email, p.roles.join(','));
  }

  // the form: created once, afterwards updated to this file's version (every save is published unless forms.require_approval is on)
  const template = JSON.parse(fs.readFileSync(path.join(__dirname, 'cash-transaction.template.json'), 'utf8'));
  const existing = (await json(await call(API + '/template/forms/templates?limit=500', { headers: H }))).find((t) => t.slug === template.slug);
  if (!existing) {
    const t = await json(await call(API + '/template/forms/templates', { method: 'POST', headers: H, body: JSON.stringify(template) }));
    console.log('form', t.name, t.status, t.id);
  } else {
    const t = await json(await call(API + '/template/forms/templates/' + existing.id, { method: 'PUT', headers: H, body: JSON.stringify({ form_config: template.form_config, category: template.category, row_version: existing.row_version }) }));
    console.log('form updated', t.name, t.status, t.id);
  }
  console.log(`\nSign in as teller@acme-corp.org (password ${PW === process.env.E2E_PASSWORD ? 'from E2E_PASSWORD' : PW}), open Templates Pool → "${template.name}".`);
  console.log('Above the approval limit (CORE_BANKING_APPROVAL_LIMIT, default 100000) supervisor@acme-corp.org approves in Approvals.');
})().catch((e) => { console.error(e.message); process.exit(1); });
