/**
 * The data viewer's modes on the forms API (the legacy data-viewer scripts as a journey, task 0.16f): four requests of a
 * zone form, filed by a woreda's records officer, are shown by every mode as the API counts them: the table and its
 * search, the cards, the board's columns (the stage field's values), the calendar's month, the pivot's grand total and
 * the dashboard's tiles and drill-down; the pivot drills down; the filter builder narrows them on the server and the link
 * keeps it; a column sorts them; a private saved view opens from its link; a request opens as its page (the form
 * read-only, its history, Back keeps the view); and they leave as a file. Moving a card on the board waits for the
 * workflow (a filed request changes only through its case, task 0.19).
 */
import { engineTranslator } from '@itrms/form-engine/core';
import { expect, test, type Page } from '@playwright/test';

import { PEOPLE, api, field, publishedForm, runName, signedIn, switchOff, type Api } from './support';

// the page runs in Amharic, so the engine's own words are looked up in its Amharic catalogue
const am = engineTranslator('am');

const REQUESTS = [
    field('InputText', 'title', 'Title', { props: { required: true }, filterable: true }),
    field('Dropdown', 'priority', 'Priority', {
        filterable: true,
        props: {
            required: true,
            options: [
                { label: 'Low', value: 'low' },
                { label: 'Normal', value: 'normal' },
                { label: 'Urgent', value: 'urgent' }
            ]
        }
    }),
    field('Calendar', 'needed', 'Needed on', { props: { required: true }, filterable: true }),
    field('InputNumber', 'amount', 'Amount', { filterable: true })
];

// this month's days in Addis Ababa, so the calendar opens on them
const month = new Date(Date.now() + 3 * 3_600_000).toISOString().slice(0, 7);
const ROWS = [
    { title: 'Grader fuel, Sodo road', priority: 'urgent', needed: `${month}-05`, amount: 12_000 },
    { title: 'Culvert cement', priority: 'normal', needed: `${month}-10`, amount: 8_500 },
    { title: 'Road sign paint', priority: 'normal', needed: `${month}-15`, amount: 2_300 },
    { title: 'Safety club leaflets', priority: 'low', needed: `${month}-20`, amount: 600 }
];

interface Result {
    total: number;
    facets: Record<string, { value: string | null; count: number }[]>;
}

async function file(filler: Api, formId: string) {
    const version = await filler.get<{ id: string }>(`v1/forms/${formId}/versions/published`);
    for (const answers of ROWS) await filler.post('v1/submissions', { formId, formVersionId: version.id, answers });
}

const query = (who: Api, formId: string, body: object = {}) =>
    who.post<Result>('v1/submissions/query', { formId, ...body });

async function show(page: Page, formId: string, mode: string) {
    await page.goto(`/submitted-forms/template/${formId}?view=${mode}`);
}

