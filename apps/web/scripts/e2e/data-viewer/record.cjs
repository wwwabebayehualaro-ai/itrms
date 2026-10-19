// Record page, real data (run ../demo/seed-demo.cjs first). Changes the Expense Report form once and restores it.
const path = require('path');
const L = require('../expense-report/lib.cjs');
const API = (process.env.E2E_API || 'http://localhost:8765').replace(/\/$/, '');
const PW = process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd';
const WEB = process.env.E2E_WEB || 'http://localhost:3000';
const OUT = path.resolve(process.env.E2E_OUT || path.join(__dirname, 'out'));
require('fs').mkdirSync(OUT, { recursive: true });
const ok = (c, m) => {
    console.log((c ? 'PASS ' : 'FAIL ') + m);
    if (!c) process.exitCode = 1;
};
const shot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png') });

(async () => {
    const tok = (
        await (
            await fetch(API + '/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email: 'admin@acme-corp.org', password: PW })
            })
        ).json()
    ).access_token;
    const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
    const api = async (p, opt = {}) => (await fetch(API + p, { headers: H, ...opt })).json();
    const list = await api('/template/forms/templates');
    let tpl = (list.items || list).find((t) => t.slug === 'expense-report');
    const original = JSON.parse(JSON.stringify(tpl.form_config));
    // the request under test is created now, so it records the form version it is filled in on
    const seed = (
        await api('/form/submissions/query', {
            method: 'POST',
            body: JSON.stringify({ template_id: tpl.id, search: 'Berlin', sort: [{ field: 'total' }] })
        })
    ).items[0];
    const TITLE = 'Record page test ' + Date.now().toString(36);
    const target = await api('/form/submissions', {
        method: 'POST',
        body: JSON.stringify({ template_id: tpl.id, submission_data: { ...seed.submission_data, title: TITLE } })
    });
    const base = `${WEB}/submitted-forms/template/${tpl.id}`;
    const { browser, page } = await L.open();
    try {
        await L.login(page);
        await page.goto(base + '?q=' + encodeURIComponent(TITLE), { waitUntil: 'networkidle', timeout: 120000 });
        await page.waitForSelector('[data-viewer] tbody tr');

        // ---- open from the table: a page of its own
        await page
            .locator('[data-viewer] tbody tr', { hasText: target.submission_data.title })
            .getByRole('button', { name: 'View', exact: true })
            .click();
        await page.waitForSelector('[data-record-page]');
        ok(new RegExp(`/template/${tpl.id}/${target.id}`).test(page.url()), 'a request has its own link');
        ok(
            (await page.locator('h1').innerText()).includes(target.submission_data.title),
            'the page is titled with the request'
        );
        await page.waitForSelector('[data-record-page] [data-formarray="lines"] [data-row]');
        ok(
            (await page.locator('[data-record-page] [data-formarray="lines"] [data-row]').count()) ===
                target.submission_data.lines.length,
            `the request tab shows the form with its ${target.submission_data.lines.length} line items`
        );
        const live = await page
            .locator(
                '[data-record-page] [role=tabpanel] input:not([disabled]):not([type=hidden]), [data-record-page] [role=tabpanel] textarea:not([disabled])'
            )
            .count();
        ok(live === 0, 'every control of the form is read-only');
        ok(
            (await page.locator('[data-record-page]').innerText()).includes('Submitted by'),
            'who submitted and when is shown'
        );
        ok(
            (await page.locator('[data-form-changed]').count()) === 0,
            'no "form changed" notice while the form is unchanged'
        );

        // ---- history
        await page.getByRole('tab', { name: /History/ }).click();
        await page.waitForSelector('[data-history]');
        const hist = await api(`/form/submissions/${target.id}/history`);
        ok(
            (await page.locator('[data-history]').count()) === hist.length && hist.length >= 1,
            `history lists the ${hist.length} audit entr${hist.length === 1 ? 'y' : 'ies'}`
        );
        ok(
            (await page.locator('[data-history="create"]').innerText()).includes('Submitted by'),
            'the first entry says who submitted it'
        );
        await shot(page, 'record-history');

        // ---- the form changes afterwards: the old request keeps the old form
        const edited = JSON.parse(JSON.stringify(original));
        const clone = JSON.parse(JSON.stringify(edited.fields.find((f) => f.id === 'title')));
        Object.assign(clone, { id: 'cost_center', label: 'Cost center' });
        for (const bag of [clone.props, clone.data && clone.data.defaultProps])
            if (bag) {
                for (const k of ['id', 'name', 'inputId']) if (k in bag) bag[k] = 'cost_center';
                bag.required = false;
                bag.value = '';
            }
        edited.fields.push(clone);
        const put = await fetch(API + '/template/forms/templates/' + tpl.id, {
            method: 'PUT',
            headers: H,
            body: JSON.stringify({ form_config: edited, row_version: tpl.row_version })
        });
        ok(put.status === 200, 'the form is changed (a new field "Cost center")');
        tpl = await put.json();
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForSelector('[data-form-changed]');
        ok(
            (await page.locator('[data-form-changed]').innerText()).includes('was changed after this request'),
            'a notice says the form changed after the request was filled in'
        );
        await page.waitForSelector('[data-record-page] input[name="title"]');
        ok(
            (await page.locator('[data-record-page] input[name="cost_center"]').count()) === 0,
            'the request is still shown with the form it was filled in on (no Cost center)'
        );
        await shot(page, 'record-old-form');

        // ---- editing moves it to the current form
        await page.getByRole('button', { name: 'Edit' }).click();
        await page.waitForSelector('[data-request-editor] input[name="cost_center"]');
        ok(true, 'Edit opens the current form (with Cost center)');
        await page.locator('[data-request-editor] input[name="cost_center"]').fill('CC-4711');
        await page.getByRole('button', { name: 'Save changes' }).click();
        await page.waitForSelector('[data-request-editor]', { state: 'detached', timeout: 15000 });
        await page.waitForTimeout(1500);
        const after = await api(`/form/submissions/${target.id}`);
        ok(
            after.submission_data.cost_center === 'CC-4711' && after.row_version > target.row_version,
            'the change is saved on the server'
        );
        ok(
            (await page.locator('[data-form-changed]').count()) === 0 &&
                (await page.locator('[data-record-page] input[name="cost_center"]').inputValue()) === 'CC-4711',
            'the notice is gone and the page shows the current form with the new value'
        );
        await page.getByRole('tab', { name: /History/ }).click();
        await page.waitForSelector('[data-history="update"]');
        ok(
            (await page.locator('[data-history="update"]').first().innerText()).includes('cost_center') ||
                (await page.locator('[data-history="update"]').first().innerText()).includes('CC-4711'),
            'the history shows the new value'
        );

        // ---- status
        await page.getByRole('combobox', { name: 'Change status' }).click();
        await page.getByRole('option', { name: 'completed', exact: true }).click();
        await page.waitForTimeout(1500);
        ok(
            (await api(`/form/submissions/${target.id}`)).status === 'completed',
            'changing the status on the page is saved'
        );

        // ---- back keeps the view
        await page.getByRole('link', { name: /Expense Report/ }).click();
        await page.waitForSelector('[data-viewer] tbody tr');
        ok(
            page.url().includes('q=' + encodeURIComponent(TITLE).replace(/%20/g, '+')) ||
                page.url().includes('q=' + encodeURIComponent(TITLE)),
            'Back returns to the same filtered view'
        );
    } catch (e) {
        console.error('RECORD FAIL', e.stack.split('\n').slice(0, 6).join('\n'));
        await shot(page, 'record-fail');
        process.exitCode = 1;
    }
    // restore: the form as it was; remove the request made for this check
    const cur = await api('/template/forms/templates/' + tpl.id);
    await fetch(API + '/template/forms/templates/' + tpl.id, {
        method: 'PUT',
        headers: H,
        body: JSON.stringify({ form_config: original, row_version: cur.row_version })
    });
    await fetch(API + '/form/submissions/' + target.id, { method: 'DELETE', headers: H });
    await browser.close();
})();
