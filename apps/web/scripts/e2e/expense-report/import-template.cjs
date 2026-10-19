// Imports a saved template JSON (default: the Expense Report) under a new name/slug, to use as a starting point.
//   node import-template.cjs [file.json] [--name "Travel Request"] [--slug travel-request]
const fs = require('fs');
const path = require('path');
const API = (process.env.E2E_API || 'http://localhost:8765').replace(/\/$/, '');
const PW = process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd';
const args = process.argv.slice(2);
const opt = (k) => {
    const i = args.indexOf('--' + k);
    return i >= 0 ? args[i + 1] : undefined;
};
const file =
    args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--')) ||
    path.join(__dirname, 'expense-report.template.json');
(async () => {
    const t = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (opt('name')) t.name = opt('name');
    if (opt('slug')) t.slug = opt('slug');
    const login = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: process.env.E2E_ADMIN || 'admin@acme-corp.org', password: PW })
    });
    const tok = (await login.json()).access_token;
    const res = await fetch(API + '/template/forms/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok },
        body: JSON.stringify(t)
    });
    console.log(res.status, res.ok ? 'imported ' + t.slug : await res.text());
})();
