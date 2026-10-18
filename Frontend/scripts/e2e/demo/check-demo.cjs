// Walks the seeded demo like the boss will: forms gallery, each requests page (table values readable), a View, a screenshot of each.
//   E2E_API=http://localhost:8000 node check-demo.cjs        (screenshots in ./out)
const L = require('../expense-report/lib.cjs');
const path = require('path');
const fs = require('fs');
const API = (process.env.E2E_API || 'http://localhost:8765').replace(/\/$/, '');
const OUT = path.resolve(process.env.E2E_OUT || path.join(__dirname, 'out'));
fs.mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-/;

(async () => {
  const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@acme-corp.org', password: process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd' }) })).json()).access_token;
  const tpls = await (await fetch(API + '/template/forms/templates?limit=500', { headers: { authorization: 'Bearer ' + tok } })).json();
  const { browser, page } = await L.open();
  page.setDefaultTimeout(60000);
  await page.setViewportSize({ width: 1600, height: 1000 });
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  try {
    await L.login(page, 'admin@acme-corp.org');
    await page.goto(L.WEB + '/dynamic-template/saved-templates', { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(1500);
    const gallery = await page.locator('body').innerText();
    ok(['Equipment Request', 'Expense Report', 'Leave Request'].every((n) => gallery.includes(n)), 'the forms gallery lists the three forms');
    await page.screenshot({ path: OUT + '/1-forms-gallery.png' });

    const pages = [['equipment-request', 'Equipment Request', ['Employee', 'Manager', 'Budget', 'Status'], 6], ['expense-report', 'Expense Report', ['Report title', 'Approver', 'Total (USD)'], 5], ['leave-request', 'Leave Request', ['Employee', 'Leave type', 'Days', 'Status'], 5]];
    for (const [slug, name, heads, minRows] of pages) {
      const t = tpls.find((x) => x.slug === slug);
      const hand = slug === 'equipment-request'; // a hand-built report (DataTable); the others use the data viewer's table
      await page.goto(L.WEB + '/submitted-forms/template/' + t.id, { waitUntil: 'networkidle', timeout: 120000 });
      const table = hand ? '[data-viewer] [data-field-type="DataTable"] table' : '[data-viewer] table';
      await page.waitForSelector(hand ? `${table} tbody tr:has(button)` : `${table} tbody tr:has(button[data-open])`);
      await page.waitForSelector(`${table} [data-slot="skeleton"]`, { state: 'detached', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(800);
      const h = (await page.locator(`${table} thead th`).allInnerTexts()).map((x) => x.trim());
      const rows = await page.locator(`${table} tbody tr`).count();
      const text = await page.locator(`${table} tbody`).innerText();
      ok(heads.every((x) => h.includes(x)), `${name}: columns ${h.join(', ')}`);
      ok(rows >= minRows, `${name}: ${rows} requests listed`);
      ok(!UUID.test(text), `${name}: no raw ids in the table (names and labels instead)`);
      await page.screenshot({ path: OUT + `/2-${slug}-table.png` });
      await page.getByRole('button', { name: 'View', exact: true }).first().click();
      await page.waitForSelector('[data-record-page] input');
      await page.waitForTimeout(1500);
      ok(await page.locator('[data-record-page] [role=tabpanel] input:not([disabled]):not([type=hidden]):not([style*="display: none"]), [data-record-page] [role=tabpanel] textarea:not([disabled])').count() === 0, `${name}: View is read-only`);
      await page.screenshot({ path: OUT + `/3-${slug}-view.png` });
      await page.goBack();
      await page.waitForSelector('[data-viewer] table tbody tr');
    }
    ok(errs.length === 0, 'no console errors' + (errs.length ? ': ' + JSON.stringify(errs.slice(0, 3)) : ''));
  } catch (e) {
    console.error('FAIL:', e.message.split('\n').slice(0, 8).join('\n'));
    await page.screenshot({ path: OUT + '/fail.png' }).catch(() => {});
    process.exitCode = 1;
  }
  await browser.close();
})();