test('every mode of the data viewer shows the requests as the API counts them', async ({ browser }) => {
    // three people sign in, six modes load, then filters, views and a record page
    test.setTimeout(480_000);
    const authorPage = await signedIn(browser, PEOPLE.author);
    const approverPage = await signedIn(browser, PEOPLE.approver);
    const author = api(authorPage);
    const formId = await publishedForm(author, api(approverPage), runName('Material requests'), REQUESTS);
    try {
        const page = await signedIn(browser, PEOPLE.filler);
        const filler = api(page);
        await file(filler, formId);
        const all = await query(filler, formId);
        expect(all.total).toBe(ROWS.length);

        // table: a row per request; the search narrows it on the server
        await show(page, formId, 'table');
        const rows = page.locator('[data-viewer] tbody tr');
        await expect(rows).toHaveCount(ROWS.length);
        await page.getByLabel(am('form-engine.viewer.search')).fill('Culvert');
        await expect(rows).toHaveCount(1);
        await expect(rows.first()).toContainText('Culvert cement');

        // cards: one per request, people and offices by name (no ids)
        await show(page, formId, 'cards');
        const cards = page.locator('[data-cards] [data-record]');
        await expect(cards).toHaveCount(ROWS.length);
        const text = await page.locator('[data-cards]').innerText();
        for (const r of ROWS) expect(text).toContain(r.title);
        expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);

        // board: a column per priority, counted as the API counts them
        await show(page, formId, 'board');
        await expect(page.locator('[data-board] [data-column]').first()).toBeVisible();
        const facets = (await query(filler, formId, { rows: false, facets: ['priority'] })).facets.priority ?? [];
        for (const f of facets.filter((x) => x.value))
            await expect(page.locator(`[data-column="${f.value}"] [data-count]`)).toHaveText(
                new RegExp(`^${f.count}\\b`)
            );

        // calendar: this month holds the four, each on its day
        await show(page, formId, 'calendar');
        await expect(page.locator('[data-calendar]')).toBeVisible();
        await expect(page.locator(`[data-calendar] [data-day^="${month}"] [data-event]`)).toHaveCount(ROWS.length);
        await expect(page.locator(`[data-day="${month}-05"] [data-event]`)).toHaveCount(1);

        // pivot: the grand total is every request
        await show(page, formId, 'pivot');
        await expect(page.locator('[data-pivot] [data-grand]')).toHaveText(String(ROWS.length));

        // dashboard: the requests tile, and a bar drills down to its requests in the table
        await show(page, formId, 'dashboard');
        await expect(
            page.locator(`[data-dashboard] [data-tile="${am('form-engine.viewer.dashboard.requests')}"]`)
        ).toContainText(String(ROWS.length));
        const bar = page.locator('[data-dashboard] [data-bar]').first();
        const count = Number(await bar.getAttribute('data-value'));
        await bar.click();
        await expect(page.locator('[data-viewer] tbody tr')).toHaveCount(count);

        // pivot: a cell drills down to exactly its requests in the table
        await show(page, formId, 'pivot');
        const cell = page.locator('[data-pivot] [data-cell] button').first();
        const inCell = Number((await cell.innerText()).trim());
        await cell.click();
        await expect(page.locator('[data-viewer] tbody tr')).toHaveCount(inCell);

        // the filter builder: "Priority is Normal", asked of the server; the link keeps it, a reload too
        await show(page, formId, 'table');
        await expect(rows).toHaveCount(ROWS.length);
        await page.getByRole('button', { name: am('form-engine.viewer.filters.button') }).click();
        const builder = page.getByRole('dialog', { name: am('form-engine.viewer.filters.title') });
        await builder.getByRole('button', { name: am('form-engine.viewer.filters.add') }).click();
        await builder.getByRole('combobox', { name: am('form-engine.viewer.filters.field') }).click();
        await page.getByRole('option', { name: 'Priority' }).click();
        await builder
            .getByRole('combobox', { name: am('form-engine.viewer.filters.valueOf', { label: 'Priority' }) })
            .click();
        await page.getByRole('option', { name: 'Normal' }).click();
        await builder.getByRole('button', { name: am('form-engine.viewer.filters.apply') }).click();
        await expect(rows).toHaveCount(2);
        await expect(page).toHaveURL(/[?&]f=/);
        await page.reload();
        await expect(rows).toHaveCount(2);

        // sorted by the server on a column: the amounts come in order
        await page.locator('[data-viewer] thead').getByText('Amount', { exact: true }).click();
        await expect(page).toHaveURL(/[?&]sort=/);
        await expect
            .poll(async () => (await rows.locator('td').allInnerTexts()).join(' '))
            .toMatch(/2,300[\s\S]*8,500|8,500[\s\S]*2,300/);

        // a private saved view of it, opened again from its link
        await page.getByRole('button', { name: am('form-engine.viewer.views.button') }).click();
        await page.getByRole('button', { name: am('form-engine.viewer.views.saveCurrent') }).click();
        await page.locator('[data-save-view] #view-name').fill('Normal priority');
        await page
            .locator('[data-save-view]')
            .getByRole('button', { name: am('form-engine.viewer.views.save') })
            .click();
        await expect(page.getByRole('button', { name: 'Normal priority' })).toBeVisible();
        const views = await filler.get<{ items: { id: string; name: string; visibility: string }[] }>(
            `v1/forms/${formId}/views`
        );
        const saved = views.items.find((v) => v.name === 'Normal priority');
        expect(saved?.visibility).toBe('private');
        await page.goto(`/submitted-forms/template/${formId}?v=${saved?.id}`);
        await expect(rows).toHaveCount(2);

        // a request opens as its page: the form as filled in, read-only, its history; Back keeps the view
        await rows.first().locator('[data-open]').click();
        const record = page.locator('[data-record-page]');
        await expect(record).toBeVisible();
        await expect(record.getByLabel('Title')).toBeDisabled();
        await expect(record).toContainText('Damot Gale Records Officer');
        await record.getByRole('tab', { name: 'History' }).click();
        await expect(page.locator('[data-history="insert"]')).toHaveCount(1);
        // back: the link to the form, carrying the view the request was opened from
        await record.locator('> a').first().click();
        await expect(rows).toHaveCount(2);

        // export, a right of its own (the zone's head has it, a records officer not): the woreda's requests leave as a file
        await expect(page.getByRole('button', { name: am('form-engine.viewer.export.label') })).toHaveCount(0);
        await show(approverPage, formId, 'table');
        await expect(approverPage.locator('[data-viewer] tbody tr')).toHaveCount(ROWS.length);
        const download = approverPage.waitForEvent('download');
        await approverPage.getByRole('button', { name: am('form-engine.viewer.export.label') }).click();
        expect((await download).suggestedFilename()).toMatch(/\.csv$/);
    } finally {
        await switchOff(author, formId);
    }
});
