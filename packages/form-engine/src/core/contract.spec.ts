import { describe, expect, it } from 'vitest';

import { checkContract, contractInput, contractLocks } from './contract';

const field = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    label: id,
    props: {},
    behavior: { validation: { supported: true } },
    ...extra
});
const required = (id: string, type: string, extra: Record<string, unknown> = {}) =>
    field(id, type, { ...extra, props: { required: true, ...(extra.props ?? {}) } });

const licence = {
    applicant: { kind: 'ref' as const },
    category: { kind: 'choice' as const },
    medical: { kind: 'files' as const },
    note: { kind: 'text' as const, required: false }
};
const doc = (fields: unknown[]) => ({ schemaVersion: 2, fields });
const sound = [
    required('applicant', 'RegistryLookup'),
    required('category', 'Dropdown', { props: { options: [{ label: 'B', value: 'b' }] } }),
    required('medical', 'FileUpload'),
    field('remark', 'InputText')
];

describe("an effect's input contract", () => {
    it('is met by a form with every field, of its kind, required where the contract requires it', () => {
        expect(checkContract(licence, doc(sound))).toEqual([]);
    });

    it('names what is missing, of another kind, optional where required, or hidden by a condition', () => {
        const fields = [
            field('applicant', 'RegistryLookup'),
            required('category', 'InputText'),
            required('medical', 'FileUpload', {
                behavior: {
                    validation: { supported: true },
                    visibilityConditions: [{ field: 'remark', operator: 'equals', value: 'x' }]
                }
            })
        ];
        expect(checkContract(licence, doc(fields))).toEqual([
            { path: 'applicant', key: 'applicant', code: 'not_required' },
            { path: 'category', key: 'category', code: 'wrong_kind', expected: 'choice', actual: 'text' },
            { path: 'medical', key: 'medical', code: 'conditional' }
        ]);
        // the medical certificate taken out of the form
        expect(checkContract(licence, doc(sound.filter((f) => f.id !== 'medical')))).toEqual([
            { path: 'medical', key: 'medical', code: 'missing' }
        ]);
        // an optional field may be absent, but not of another kind
        expect(checkContract({ note: { kind: 'text', required: false } }, doc([]))).toEqual([]);
        expect(checkContract({ note: { kind: 'text', required: false } }, doc([field('note', 'InputNumber')]))).toEqual(
            [{ path: 'note', key: 'note', code: 'wrong_kind', expected: 'text', actual: 'number' }]
        );
    });

    it('reads a path through the service version mapping, and never a field inside a repeating section', () => {
        const mapped = [...sound.filter((f) => f.id !== 'category'), required('licenceClass', 'RadioButton')];
        expect(checkContract(licence, doc(mapped), { category: 'licenceClass' })).toEqual([]);
        const inRows = [
            ...sound.filter((f) => f.id !== 'medical'),
            field('rows', 'FormArray', { layout: { options: { isContainer: true } } }),
            required('medical', 'FileUpload', { parentId: 'rows' })
        ];
        expect(checkContract(licence, doc(inRows)).map((p) => p.code)).toContain('missing');
    });

    it('locks the mapped keys, and gives the effect its input by path, naming a required value left blank', () => {
        expect(contractLocks(licence, { category: 'licenceClass' }).map((l) => l.key)).toEqual([
            'applicant',
            'licenceClass',
            'medical',
            'note'
        ]);
        expect(
            contractInput(
                licence,
                { applicant: 'p1', licenceClass: 'b', medical: ['f1'], remark: 'x' },
                {
                    category: 'licenceClass'
                }
            )
        ).toEqual({ input: { applicant: 'p1', category: 'b', medical: ['f1'] }, missing: [] });
        expect(contractInput(licence, { applicant: 'p1', medical: [] }).missing).toEqual(['category', 'medical']);
    });
});
