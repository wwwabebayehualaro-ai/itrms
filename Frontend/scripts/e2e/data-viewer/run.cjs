// Data viewer, real data: drives the viewer of the seeded "Expense Report" (run ../demo/seed-demo.cjs first) as admin and checks
// every number on screen against the API. Env: E2E_WEB, E2E_API, E2E_PASSWORD, E2E_OUT.
const path = require('path');
const L = require('../expense-report/lib.cjs');
const API = (process.env.E2E_API || 'http://localhost:8765').replace(/\/$/, '');
const PW = process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd';
const WEB = process.env.E2E_WEB || 'http://localhost:3000';
const OUT = path.resolve(process.env.E2E_OUT || path.join(__dirname, 'out'));
require('fs').mkdirSync(OUT, { recursive: true });
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const shot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png') });

(async () => {
  const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@acme-corp.org', password: PW }) })).json()).access_token;
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
  const list = await (await fetch(API + '/template/forms/templates', { headers: H })).json();
  const tpl = (list.items || list).find((t) => t.slug === 'expense-report');
  const query = async (body) => (await fetch(API + '/form/submissions/query', { method: 'POST', headers: H, body: JSON.stringify({ template_id: tpl.id, ...body }) })).json();
  const all = await query({ sort: [{ field: 'total' }], page_size: 100 });
  const berlinTotal = (await query({ search: 'Berlin' })).total;
  const url = `${WEB}/submitted-forms/template/${tpl.id}`;

  const { browser, page } = await L.open();
  try {
    await L.login(page);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });

    // ---- table: real rows, people by name, money formatted
    await page.waitForSelector('[data-viewer] table tbody tr');
    const rows = page.locator('[data-viewer] tbody tr');
    ok((await rows.count()) === all.total, `table shows all ${all.total} requests`);
    const text = await page.locator('[data-viewer] table').innerText();
    ok(all.items.every((i) => text.includes(i.submission_data.title)), 'every request title is listed');
    ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), 'no raw user ids: approvers and submitters are shown by name');
    const modes = await page.locator('[data-viewer] [data-modes] [aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    console.log('modes:', modes.join(' | '));
    await shot(page, 'table');

    // ---- search is server-side and lands in the URL
    await page.getByLabel('Search requests').fill('Berlin');
    await page.waitForFunction(() => /q=Berlin/.test(location.search), null, { timeout: 5000 });
    await page.waitForTimeout(600);
    const berlin = await query({ search: 'Berlin' });
    ok((await rows.count()) === berlin.total && berlin.total >= 1, `search "Berlin" -> ${berlin.total} request(s), same as the API`);

    // ---- filter builder: Total at least 300
    await page.getByLabel('Search requests').fill('');
    await page.waitForFunction(() => !/q=/.test(location.search), null, { timeout: 5000 });
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('button', { name: 'Add condition' }).click();
    const cond = page.locator('[data-condition="0"]');
    await cond.getByRole('combobox', { name: 'Field' }).click();
    await page.getByRole('option', { name: /^Total/ }).click();
    await cond.getByRole('combobox', { name: 'Operator' }).click();
    await page.getByRole('option', { name: 'at least' }).click();
    const num = cond.locator('input[inputmode=decimal]').first();
    await num.click(); await num.pressSequentially('300', { delay: 10 }); await num.blur();
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.waitForFunction(() => /[?&]f=/.test(location.search), null, { timeout: 5000 });
    await page.waitForTimeout(700);
    const big = await query({ filter: { op: 'and', items: [{ field: 'total', op: 'gte', value: 300 }] } });
    ok((await rows.count()) === big.total && big.total > 0 && big.total < all.total, `filter "Total at least 300" -> ${big.total} of ${all.total}, same as the API`);
    ok(await page.getByText(/Total \(USD\) at least/).count() > 0, 'active filter shown as a removable chip');
    await shot(page, 'filtered');

    // ---- the URL is the shareable view: reload keeps it, a second browser session opens the same view
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-viewer] tbody tr');
    ok((await rows.count()) === big.total, 'reload keeps the filtered view');
    const link = page.url();
    await page.goto(WEB + '/', { waitUntil: 'networkidle' }); // leave, then arrive by the link alone
    await page.goto(link, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-viewer] tbody tr', { timeout: 30000 });
    ok((await rows.count()) === big.total, 'the link alone restores the same filtered view');

    // ---- sort by Total (server-side), descending after two clicks
    await page.getByRole('button', { name: 'Clear all' }).click();
    await page.waitForFunction(() => !/[?&]f=/.test(location.search), null, { timeout: 5000 });
    await page.waitForTimeout(500);
    await page.getByRole('columnheader', { name: /^Total/ }).click();
    await page.waitForFunction(() => /sort=total/.test(location.search), null, { timeout: 5000 });
    await page.waitForTimeout(600);
    const asc = await query({ sort: [{ field: 'total' }] });
    const firstTitle = (await rows.first().innerText());
    ok(firstTitle.includes(asc.items[0].submission_data.title), `sorted by Total ascending: first is "${asc.items[0].submission_data.title}"`);
    await page.getByRole('columnheader', { name: /^Total/ }).click();
    await page.waitForFunction(() => /sort=-total/.test(location.search), null, { timeout: 5000 });
    await page.waitForTimeout(600);
    const desc = await query({ sort: [{ field: 'total', desc: true }] });
    ok((await rows.first().innerText()).includes(desc.items[0].submission_data.title), 'sorted descending: largest first');

    // ---- export what is on screen as CSV (names and labels, same filter)
    await page.getByLabel('Search requests').fill('Berlin');
    await page.waitForFunction(() => /q=Berlin/.test(location.search), null, { timeout: 5000 });
    await page.waitForTimeout(800);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Export' }).click()]);
    const csv = require('fs').readFileSync(await download.path(), 'utf8').replace(/^\uFEFF/, '');
    const csvRows = csv.trim().split(/\r?\n/);
    ok(/^Submitted,Status,Submitted by,Report title/.test(csvRows[0]) && csvRows.length === 1 + berlinTotal, `CSV export: header + ${berlinTotal} row(s) for the same search (${download.suggestedFilename()})`);
    ok(/Maria Santos|David Chen/.test(csv) && !/[0-9a-f]{8}-[0-9a-f]{4}-/.test(csv), 'CSV export shows names, not ids');
    await page.getByLabel('Search requests').fill('');
    await page.waitForFunction(() => !/q=/.test(location.search), null, { timeout: 5000 });
    await page.waitForTimeout(800);

    // ---- open a request from the table
    await rows.first().locator('button[data-open]').click();
    await page.waitForSelector('[data-record-page]');
    await page.waitForSelector('[data-record-page] input[name="title"]');
    ok((await page.locator('[data-record-page] input[name="title"]').inputValue()) === desc.items[0].submission_data.title && (await page.locator('[data-record-page] input[name="title"]').isDisabled()), 'a request opens as its own page with the form, read-only');
    await shot(page, 'detail');
  } catch (e) {
    console.error('VIEWER FAIL', e.stack.split('\n').slice(0, 6).join('\n'));
    await shot(page, 'fail');
    process.exitCode = 1;
  }
  await browser.close();
})();
