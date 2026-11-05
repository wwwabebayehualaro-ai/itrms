/**
 * What every `NationalDriverPlatform` must do (task 0.24a): the fake and any future real adapter run these same tests, the real one
 * against a test environment of the platform. `make` gives an adapter that accepts; `refusing` gives one that refuses.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { NationalDriverPlatform, NationalLicenceRequest } from '../contracts/national-driver-platform';

const request = (over: Partial<NationalLicenceRequest> = {}): NationalLicenceRequest => ({
    requestId: randomUUID(),
    kind: 'new',
    licenceId: randomUUID(),
    personId: randomUUID(),
    name: 'Generated Applicant',
    birthYear: 1995,
    sex: 'female',
    officeCode: 'WOL-BODITI',
    grades: ['automobile'],
    number: null,
    nationalReference: null,
    ...over
});

export function nationalDriverPlatformContract(
    name: string,
    make: () => NationalDriverPlatform,
    refusing: () => NationalDriverPlatform
): void {
    describe(`${name}: the national driver platform's contract`, () => {
        it('accepts a request and names its record', async () => {
            const answer = await make().requestLicence(request());
            expect(answer.status).toBe('accepted');
            expect(answer.reference).toEqual(expect.any(String));
            expect(answer.reference.length).toBeGreaterThan(0);
        });

        it('gives the same answer to the same request: a retry makes no second licence', async () => {
            const platform = make();
            const asked = request();
            const first = await platform.requestLicence(asked);
            const again = await platform.requestLicence(asked);
            expect(again).toEqual(first);
        });

        it('gives another request its own record', async () => {
            const platform = make();
            const [one, two] = [await platform.requestLicence(request()), await platform.requestLicence(request())];
            expect(one.reference).not.toBe(two.reference);
        });

        it('takes a renewal, naming the licence it renews', async () => {
            const platform = make();
            const first = await platform.requestLicence(request());
            const renewal = await platform.requestLicence(
                request({ kind: 'renewal', number: 'WOL/DL/000001', nationalReference: first.reference })
            );
            expect(renewal.status).toBe('accepted');
        });

        it('says why when it refuses', async () => {
            const answer = await refusing().requestLicence(request());
            expect(answer.status).toBe('rejected');
            expect(answer.reason).toEqual(expect.any(String));
            expect(answer.reason?.length).toBeGreaterThan(0);
        });

        it('tells the status of a licence it knows, and nothing of one it doesn’t', async () => {
            const platform = make();
            const { reference } = await platform.requestLicence(request());
            expect(await platform.licenceStatus(reference)).toEqual({ reference, status: 'active' });
            expect(await platform.licenceStatus('no-such-record')).toBeNull();
        });

        it('takes a print batch once: the same batch has the same reference', async () => {
            const platform = make();
            const batch = {
                batchId: randomUUID(),
                licences: [{ licenceId: randomUUID(), number: 'WOL/DL/000001', reference: 'R-1' }]
            };
            const first = await platform.requestPrint(batch);
            expect(first.reference).toEqual(expect.any(String));
            expect(await platform.requestPrint(batch)).toEqual(first);
            const other = await platform.requestPrint({ ...batch, batchId: randomUUID() });
            expect(other.reference).not.toBe(first.reference);
        });
    });
}
