// View modes against the seeded demo data (run ../demo/seed-demo.cjs first). Usage: node modes.cjs [mode ...]
const path = require('path');
const L = require('../expense-report/lib.cjs');
const API = (process.env.E2E_API || 'http://localhost:8765').replace(/\/$/, '');
const PW =
    process.env.E2E_PASSWORD ??
    (() => {
        throw new Error('Set E2E_PASSWORD to the local demo password (never stored in the repository).');
    })();
const WEB = process.env.E2E_WEB || 'http://localhost:3000';
const OUT = path.resolve(process.env.E2E_OUT || path.join(__dirname, 'out'));
require('fs').mkdirSync(OUT, { recursive: true });
const ok = (c, m) => {
    console.log((c ? 'PASS ' : 'FAIL ') + m);
    if (!c) process.exitCode = 1;
};
const shot = (page, n) => page.screenshot({ path: path.join(OUT, n + '.png') });
const want = process.argv.slice(2);
const pick = async (page, label, text) => {
    await page.getByRole('combobox', { name: label }).click();
    await page.getByRole('option', { name: text }).first().click();
};
const run = (m) => !want.length || want.includes(m);

(async () => {
    const login = async (email) =>
        (
            await (
                await fetch(API + '/auth/login', {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ email, password: PW })
                })
            ).json()
        ).access_token;
    const tok = await login('admin@acme-corp.org');
    const H = { 'content-type': 'application/json', authorization: 'Bearer ' + tok };
    const list = await (await fetch(API + '/template/forms/templates', { headers: H })).json();
    const tpl = (list.items || list).find((t) => t.slug === 'expense-report');
    const query = async (body) =>
        (
            await fetch(API + '/form/submissions/query', {
                method: 'POST',
                headers: H,
                body: JSON.stringify({ template_id: tpl.id, ...body })
            })
        ).json();
    const base = `${WEB}/submitted-forms/template/${tpl.id}`;
    const all = await query({ page_size: 100 });
    const { browser, page } = await L.open();
    const go = async (qs) => {
        await page.goto(`${base}?${qs}`, { waitUntil: 'networkidle', timeout: 120000 });
    };
    try {
        await L.login(page);

        if (run('cards')) {
            await go('view=cards');
            await page.waitForSelector('[data-cards] [data-record]');
            const n = await page.locator('[data-cards] [data-record]').count();
            ok(n === all.total, `cards: ${n} cards for ${all.total} requests`);
            const text = await page.locator('[data-cards]').innerText();
            ok(
                all.items.every((i) => text.includes(i.submission_data.title)),
                'cards: every title shown'
            );
            ok(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(text), 'cards: people by name, no ids');
            await page.getByLabel('Search requests').fill('Berlin');
            const b = await query({ search: 'Berlin' });
            // the search is debounced and asked of the server: wait for the answer instead of a fixed pause
            for (let i = 0; i < 40 && (await page.locator('[data-cards] [data-record]').count()) !== b.total; i++)
                await page.waitForTimeout(250);
            ok(
                (await page.locator('[data-cards] [data-record]').count()) === b.total,
                `cards: search narrows to ${b.total}`
            );
            await shot(page, 'cards');
            await page.locator('[data-cards] [data-record] button[data-open]').first().click();
            await page.waitForSelector('[data-record-page]', { timeout: 120000 });
            ok(true, 'cards: a card opens the request');
        }

        if (run('board')) {
            await go('view=board');
            await page.waitForSelector('[data-board] [data-column]');
            const facets = (await query({ rows: false, facets: ['status'] })).facets.status;
            const colCount = async (v) =>
                Number((await page.locator(`[data-column="${v}"] [data-count]`).innerText()).split(' ')[0]);
            let okCols = true;
            for (const f of facets) if (f.value && (await colCount(f.value)) !== f.count) okCols = false;
            ok(
                okCols,
                `board: column counts equal the API's status counts (${facets.map((f) => f.value + '=' + f.count).join(', ')})`
            );
            ok(
                (await page.locator('[data-board] [data-column]').count()) >= 5,
                'board: a column for every status, also the empty ones'
            );
            await shot(page, 'board');

            // move a card with the "Move to" menu (keyboard / touch friendly path)
            const card = page.locator('[data-column="submitted"] [data-record]', { hasText: 'Home-office keyboard' });
            const id = await card.getAttribute('data-record');
            await card.getByRole('button', { name: /^Move/ }).click();
            await page.getByRole('menuitem', { name: /^processing$/i }).click();
            await page.waitForTimeout(1500);
            const st = async () => (await (await fetch(API + '/form/submissions/' + id, { headers: H })).json()).status;
            ok((await st()) === 'processing', 'board: "Move to processing" changed the status in the database');
            // the column asks the server again: wait for the card instead of a fixed pause
            await page
                .locator('[data-column="processing"] [data-record="' + id + '"]')
                .waitFor({ timeout: 10000 })
                .catch(() => {});
            ok(
                (await page.locator('[data-column="processing"] [data-record="' + id + '"]').count()) === 1,
                'board: the card is now in the processing column'
            );

            // real pointer drag back to submitted
            const src = page.locator('[data-column="processing"] [data-record="' + id + '"]');
            const dst = page.locator('[data-column="submitted"]');
            await L.drag(page, src, dst, { x: 0, y: 0 }, 'top');
            await page.waitForTimeout(1500);
            ok((await st()) === 'submitted', 'board: dragging the card back changed the status again');
            await page
                .locator('[data-record="' + id + '"] button[data-open]')
                .first()
                .click();
            await page.waitForSelector('[data-record-page]');
            ok(true, 'board: a card opens the request');
        }

        if (run('calendar')) {
            const leave = (list.items || list).find((t) => t.slug === 'leave-request');
            const lq = async (body) =>
                (
                    await fetch(API + '/form/submissions/query', {
                        method: 'POST',
                        headers: H,
                        body: JSON.stringify({ template_id: leave.id, ...body })
                    })
                ).json();
            const lurl = `${WEB}/submitted-forms/template/${leave.id}`;
            await page.goto(lurl + '?view=calendar', { waitUntil: 'networkidle', timeout: 120000 });
            await page.waitForSelector('[data-calendar]');
            const month = await page.locator('[data-month]').getAttribute('data-month');
            const [y, m] = month.split('-').map(Number);
            const from = `${month}-01`,
                to = `${month}-${new Date(y, m, 0).getDate()}`;
            const api = await lq({
                filter: { op: 'and', items: [{ field: 'firstDay', op: 'between', value: [from, to] }] },
                page_size: 100
            });
            await page.waitForTimeout(1200);
            const chips = await page.locator('[data-calendar] [data-day$="-"], [data-calendar] [data-event]').count();
            const inMonth = await page.locator(`[data-calendar] [data-day^="${month}"] [data-event]`).count();
            ok(inMonth === api.total, `calendar ${month}: ${inMonth} events in the month, the API says ${api.total}`);
            // each event sits on its own day
            let placed = true;
            for (const r of api.items) {
                const day = String(r.submission_data.firstDay).slice(0, 10);
                if ((await page.locator(`[data-day="${day}"] [data-event="${r.id}"]`).count()) !== 1) placed = false;
            }
            ok(placed, 'calendar: every request is on the day of its first day');
            await shot(page, 'calendar');
            await page.getByRole('button', { name: 'Next month' }).click();
            await page.waitForTimeout(1200);
            const next = await page.locator('[data-month]').getAttribute('data-month');
            const nextApi = await lq({
                filter: {
                    op: 'and',
                    items: [
                        { field: 'firstDay', op: 'gte', value: `${next}-01` },
                        { field: 'firstDay', op: 'lte', value: `${next}-28` }
                    ]
                },
                page_size: 100
            });
            ok(
                (await page.locator(`[data-calendar] [data-day^="${next}"] [data-event]`).count()) >= nextApi.total &&
                    nextApi.total >= 1,
                `calendar: next month (${next}) shows its ${nextApi.total}+ request(s)`
            );
            await page.locator('[data-calendar] [data-event]').first().click();
            await page.waitForSelector('[data-record-page]');
            ok(true, 'calendar: an event opens the request');
            // expense report has no date field: no calendar mode there
            await page.goto(base, { waitUntil: 'networkidle' });
            await page.waitForSelector('[data-viewer] tbody tr');
            ok(
                (await page.locator('[data-modes] [aria-label="Calendar"]').count()) === 0,
                'calendar: not offered for a form without a date'
            );
        }

        if (run('pivot')) {
            await go('view=pivot');
            await page.waitForSelector('[data-pivot]');
            // default: rows = status, value = count
            const api = await query({ rows: false, group_by: { field: 'status' } });
            await page.waitForTimeout(800);
            let match = true;
            for (const g of api.groups) {
                const t = (await page.locator(`[data-cell="${g.key}"]`).innerText()).trim();
                if (Number(t) !== g.count) match = false;
            }
            ok(
                match,
                `pivot: rows by status, counts equal the API (${api.groups.map((g) => g.key + '=' + g.count).join(', ')})`
            );
            ok(
                Number((await page.locator('[data-grand]').innerText()).trim()) === api.total,
                `pivot: grand total ${api.total}`
            );

            // rows = approver (a person), columns = status, value = sum of Total
            await pick(page, 'Rows', /^Approver$/);
            await pick(page, 'Columns', /^Status$/);
            await pick(page, 'Value', /^Sum of Total/);
            await page.waitForTimeout(1500);
            const two = await query({
                rows: false,
                group_by: { field: 'approver' },
                then_by: { field: 'status' },
                aggregates: [{ fn: 'sum', field: 'total', alias: 'v' }]
            });
            const rowTot = await query({
                rows: false,
                group_by: { field: 'approver' },
                aggregates: [{ fn: 'sum', field: 'total', alias: 'v' }]
            });
            const dir = await (await fetch(API + '/auth/directory', { headers: H })).json();
            const name = (id) => (dir.find((u) => u.id === id) || {}).full_name;
            // names arrive with the directory (a separate request): wait for them instead of a fixed pause
            let text = '';
            for (let i = 0; i < 20 && !rowTot.groups.every((g) => text.includes(name(g.key))); i++) {
                if (i) await page.waitForTimeout(500);
                text = await page.locator('[data-pivot]').innerText();
            }
            ok(
                rowTot.groups.every((g) => text.includes(name(g.key))),
                'pivot: approvers shown by name'
            );
            let cellsOk = true;
            for (const g of two.groups) {
                const t = (await page.locator(`[data-cell="${g.key}|${g.key2}"]`).innerText())
                    .replace(/[$,]/g, '')
                    .trim();
                if (Math.abs(Number(t) - g.aggregates.v) > 0.01) cellsOk = false;
            }
            ok(cellsOk, `pivot: ${two.groups.length} cells (sum of Total by approver and status) equal the API`);
            let rtOk = true;
            for (const g of rowTot.groups) {
                const t = (await page.locator(`[data-row-total="${g.key}"]`).innerText()).replace(/[$,]/g, '').trim();
                if (Math.abs(Number(t) - g.aggregates.v) > 0.01) rtOk = false;
            }
            ok(rtOk, 'pivot: row totals are computed by the server');
            await shot(page, 'pivot');

            // drill down: click a cell -> the table, filtered to exactly those requests
            const g0 = two.groups[0];
            await page.locator(`[data-cell="${g0.key}|${g0.key2}"] button`).click();
            await page.waitForSelector('[data-viewer] table tbody tr');
            await page.waitForTimeout(800);
            const drilled = await query({
                filter: {
                    op: 'and',
                    items: [
                        { field: 'approver', op: 'eq', value: g0.key },
                        { field: 'status', op: 'eq', value: g0.key2 }
                    ]
                }
            });
            ok(
                (await page.locator('[data-viewer] tbody tr').count()) === drilled.total && drilled.total === g0.count,
                `pivot: clicking a cell shows its ${g0.count} request(s) in the table`
            );
        }

        if (run('dashboard')) {
            await go('view=dashboard');
            await page.waitForSelector('[data-dashboard] [data-tile]');
            await page.waitForTimeout(1000);
            const sum = await query({
                rows: false,
                aggregates: [
                    { fn: 'count', alias: 'n' },
                    { fn: 'sum', field: 'total', alias: 's' },
                    { fn: 'avg', field: 'total', alias: 'a' }
                ]
            });
            const tile = async (label) => await page.locator(`[data-tile="${label}"]`).innerText();
            ok(
                (await tile('Requests')).includes(String(sum.aggregates.n)),
                `dashboard: Requests tile = ${sum.aggregates.n}`
            );
            const totalTile = (await tile('Sum of Total (USD)')).replace(/,/g, '');
            ok(
                totalTile.includes(sum.aggregates.s.toFixed(2).replace(/\.?0+$/, '')),
                `dashboard: total tile = ${sum.aggregates.s.toFixed(2)} (${totalTile.replace(/\n/g, ' ')})`
            );
            const st = await query({ rows: false, group_by: { field: 'status' } });
            let barsOk = true;
            for (const g of st.groups) {
                const t = await page.locator(`[data-bar="${g.key}"]`).getAttribute('data-value');
                if (Number(t) !== g.count) barsOk = false;
            }
            ok(
                barsOk,
                `dashboard: status bars equal the API (${st.groups.map((g) => g.key + '=' + g.count).join(', ')})`
            );
            ok(
                (await page.locator('[data-dashboard]').innerText()).includes('Requests by approver'),
                'dashboard: breakdown by the approver field'
            );
            await shot(page, 'dashboard');
            await page.getByRole('button', { name: 'Show as table' }).first().click();
            ok(
                (await page.locator('[data-dashboard] table').count()) === 1,
                'dashboard: a chart can be read as a table'
            );
            await page.getByRole('button', { name: 'Show chart' }).click();
            const big = st.groups.sort((a, b) => b.count - a.count)[0];
            await page.locator(`[data-bar="${big.key}"]`).click();
            await page.waitForSelector('[data-viewer] table tbody tr');
            await page.waitForTimeout(800);
            ok(
                (await page.locator('[data-viewer] tbody tr').count()) === big.count,
                `dashboard: clicking the "${big.key}" bar lists its ${big.count} requests`
            );
        }
    } catch (e) {
        console.error('MODES FAIL', e.stack.split('\n').slice(0, 6).join('\n'));
        await shot(page, 'modes-fail');
        process.exitCode = 1;
    }
    await browser.close();
})();
