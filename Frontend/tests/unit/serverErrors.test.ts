import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { serverFormErrors } from '@platform/lib/forms/serverErrors';

const problem = (status: number, data: unknown) =>
    new AxiosError('failed', String(status), undefined, undefined, { status, statusText: '', headers: {}, config: { headers: new AxiosHeaders() }, data });

describe('serverFormErrors', () => {
    it('maps problem+json field errors onto known fields and keeps the rest for the form', () => {
        const err = problem(422, { detail: 'Invalid', errors: [{ field: 'key', message: 'Too short' }, { field: 'other', message: 'Nope' }] });
        expect(serverFormErrors(err, ['key'])).toEqual({ fields: { key: 'Too short' }, form: 'other: Nope' });
    });

    it('uses the problem detail when there are no field errors', () => {
        const err = problem(409, { detail: 'The resource was modified by someone else.' });
        expect(serverFormErrors(err)).toEqual({ fields: {}, form: 'The resource was modified by someone else.' });
    });
});
