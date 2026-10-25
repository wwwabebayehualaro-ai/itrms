import { describe, expect, it } from 'vitest';

import {
    filterKeys,
    formChangeOf,
    historyOf,
    keyOf,
    publishedOf,
    queryOf,
    resultOf,
    savedViewOf,
    submissionOf,
    templateOf,
    textOf,
    toWireConfig,
    toWireKey,
    toScreenKey,
    viewSchemaOf,
    type WireForm,
    type WireSavedView,
    type WireSubmission,
    type WireViewSchema
} from './wire';

const unit = { id: '00000000-0000-4000-8000-0000000000a1', code: 'DAMOT', name: { am: 'ዳሞት', en: 'Damot' } };

const form: WireForm = {
    id: '00000000-0000-4000-8000-000000000001',
    version: 7,
    key: 'trip-request',
    name: { am: 'የጉዞ ጥያቄ', en: 'Trip request' },
    category: 'Transport',
    active: true,
    status: 'pending',
    ownerUnit: unit,
    publishedVersion: {
        id: '00000000-0000-4000-8000-0000000000b2',
        number: 2,
        publishedAt: '2026-10-20T07:00:00.000Z'
    },
    updatedAt: '2026-10-21T07:00:00.000Z',
    document: { schemaVersion: 2, fields: [{ id: 'destination', type: 'InputText', label: 'Destination' }] }
};

const submission: WireSubmission = {
    id: '00000000-0000-4000-8000-0000000000c3',
    version: 1,
    formId: form.id,
    formVersion: { id: '00000000-0000-4000-8000-0000000000b2', number: 2 },
    caseId: null,
    handlingUnit: unit,
    answers: { destination: 'Sodo' },
    submittedBy: '00000000-0000-4000-8000-0000000000d4',
    submittedByName: 'Almaz T.',
    createdAt: '2026-10-22T07:00:00.000Z',
    updatedAt: '2026-10-22T07:00:00.000Z'
};

