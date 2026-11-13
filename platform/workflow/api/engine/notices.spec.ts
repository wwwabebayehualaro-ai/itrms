import { describe, expect, it } from 'vitest';

import { noticesOf } from './notices';

describe('the notices of a case (task 1.2e)', () => {
    it('collects the message keys each fact raised, once each, in the facts’ order', () => {
        expect(
            noticesOf({
                registration: { vinKey: 'X', notices: ['competency.notice.chassisMismatch'] },
                plate: { key: 'ETHAAA1234' },
                other: { notices: ['competency.notice.chassisMismatch', 'fees.notice.waived'] }
            })
        ).toEqual(['competency.notice.chassisMismatch', 'fees.notice.waived']);
    });

    it('keeps only message keys: no typed text, no other values, nothing from a fact that is not an object', () => {
        expect(
            noticesOf({
                a: { notices: ['Free text a person typed', 42, null, 'competency.notice', 'competency.notice.ok'] },
                b: { notices: 'competency.notice.notAList' },
                c: ['competency.notice.inAList'],
                d: 'competency.notice.aString'
            })
        ).toEqual(['competency.notice.ok']);
        expect(noticesOf(null)).toEqual([]);
        expect(noticesOf('facts')).toEqual([]);
        expect(noticesOf({})).toEqual([]);
    });
});
