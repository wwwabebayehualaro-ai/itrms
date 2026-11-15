/**
 * The bulk import of paper vehicle files in a browser, end to end (ADR-0054, tasks 1.13b and 1.13g). At Boditi the records officer
 * sends a sheet of three paper files with the scans of two; the worker checks it and the report shows the two valid rows and the
 * third's error at its column. The competency officer commits it (never the sender, SEC-AC-6) and the register finds the vehicles
 * marked as imported, with their batch, in the search and on the record. With the region's share of sampling QA set to 100% for the
 * run, both are drawn: the lead re-checks one as correct and one with an error, and the clerks' counts show them; the reconciliation
 * report (task 1.13h) counts them as verified at the office. Paper references,
 * plates, chassis numbers, names and phones are generated.
 */
import { randomInt } from 'node:crypto';

import type { ClerkCounts, MigrationSample, VehicleImport } from '@itrms/competency/contracts';
import { vinCheckDigit } from '@itrms/vehicles/contracts';
import { expect, test, type Page } from '@playwright/test';

import { api } from '../forms/support';
import { PEOPLE, signedIn } from '../workflow/support';
import { BODITI, generated, person } from './support';

/** A VIN with its check digit right, generated: never a real vehicle's. */
function generatedVin(): string {
    const base = `1HGCM82B0${randomInt(10, 99)}${String(randomInt(0, 999999)).padStart(6, '0')}`;
    return `${base.slice(0, 8)}${vinCheckDigit(base) ?? '0'}${base.slice(9)}`;
}

const RUN = String(randomInt(100000, 999999));
const FILES = [1, 2, 3].map((n) => ({
    reference: `BOD/E2E/${RUN}/${n}`,
    plate: `AA 2-${randomInt(10000, 99999)}`,
    vin: generatedVin(),
    owner: `ባለቤት ${generated()} ታደሰ`,
    phone: `09${String(randomInt(10_000_000, 99_999_999))}`
}));
const COLUMNS = [
    'paper_reference',
    'first_registered_on',
    'owners_since',
    'plate',
    'chassis_number',
    'make',
    'model',
    'model_year',
    'category',
    'use',
    'colour',
    'owner_name_am',
    'owner_sex',
    'owner_phone'
];
/** The sheet: the first two files right, the third with a category the catalogue does not hold. */
const SHEET = [
    COLUMNS.join(','),
    ...FILES.map((f, i) =>
        [
            f.reference,
            '04/09/2001',
            '2015-03-01',
            f.plate,
            f.vin,
            'Toyota',
            'Corolla',
            '2008',
            i === 2 ? 'xyz' : 'automobile',
            'private',
            'Blue',
            f.owner,
            'female',
            f.phone
        ].join(',')
    )
].join('\r\n');
const pdf = (name: string) => ({
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\n% paper file\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n')
});
const FILENAME = `boditi-e2e-${RUN}.csv`;

/** The confirmation dialog's accept button. */
const confirm = (page: Page) => page.locator('[data-confirm]').getByRole('button').last().click();

test.describe.configure({ mode: 'serial' });

