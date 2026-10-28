/**
 * Drafts (task 0.20c): Damot Gale's records officer starts a request and leaves it half-filled; it is on the server, so
 * on another PC they go on with it, Sensitive answer and all. There the network drops while they type: the change is
 * kept in the browser, sealed, without the Sensitive answer (read back here with the browser's own key), and reaches
 * the server when the link is back. On a third PC the request is filed from the draft, and the draft is gone; its record
 * leaves the Sensitive answer out until it is shown with a reason (task 0.20d).
 */
import { expect, test, type Page } from '@playwright/test';

import { PEOPLE, api, field, publishedForm, runName, signedIn, switchOff } from './support';

const FIELDS = [
    field('InputText', 'applicant', 'Applicant', { classification: 'personal' }),
    field('InputText', 'phone', 'Phone', { classification: 'sensitive' }),
    field('InputText', 'town', 'Town', { classification: 'personal' })
];

interface Submission {
    id: string;
    answers: Record<string, unknown>;
    masked: string[];
}

/** What this browser keeps of its drafts, unsealed with its own key (as the app reads it). */
const keptHere = (page: Page) =>
    page.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const req = indexedDB.open('itrms-drafts');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error as Error);
        });
        const all = <T>(store: string) =>
            new Promise<T[]>((resolve, reject) => {
                const req = db.transaction(store).objectStore(store).getAll();
                req.onsuccess = () => resolve(req.result as T[]);
                req.onerror = () => reject(req.error as Error);
            });
        const keys = await all<{ userId: string; key: CryptoKey }>('keys');
        const drafts = await all<{ userId: string; iv: Uint8Array<ArrayBuffer>; data: ArrayBuffer }>('drafts');
        return Promise.all(
            drafts.map(async (d) => {
                const key = keys.find((k) => k.userId === d.userId)?.key;
                if (!key) return null;
                const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: d.iv }, key, d.data);
                return JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>;
            })
        );
    });

async function openDraft(page: Page, formId: string, applicant: string) {
    await page.goto(`/submitted-forms/template/${formId}`);
    const drafts = page.locator('[data-drafts]');
    await expect(drafts).toBeVisible();
    await drafts.locator(`[data-draft="${formId}"]`).first().getByRole('button', { name: 'ቀጥል' }).click();
    const dialog = page.locator('[data-request-editor]');
    await expect(dialog.getByLabel('Applicant')).toHaveValue(applicant);
    return dialog;
}

test('a draft goes on on another PC, survives a dropped network, and goes when its request is filed', async ({
    browser
}) => {
    test.setTimeout(300_000);
    const author = api(await signedIn(browser, PEOPLE.author));
    const formId = await publishedForm(
        author,
        api(await signedIn(browser, PEOPLE.approver)),
        runName('Drafted request'),
        FIELDS
    );
    const applicant = runName('Applicant');
    try {
        // one PC: started, left half-filled
        const first = await signedIn(browser, PEOPLE.filler);
        await first.goto(`/submitted-forms/template/${formId}`);
        await first.getByRole('button', { name: 'New request' }).click();
        const dialog = first.locator('[data-request-editor]');
        await dialog.getByLabel('Applicant').fill(applicant);
        await dialog.getByLabel('Phone').fill('0911223344');
        await expect(dialog.locator('[data-draft-status="saved"]')).toBeVisible({ timeout: 30_000 });

        // another PC: the server's draft, the Sensitive answer included
        const second = await signedIn(browser, PEOPLE.filler);
        const resumed = await openDraft(second, formId, applicant);
        await expect(resumed.getByLabel('Phone')).toHaveValue('0911223344');

        // the network drops while typing: kept here, sealed, without the Sensitive answer
        await second.context().setOffline(true);
        await resumed.getByLabel('Town').fill('Boditi');
        await expect(resumed.locator('[data-draft-status="offline"]')).toBeVisible({ timeout: 30_000 });
        const kept = (await keptHere(second)).filter((d) => d?.applicant === applicant);
        expect(kept).toEqual([{ applicant, town: 'Boditi' }]);
        // the link is back: the change reaches the server
        await second.context().setOffline(false);
        await expect(resumed.locator('[data-draft-status="saved"]')).toBeVisible({ timeout: 30_000 });

        // a third PC: filed from the draft, which is then gone
        const third = await signedIn(browser, PEOPLE.filler);
        const last = await openDraft(third, formId, applicant);
        await expect(last.getByLabel('Town')).toHaveValue('Boditi');
        await last.getByRole('button', { name: 'Submit request' }).click();
        await expect(last).toBeHidden();
        const filed = await api(third).get<{ items: Submission[] }>(`v1/submissions?formId=${formId}&mine=true`);
        // filed with every answer; the list leaves the Sensitive one out and names it (shown below with a reason)
        const listed = filed.items.find((s) => s.answers.applicant === applicant);
        expect(listed?.answers).toMatchObject({ applicant, town: 'Boditi' });
        expect(listed?.answers).not.toHaveProperty('phone');
        expect(listed?.masked).toEqual(['phone']);
        const drafts = await api(third).get<{ items: { formId: string }[] }>(`v1/form-drafts?formId=${formId}`);
        expect(drafts.items).toEqual([]);
        await third.reload();
        await expect(third.locator('[data-drafts]')).toHaveCount(0);

        // the filed request's record leaves the Sensitive answer out; it is shown with a reason (task 0.20d)
        const record = filed.items.find((s) => s.answers.applicant === applicant);
        await third.goto(`/submitted-forms/template/${formId}/${record?.id ?? ''}`);
        const hidden = third.locator('[data-sensitive-answers]');
        await expect(hidden).toContainText('Phone');
        await expect(hidden).not.toContainText('0911223344');
        await hidden.getByRole('button', { name: 'አሳይ' }).click();
        const ask = third.locator('[data-reveal-dialog]');
        await ask.getByLabel('ምክንያት').fill('Calling the applicant about the missing document');
        await ask.getByRole('button', { name: 'አሳይ' }).click();
        await expect(hidden.locator('[data-revealed]')).toContainText('0911223344');
    } finally {
        await switchOff(author, formId);
    }
});
