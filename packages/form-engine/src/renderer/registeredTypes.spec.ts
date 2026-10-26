import { describe, expect, it } from 'vitest';
import { FIELD_TYPES } from '#core/fieldTypes';
import './fields/registerAll';
import { registeredTypes } from './kit';

describe('field types', () => {
    it('are the ones the kit registers (core/fieldTypes.ts is kept by hand, the API checks forms with it)', () => {
        expect(new Set(registeredTypes())).toEqual(new Set(FIELD_TYPES));
    });
});
