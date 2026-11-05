import { describe, expect, it } from 'vitest';

import { FakeNationalDriverPlatform } from '../api/fake-national-driver-platform';
import type { NationalLicenceRequest } from '../contracts/national-driver-platform';
import { nationalDriverPlatformContract } from './national-driver-platform.contract';

nationalDriverPlatformContract(
    'the fake',
    () => new FakeNationalDriverPlatform(),
    () => new FakeNationalDriverPlatform({ decide: () => ({ status: 'rejected', reason: 'name mismatch' }) })
);

const request: NationalLicenceRequest = {
    requestId: 'r1',
    kind: 'new',
    licenceId: 'l1',
    personId: 'p1',
    name: 'Generated Applicant',
    birthYear: 1995,
    sex: 'male',
    officeCode: 'WOL-BODITI',
    grades: ['automobile'],
    number: null,
    nationalReference: null
};

describe('the fake, beyond the contract', () => {
    it('leaves numbers to the region by default, and gives its own when told to', async () => {
        expect((await new FakeNationalDriverPlatform().requestLicence(request)).licenceNumber).toBeNull();
        const issuing = new FakeNationalDriverPlatform({ issuesNumbers: true });
        expect((await issuing.requestLicence(request)).licenceNumber).toMatch(/^ETH-/);
    });

    it('can stall, then decide, keeping one record for the request', async () => {
        let decision: 'pending' | 'accepted' = 'pending';
        const platform = new FakeNationalDriverPlatform({ decide: () => ({ status: decision }) });
        const first = await platform.requestLicence(request);
        expect(first.status).toBe('pending');
        expect(await platform.licenceStatus(first.reference)).toMatchObject({ status: 'pending' });
        decision = 'accepted';
        const later = await platform.requestLicence(request);
        expect(later).toMatchObject({ status: 'accepted', reference: first.reference });
    });
});
