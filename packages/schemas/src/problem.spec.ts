import { describe, expect, it } from 'vitest';

import { problemFieldErrors, problemMessage } from './problem';

describe('problemMessage', () => {
    it('reads problem+json field errors first, then the legacy shapes', () => {
        expect(
            problemMessage({ detail: 'Invalid', errors: [{ field: 'a', message: 'Too short' }, { message: 'Nope' }] })
        ).toBe('a: Too short; Nope');
        expect(problemMessage({ error: 'Locked' })).toBe('Locked');
        expect(problemMessage({ detail: 'Modified by someone else' })).toBe('Modified by someone else');
        expect(problemMessage({ detail: [{ msg: 'field required' }, 'bad'] })).toBe('field required; bad');
        expect(problemMessage({ message: 'Gone' })).toBe('Gone');
    });

    it('carries no message for anything else, and one malformed key hides nothing', () => {
        expect(problemMessage(undefined)).toBeUndefined();
        expect(problemMessage('text')).toBeUndefined();
        expect(problemMessage({ title: 'Conflict' })).toBeUndefined();
        expect(problemMessage({ detail: 5, message: 'Still here' })).toBe('Still here');
    });
});

describe('problemFieldErrors', () => {
    it('puts known fields on the fields and keeps the rest', () => {
        const body = {
            errors: [{ field: 'key', message: 'Too short' }, { field: 'other', message: 'Nope' }, { field: 'key' }]
        };
        expect(problemFieldErrors(body, ['key'])).toEqual({
            fields: { key: 'Too short' },
            rest: ['other: Nope', 'key: Invalid value']
        });
        expect(problemFieldErrors(body)).toEqual({
            fields: { key: 'Too short', other: 'Nope' },
            rest: ['key: Invalid value']
        });
    });

    it('is undefined when the body has no field errors', () => {
        expect(problemFieldErrors({ detail: 'x' })).toBeUndefined();
        expect(problemFieldErrors({ errors: [] })).toBeUndefined();
    });
});
