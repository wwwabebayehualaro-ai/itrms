/**
 * What a browser may keep of a draft (task 0.20c, SEC-WB-3): the answers without those of fields classified Sensitive,
 * nor of fields inside a Sensitive container, nor keys the form does not have; rows of a repeating section keep only
 * their own non-Sensitive answers.
 */
import { describe, expect, it } from 'vitest';

import { hasSensitive, readDocument, withoutSensitive } from './';

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
        field('town'),
        section('children'),
        field('childName', { parentId: 'children' }),
        field('childFin', { parentId: 'children', classification: 'sensitive' }),
        section('medical', { classification: 'sensitive' }),
        field('result', { parentId: 'medical' })
    ]
});

describe('withoutSensitive', () => {
    it('drops the Sensitive answers, those inside a Sensitive container, and unknown keys', () => {
        expect(
            withoutSensitive(fields, {
                name: 'Abebe',
                fin: '1234 5678 9012',
                town: 'Boditi',
                children: [
                    { childName: 'Almaz', childFin: '2222' },
                    { childName: 'Kebede', childFin: '3333' }
                ],
                medical: [{ result: 'fit' }],
                ghost: 'x'
            })
        ).toEqual({ name: 'Abebe', town: 'Boditi', children: [{ childName: 'Almaz' }, { childName: 'Kebede' }] });
    });

    it('counts an unclassified field as personal (kept), and says when a form has Sensitive fields', () => {
        expect(fields.find((f) => f.id === 'town')?.classification).toBe('personal');
        expect(hasSensitive(fields)).toBe(true);
        expect(hasSensitive(readDocument({ fields: [field('a')] }).fields)).toBe(false);
    });
});