test.describe('the bulk import of paper vehicle files', () => {
    test('a sheet sent, checked, committed by a second person, its vehicles marked and re-checked', async ({
        browser
    }) => {
        test.setTimeout(600_000);
        const records = await person(browser, BODITI.records);
        const officer = await person(browser, BODITI.officer);
        const lead = await person(browser, BODITI.lead);

        // every record of the run drawn for a re-check: the region's share, which a bureau would set
        const bureau = api(await signedIn(browser, PEOPLE.bureau));
        const { activeUnit } = await bureau.get<{ activeUnit: { id: string } }>('v1/me/workspace');
        const setting = `v1/org-units/${activeUnit.id}/settings/competency.migration_sample_percent`;
        // a first write of a setting is its version 1; a retry of this journey must find it gone
        await bureau.put(setting, { value: 100 }, 0);
        try {
            // the records officer sends the sheet with its scans (named after their paper references, a file name holds no `/`)
            await records.goto('/competency/vehicle-imports/new');
            await records.locator('#import-sheet').setInputFiles({
                name: FILENAME,
                mimeType: 'text/csv',
                buffer: Buffer.from(SHEET)
            });
            await records
                .locator('#import-scans')
                .setInputFiles(FILES.slice(0, 2).map((f) => pdf(`${f.reference.replaceAll('/', '-')}.pdf`)));
            await records.locator('[data-action="send"]').click();
            await expect(records).toHaveURL(/\/competency\/vehicle-imports\/[0-9a-f-]{36}$/, { timeout: 60_000 });
            const importId = records.url().split('/').pop() ?? '';

            // the worker's dry run: two valid rows, the third's error at its column; nothing on the register yet
            const report = records.locator('[data-screen="vehicle-import"]');
            await expect(report).toHaveAttribute('data-state', 'checked', { timeout: 120_000 });
            await expect(records.locator('[data-row-state="valid"]')).toHaveCount(2);
            await expect(records.locator('[data-row-state="invalid"] [data-error-column="category"]')).toBeVisible();
            await expect(records.locator('[data-action="commit"]')).toHaveCount(0);

            // the competency officer commits it
            await officer.goto(`/competency/vehicle-imports/${importId}`);
            await officer.locator('[data-action="commit"]').click();
            await confirm(officer);
            await expect(officer.locator('[data-screen="vehicle-import"]')).toHaveAttribute('data-state', 'committed', {
                timeout: 180_000
            });

            // the register finds each vehicle, marked as imported with its batch, in the results and on its record
            await officer.goto(`/registry/vehicles?q=${encodeURIComponent(FILES[0]?.plate ?? '')}`);
            const result = officer.locator('[data-results] [data-vehicle]').first();
            await expect(result.locator('[data-migrated="import"]')).toBeVisible();
            await expect(result.locator('[data-migration-batch]')).toContainText(FILENAME);
            await result.getByRole('link').first().click();
            await expect(officer.locator('[data-screen="vehicle-record"] [data-migration="import"]')).toBeVisible();
            await expect(officer.locator('[data-screen="vehicle-record"] [data-migration-batch]')).toContainText(
                FILENAME
            );
            await expect(officer.locator('[data-screen="vehicle-record"] a[data-migration-batch]')).toHaveAttribute(
                'href',
                `/competency/vehicle-imports/${importId}`
            );

            // both vehicles were drawn for a re-check; the lead re-checks them against their scans
            // found by their vehicles (a long-lived database holds many other waiting records)
            const drawn: MigrationSample[] = [];
            for (const f of FILES.slice(0, 2)) {
                const [vehicle] = (
                    await api(lead).get<{ items: { id: string }[] }>(`v1/vehicles?q=${encodeURIComponent(f.plate)}`)
                ).items;
                drawn.push(
                    ...(
                        await api(lead).get<{ items: MigrationSample[] }>(
                            `v1/migration-samples?state=drawn&vehicleId=${vehicle?.id ?? ''}`
                        )
                    ).items
                );
            }
            expect(drawn).toHaveLength(2);
            const clerkId = drawn[0]?.clerk.id ?? '';
            const countsOf = async () =>
                (await api(lead).get<{ items: ClerkCounts[] }>('v1/migration-samples/clerks')).items.find(
                    (c) => c.clerk.id === clerkId
                );
            const before = await countsOf();

            const [first, second] = drawn;
            await lead.goto(`/competency/migration-samples/${first?.id ?? ''}`);
            await expect(lead.locator('[data-action="scan"]')).toBeVisible();
            await lead.locator('[data-outcome="correct"]').click();
            await lead.locator('[data-action="recheck"]').click();
            await expect(lead.locator('[data-action="recheck"]')).toHaveCount(0);

            await lead.goto(`/competency/migration-samples/${second?.id ?? ''}`);
            await lead.locator('[data-outcome="errors"]').click();
            await lead.locator('[data-field="colour"]').click();
            await lead.locator('[data-action="recheck"]').click();
            await expect(lead.locator('[data-action="recheck"]')).toHaveCount(0);

            await expect
                .poll(async () => {
                    const after = await countsOf();
                    return {
                        rechecked: (after?.rechecked ?? 0) - (before?.rechecked ?? 0),
                        withErrors: (after?.withErrors ?? 0) - (before?.withErrors ?? 0)
                    };
                })
                .toEqual({ rechecked: 2, withErrors: 1 });
            // and the clerks' counts show the clerk
            await lead.goto('/competency/migration-samples');
            await lead.locator('[data-tab="clerks"]').click();
            await expect(lead.locator(`[data-clerk-row="${clerkId}"]`).first()).toBeVisible();

            // the reconciliation report (task 1.13h) counts the imported files as verified under plate code 2 at the office, and
            // offers the office no paper count of its own (the zone above sets it)
            await lead.goto('/competency/migration-report');
            const boditi = lead.locator('[data-office="WOL-BODITI"]');
            await expect(boditi).toBeVisible();
            await expect
                .poll(async () =>
                    Number(await boditi.locator('[data-code="2"] [data-cell="verified"]').first().innerText())
                )
                .toBeGreaterThanOrEqual(2);
            await expect(boditi.locator('[data-action="paper-count"]')).toHaveCount(0);

            // the sender cannot re-check their own records
            const own = await api(records).status(
                'POST',
                `v1/migration-samples/${first?.id ?? ''}/recheck`,
                { outcome: 'correct' },
                1
            );
            // the records officer holds no right to re-check at all; whoever captured a record never re-checks it
            expect(own).toBe(403);
            const batch = await api(records).get<VehicleImport>(`v1/vehicle-imports/${importId}`);
            expect(batch).toMatchObject({ state: 'committed', counts: { imported: 2, invalid: 1 } });
        } finally {
            await bureau.delete(setting, 1);
        }
    });
});