describe('the forms API on the wire, as the screens see it', () => {
    it('reads a form as a template: its name in the language, its key, its state and its version for If-Match', () => {
        expect(templateOf(form)).toMatchObject({
            id: form.id,
            name: 'Trip request',
            slug: 'trip-request',
            version: '2',
            category: 'Transport',
            is_active: true,
            status: 'pending_approval',
            row_version: 7,
            published_version_id: '00000000-0000-4000-8000-0000000000b2',
            form_config: form.document
        });
        expect(textOf(form.name, 'am')).toBe('የጉዞ ጥያቄ');
        // a list carries no document: an empty one, never a guess
        expect(templateOf({ ...form, document: undefined, publishedVersion: null })).toMatchObject({
            form_config: { fields: [] },
            version: '',
            published_version_id: null
        });
    });

    it('sends only what a change may change, the builder field list as a document', () => {
        expect(
            formChangeOf({
                name: 'Trip',
                slug: 'ignored',
                version: '9',
                category: '',
                is_active: false,
                form_config: [{ id: 'a' }]
            })
        ).toEqual({
            name: { am: 'Trip', en: 'Trip' },
            category: null,
            active: false,
            document: { fields: [{ id: 'a' }] }
        });
        expect(formChangeOf({ row_version: 3 })).toEqual({});
    });

    it('makes a key the API takes from any name', () => {
        expect(keyOf('Driving Licence — Renewal!')).toBe('driving-licence-renewal');
        expect(keyOf('የመንጃ ፈቃድ')).toMatch(/^form-[a-z0-9]+$/);
    });

    it('reads the published version as the form people fill in', () => {
        const version = { id: 'v2', formId: form.id, number: 2, document: { fields: [] }, createdAt: '' };
        expect(publishedOf(form, version)).toMatchObject({
            template_id: form.id,
            version_id: 'v2',
            version: '2',
            name: 'Trip request',
            form_config: { fields: [] }
        });
    });

    it('reads a submission with its office and its submitter by name', () => {
        expect(submissionOf(submission)).toMatchObject({
            id: submission.id,
            template_id: form.id,
            submission_data: { destination: 'Sodo' },
            submitted_by: submission.submittedBy,
            submitted_by_name: 'Almaz T.',
            handling_unit: unit.id,
            handling_unit_name: expect.any(String) as unknown,
            created_at: submission.createdAt,
            version: 2
        });
    });

    it('renames the built-ins both ways and leaves a form’s own keys alone', () => {
        for (const [screen, wire] of [
            ['created_at', 'createdAt'],
            ['submitted_by', 'submittedBy'],
            ['handling_unit', 'handlingUnit']
        ] as const) {
            expect(toWireKey(screen)).toBe(wire);
            expect(toScreenKey(wire)).toBe(screen);
        }
        expect(toWireKey('destination')).toBe('destination');
        expect(toScreenKey('destination')).toBe('destination');
    });

    it('sends a viewer query in the API’s words, nested filters included', () => {
        expect(
            queryOf({
                template_id: form.id,
                filter: {
                    op: 'and',
                    items: [
                        { field: 'created_at', op: 'gte', value: '2026-10-01' },
                        { op: 'or', items: [{ field: 'handling_unit', op: 'eq', value: unit.id }] }
                    ]
                },
                search: '',
                sort: [{ field: 'created_at', desc: true }, { field: 'destination' }],
                page: 2,
                page_size: 50,
                aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'amount', alias: 'total' }],
                group_by: { field: 'handling_unit' },
                then_by: { field: 'created_at', bucket: 'month' },
                facets: ['submitted_by'],
                rows: false
            })
        ).toEqual({
            formId: form.id,
            filter: {
                op: 'and',
                items: [
                    { field: 'createdAt', op: 'gte', value: '2026-10-01' },
                    { op: 'or', items: [{ field: 'handlingUnit', op: 'eq', value: unit.id }] }
                ]
            },
            sort: [
                { field: 'createdAt', desc: true },
                { field: 'destination', desc: false }
            ],
            page: 2,
            pageSize: 50,
            aggregates: [{ fn: 'count' }, { fn: 'sum', field: 'amount', alias: 'total' }],
            groupBy: { field: 'handlingUnit' },
            thenBy: { field: 'createdAt', bucket: 'month' },
            facets: ['submittedBy'],
            rows: false
        });
    });

    it('reads a result with the screens’ page size and facet keys', () => {
        const r = resultOf({
            items: [submission],
            total: 41,
            page: 2,
            pageSize: 20,
            aggregates: { total: 12 },
            groups: [{ key: unit.id, key2: null, count: 41, aggregates: {} }],
            facets: { submittedBy: [{ value: submission.submittedBy, count: 41 }] }
        });
        expect(r).toMatchObject({ total: 41, page: 2, page_size: 20, aggregates: { total: 12 } });
        expect(Object.keys(r.facets)).toEqual(['submitted_by']);
        expect(r.items[0]?.submitted_by_name).toBe('Almaz T.');
    });

    it('reads the view schema: the office as a choice among its offices, the submitter as a person', () => {
        const wire: WireViewSchema = {
            fields: [
                {
                    key: 'handlingUnit',
                    label: 'Office',
                    kind: 'unit',
                    builtin: true,
                    ops: ['eq', 'in'],
                    sortable: true,
                    groupable: true,
                    aggregatable: false,
                    options: [{ value: unit.id, label: 'Damot' }],
                    currency: null,
                    type: null,
                    filterable: true,
                    indexed: true
                },
                {
                    key: 'submittedBy',
                    label: 'Submitted by',
                    kind: 'person',
                    builtin: true,
                    ops: ['eq'],
                    sortable: true,
                    groupable: true,
                    aggregatable: false,
                    options: [],
                    currency: null,
                    type: null,
                    filterable: true,
                    indexed: true
                },
                {
                    key: 'amount',
                    label: 'Amount',
                    kind: 'number',
                    builtin: false,
                    ops: ['gt'],
                    sortable: true,
                    groupable: false,
                    aggregatable: true,
                    options: [{ value: 5, label: 'five' }],
                    currency: 'ETB',
                    type: 'InputNumber',
                    filterable: false,
                    indexed: false
                }
            ],
            roles: {
                title: null,
                subtitle: 'amount',
                stage: 'handlingUnit',
                date: 'createdAt',
                dateEnd: null,
                measures: ['amount'],
                people: ['submittedBy'],
                files: [],
                rows: []
            },
            modes: ['table', 'board']
        };
        const s = viewSchemaOf(wire);
        expect(s.fields.map((f) => [f.key, f.kind, f.person])).toEqual([
            ['handling_unit', 'choice', false],
            ['submitted_by', 'person', true],
            ['amount', 'number', false]
        ]);
        expect(s.fields[2]?.options).toEqual([{ value: '5', label: 'five' }]);
        expect(s.roles).toMatchObject({ stage: 'handling_unit', date: 'created_at', people: ['submitted_by'] });
    });

    it('reads the history as the record page lists it (changed fields, never their values)', () => {
        expect(
            historyOf({
                items: [
                    { id: 'h1', action: 'insert', at: 'T', actorId: 'p', actorName: 'Almaz T.', changes: ['answers'] }
                ],
                truncated: false
            })
        ).toEqual([
            {
                id: 'h1',
                action: 'insert',
                occurred_at: 'T',
                actor_id: 'p',
                actor_name: 'Almaz T.',
                changes: [{ field: 'answers' }]
            }
        ]);
    });

    it('reads a saved view and sends it back unchanged: the office’s views are “shared” on screen', () => {
        const wire: WireSavedView = {
            id: 'view-1',
            version: 3,
            formId: form.id,
            name: 'This month',
            visibility: 'unit',
            isDefault: true,
            config: {
                mode: 'table',
                filter: { op: 'and', items: [{ field: 'createdAt', op: 'gte', value: '2026-10-01' }] },
                sort: [{ field: 'createdAt', desc: true }],
                columns: ['destination', 'handlingUnit'],
                pageSize: 50,
                options: {}
            },
            ownerId: null,
            canEdit: true
        };
        const screen = savedViewOf(wire);
        expect(screen).toMatchObject({
            template_id: form.id,
            visibility: 'shared',
            is_default: true,
            row_version: 3,
            config: { search: '', columns: ['destination', 'handling_unit'], page_size: 50 }
        });
        expect(toWireConfig(screen.config)).toEqual(wire.config);
        // an empty search and filter are left out, not sent empty
        expect(toWireConfig({ ...screen.config, search: '', filter: { op: 'and', items: [] } })).not.toHaveProperty(
            'filter'
        );
        expect(filterKeys(undefined, toWireKey)).toBeUndefined();
    });
});
