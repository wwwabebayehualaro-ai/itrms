import { ApiError } from '@/lib/api/http';
import { describe, expect, it } from 'vitest';
import { serverFormErrors } from '@/lib/forms/serverErrors';

const problem = (status: number, data: unknown) =>
    new ApiError('failed', 'ERR_BAD_RESPONSE', { url: 'x' }, { status, headers: {}, data });

describe('serverFormErrors', () => {
    it('maps problem+json field errors onto known fields and keeps the rest for the form', () => {
        const err = problem(422, {
            detail: 'Invalid',
            errors: [
                { field: 'key', message: 'Too short' },
                { field: 'other', message: 'Nope' }
            ]
        });
        expect(serverFormErrors(err, ['key'])).toEqual({ fields: { key: 'Too short' }, form: 'other: Nope' });
    });

    it('uses the problem detail when there are no field errors', () => {
        const err = problem(409, { detail: 'The resource was modified by someone else.' });
        expect(serverFormErrors(err)).toEqual({ fields: {}, form: 'The resource was modified by someone else.' });
    });
});
