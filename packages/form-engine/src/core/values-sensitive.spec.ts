/**
 * What a browser may keep of a draft (task 0.20c, SEC-WB-3): only the answers of fields classified and not Sensitive;
 * nothing of a field inside a Sensitive container, of a field without a data class, nor keys the form does not have;
 * rows of a repeating section keep only their own such answers.
 */
import { describe, expect, it } from 'vitest';

import { keepsServerOnly, readDocument, withoutSensitive } from './';

const field = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'InputText',
    category: 'Input',
    label: id,
    props: {},
    ...extra
});
const section = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    type: 'FormArray',
    category: 'Layout',
    label: id,
    props: {},
    layout: { options: { isContainer: true } },
    ...extra
});

const { fields } = readDocument({
    fields: [
        field('name', { classification: 'personal' }),
        field('fin', { classification: 'sensitive' }),
        field('town', { classification: 'internal' }),
        field('note'),
        section('children', { classification: 'personal' }),
        field('childName', { parentId: 'children', classification: 'personal' }),
        field('childFin', { parentId: 'children', classification: 'sensitive' }),
        section('medical', { classification: 'sensitive' }),
        field('result', { parentId: 'medical', classification: 'personal' })
    ]
});

describe('withoutSensitive', () => {
    it('drops the Sensitive answers, those inside a Sensitive container, the unclassified, and unknown keys', () => {
        expect(
            withoutSensitive(fields, {
                name: 'Abebe',
                fin: '1234 5678 9012',
                town: 'Boditi',
                note: 'a FIN on an old form',
                children: [
                    { childName: 'Almaz', childFin: '2222' },
                    { childName: 'Kebede', childFin: '3333' }
                ],
                medical: [{ result: 'fit' }],
                ghost: 'x'
            })
        ).toEqual({ name: 'Abebe', town: 'Boditi', children: [{ childName: 'Almaz' }, { childName: 'Kebede' }] });
    });

    it('counts an unclassified field as personal elsewhere, and says when a form keeps answers on the server only', () => {
        expect(fields.find((f) => f.id === 'note')?.classification).toBe('personal');
        expect(keepsServerOnly(fields)).toBe(true);
        expect(keepsServerOnly(readDocument({ fields: [field('a')] }).fields)).toBe(true);
        expect(keepsServerOnly(readDocument({ fields: [field('a', { classification: 'personal' })] }).fields)).toBe(
            false
        );
    });
});
