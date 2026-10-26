import { ForbiddenError } from '@itrms/kernel/errors';
import { describe, expect, it } from 'vitest';

import { assertMayLookUp } from './lookups';

describe('assertMayLookUp', () => {
    it('lets a caller who holds the registry permission through', () => {
        expect(() => assertMayLookUp(new Set(['person:read']), { permission: 'person:read' })).not.toThrow();
    });

    it('refuses with a 403 whose audit data names the missing permission', () => {
        let refusal: unknown;
        try {
            assertMayLookUp(new Set(['form:read']), { permission: 'person:read' });
        } catch (error) {
            refusal = error;
        }
        expect(refusal).toBeInstanceOf(ForbiddenError);
        expect(refusal).toMatchObject({ audit: { reason: 'missing_permission', permission: 'person:read' } });
    });
});
