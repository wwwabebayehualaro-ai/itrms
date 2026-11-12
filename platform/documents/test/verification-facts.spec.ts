/**
 * What a document shows of its holder on the public page (task 0.23b): a masked name; a libre's owners masked one by one
 * (task 1.2b).
 */
import { describe, expect, it } from 'vitest';

import { factsOf, maskedName } from '../api/verification-facts';

describe('the masked holder', () => {
    it('keeps the first letter of each word', () => {
        expect(maskedName(' Abebe  Kebede ')).toBe('A**** K*****');
        expect(maskedName('አበበ ከበደ')).toBe('አ** ከ**');
    });

    it("keeps a libre's owners apart", () => {
        const facts = factsOf('vehicle-libre.v1', {
            owners: [{ name: 'Abebe Kebede' }, { name: '' }, null, { name: 'Sara Tadesse' }]
        });
        expect(facts).toEqual({ holder: 'Abebe Kebede, Sara Tadesse', validUntil: null });
        expect(maskedName(facts.holder ?? '')).toBe('A**** K*****, S*** T******');
        // the registration certificate (ADR-0050) names its owners the same way
        expect(
            factsOf('vehicle-registration-certificate.v1', { owners: [{ name: 'Abebe Kebede', address: null }] })
        ).toEqual({ holder: 'Abebe Kebede', validUntil: null });
    });
});
