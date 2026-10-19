// Saved views, real users: admin saves a shared default, a submitter sees it and saves a private one (run ../demo/seed-demo.cjs first).
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
const token = async (email) =>
    (
        await (
            await fetch(API + '/auth/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ email, password: PW })
            })
        ).json()
    ).access_token;

(async () => {
    const adminTok = await token('admin@acme-corp.org');
    const AH = { 'content-type': 'application/json', authorization: 'Bearer ' + adminTok };
    const priyaTok = await token('priya.nair@acme-corp.org');
    const PH = { 'content-type': 'application/json', authorization: 'Bearer ' + priyaTok };
    const list = await (await fetch(API + '/template/forms/templates', { headers: AH })).json();
    const tpl = (list.items || list).find((t) => t.slug === 'expense-report');
    const views = async (H) => await (await fetch(API + '/form/views?template_id=' + tpl.id, { headers: H })).json();
    const cleanup = async () => {
        for (const [H, who] of [
            [AH, 'a'],
            [PH, 'p']
        ])
            for (const v of await views(H))
                if (v.name.startsWith('E2E ') && v.can_edit)
                    await fetch(API + '/form/views/' + v.id, { method: 'DELETE', headers: H });
    };
    await cleanup();
    const base = `${WEB}/submitted-forms/template/${tpl.id}`;
    const berlin = (
        await (
            await fetch(API + '/form/submissions/query', {
                method: 'POST',
                headers: AH,
                body: JSON.stringify({ template_id: tpl.id, search: 'Berlin' })
            })
        ).json()
    ).total;

    const a = await L.open();
    try {
        // ---- admin saves a shared, default view of what is on screen
        await L.login(a.page);
        await a.page.goto(base + '?view=cards&q=Berlin', { waitUntil: 'networkidle', timeout: 120000 });
        await a.page.waitForSelector('[data-cards] [data-record]');
        await a.page.getByRole('button', { name: 'Views' }).click();
        await a.page.getByRole('button', { name: /Save current view/ }).click();
        await a.page.locator('#view-name').fill('E2E Berlin cards');
        await a.page.locator('label:has(#view-default)').click();
        await a.page.getByRole('button', { name: 'Save view' }).click();
        await a.page.waitForSelector('[data-save-view]', { state: 'detached' });
        await a.page.waitForTimeout(800);
        const mine = (await views(AH)).find((v) => v.name === 'E2E Berlin cards');
        ok(
            mine &&
                mine.visibility === 'shared' &&
                mine.is_default &&
                mine.config.mode === 'cards' &&
                mine.config.search === 'Berlin',
            'the view is saved on the server as shared + default, with mode and search'
        );
        ok(
            (await a.page.getByRole('button', { name: /E2E Berlin cards/ }).count()) > 0,
            'the toolbar names the active view'
        );

        // ---- a link without settings opens the form's default view
        await a.page.goto(base, { waitUntil: 'networkidle' });
        await a.page.waitForSelector('[data-cards] [data-record]');
        await a.page.waitForTimeout(500);
        ok(
            (await a.page.locator('[data-cards] [data-record]').count()) === berlin && /view=cards/.test(a.page.url()),
            `opening the form shows the default view (cards, ${berlin} request(s) for "Berlin")`
        );
        // ---- "All requests" goes back to everything
        await a.page.getByRole('button', { name: /E2E Berlin cards/ }).click();
        await a.page.getByRole('button', { name: 'All requests' }).click();
        await a.page.waitForSelector('[data-viewer] tbody tr');
        await a.page.waitForTimeout(600);
        ok(!/q=Berlin/.test(a.page.url()), '"All requests" clears the view');
        // ---- a share link with just the view id
        await a.page.goto(`${base}?v=${mine.id}`, { waitUntil: 'networkidle' });
        await a.page.waitForSelector('[data-cards] [data-record]');
        ok(
            (await a.page.locator('[data-cards] [data-record]').count()) === berlin,
            'a link with only ?v=<id> opens that saved view'
        );
        await shot(a.page, 'views-admin');

        // ---- a submitter sees the shared view and saves a private one
        const b = await L.open();
        try {
            await L.login(b.page, 'priya.nair@acme-corp.org');
            await b.page.goto(base + '?view=board', { waitUntil: 'networkidle', timeout: 120000 });
            await b.page.waitForSelector('[data-board]');
            await b.page.getByRole('button', { name: 'Views' }).click();
            ok(
                (await b.page.locator('[data-saved-view="E2E Berlin cards"]').count()) === 1,
                'the submitter sees the shared view'
            );
            ok(
                (await b.page.locator('[data-saved-view="E2E Berlin cards"] button[aria-label^="Delete"]').count()) ===
                    0,
                'but cannot delete it'
            );
            await b.page.getByRole('button', { name: /Save current view/ }).click();
            ok((await b.page.locator('#view-shared').count()) === 0, 'sharing is not offered to a submitter');
            await b.page.locator('#view-name').fill('E2E My board');
            await b.page.getByRole('button', { name: 'Save view' }).click();
            await b.page.waitForSelector('[data-save-view]', { state: 'detached' });
            await b.page.waitForTimeout(800);
            const priyas = (await views(PH)).find((v) => v.name === 'E2E My board');
            ok(
                priyas && priyas.visibility === 'private' && priyas.config.mode === 'board',
                'her view is private and remembers the board'
            );
            ok(!(await views(AH)).some((v) => v.name === 'E2E My board'), 'the admin does not see her private view');
        } finally {
            await b.browser.close();
        }
    } catch (e) {
        console.error('VIEWS FAIL', e.stack.split('\n').slice(0, 6).join('\n'));
        await shot(a.page, 'views-fail');
        process.exitCode = 1;
    }
    await cleanup();
    await a.browser.close();
})();
