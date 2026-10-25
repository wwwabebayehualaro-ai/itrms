// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { FormField } from '@itrms/schemas';

import { renameFieldKey } from './fieldKeys';

const field = (id: string, extra: Partial<FormField> = {}): FormField => ({
    id,
    type: 'InputText',
    props: {},
    ...extra
});

describe('renameFieldKey', () => {
    it("renames a key inside the rules' formulas (bare formulas, without {{= }})", () => {
        const [, note] = renameFieldKey(
            [
                field('grade'),
                field('note', {
                    behavior: {
                        validation: {
                            supported: true,
                            requiredWhen: { expression: 'form.grade >= 3 && form.grades != 1' },
                            validWhen: [{ expression: 'row.grade > 0', message: { am: 'ደረጃ', en: 'Grade' } }]
                        }
                    }
                })
            ],
            'grade',
            'level'
        );
        expect(note?.behavior?.validation?.requiredWhen?.expression).toBe('form.level >= 3 && form.grades != 1');
        expect(note?.behavior?.validation?.validWhen).toEqual([
            { expression: 'row.level > 0', message: { am: 'ደረጃ', en: 'Grade' } }
        ]);
    });
});
