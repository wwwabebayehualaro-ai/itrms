// @vitest-environment node
// Task 1.13c: wizard steps and the logic inspector as the core reads them, and the 1.13a review's follow-ups 256 and 257 (a typed
// place where only the device's is taken; checklist texts bounded).
import { describe, expect, it } from 'vitest';

import {
    checkDocument,
    errorField,
    errorsOfStep,
    explainField,
    firstStepWithErrors,
    printModel,
    readDocument,
    stepOf,
    validateForm as validate,
    wizardSteps
} from './';

const validateForm = (...[fields, values, scope]: Parameters<typeof validate>) =>
    validate(fields, values, scope, { language: 'en' });
const V = { supported: true };
const container = { layout: { options: { isContainer: true } } };
const doc = (...fields: Record<string, unknown>[]) => readDocument({ fields }).fields;
const byIdOf = (fields: ReturnType<typeof doc>) => new Map(fields.map((f) => [f.id, f]));

const WIZARD = doc(
    { id: 'applicant', type: 'FormStep', label: 'Applicant', ...container },
    { id: 'name', type: 'InputText', parentId: 'applicant', props: { required: true }, behavior: { validation: V } },
    { id: 'box', type: 'Panel', parentId: 'applicant', ...container },
    { id: 'phone', type: 'InputText', parentId: 'box', props: { required: true }, behavior: { validation: V } },
    { id: 'vehicle', type: 'FormStep', label: 'Vehicle', ...container },
    { id: 'lines', type: 'FormArray', parentId: 'vehicle', props: { minItems: 1 }, ...container },
    { id: 'what', type: 'InputText', parentId: 'lines', props: { required: true }, behavior: { validation: V } },
    { id: 'gone', type: 'FormStep', label: 'Gone', ...container, removed: true },
    { id: 'note', type: 'InputText', props: { required: true }, behavior: { validation: V } }
);

describe('wizard steps', () => {
    const byId = byIdOf(WIZARD);

    it('are the top-level steps in order, a removed one left out', () => {
        expect(wizardSteps(WIZARD).map((s) => s.id)).toEqual(['applicant', 'vehicle']);
        expect(wizardSteps(doc({ id: 'a', type: 'InputText' }))).toEqual([]);
    });

    it('place each field in its step through its containers; a field outside every step is in none', () => {
        expect(stepOf('name', byId)).toBe('applicant');
        expect(stepOf('phone', byId)).toBe('applicant');
        expect(stepOf('what', byId)).toBe('vehicle');
        expect(stepOf('note', byId)).toBeNull();
        expect(errorField('lines[0].what')).toBe('lines');
        expect(errorField('lines.what')).toBe('lines');
    });

    it("split the form's errors by step, and send a stopped submit to the first step holding one", () => {
        const errors = validateForm(WIZARD, { lines: [] });
        expect(Object.keys(errorsOfStep(errors, 'applicant', byId)).sort()).toEqual(['name', 'phone']);
        expect(Object.keys(errorsOfStep(errors, 'vehicle', byId))).toEqual(['lines']);
        expect(Object.keys(errorsOfStep(errors, null, byId))).toEqual(['note']);
        const steps = wizardSteps(WIZARD);
        expect(firstStepWithErrors(errors, steps, byId)).toBe('applicant');
        expect(firstStepWithErrors({ note: 'x' }, steps, byId)).toBe('vehicle');
        expect(firstStepWithErrors({}, steps, byId)).toBeUndefined();
    });

    it('are checked whole by the server: a step holds no value of its own', () => {
        const errors = validateForm(WIZARD, { name: 'A', phone: '0911', lines: [{ what: 'x' }], note: 'n' });
        expect(errors).toEqual({});
    });

    it('stand only at the top of a form', () => {
        expect(
            checkDocument({
                fields: [
                    { id: 'outer', type: 'Panel', ...container },
                    { id: 'inner', type: 'FormStep', parentId: 'outer', ...container }
                ]
            })
        ).toEqual([{ path: 'fields[1].parentId', message: 'The step "inner" must be at the top of the form' }]);
        expect(checkDocument({ fields: [{ id: 'one', type: 'FormStep', ...container }] })).toEqual([]);
    });

    it('print as groups with their headings', () => {
        const printed = printModel(WIZARD, { name: 'A' }, { language: 'en' });
        expect(printed.nodes.map((n) => n.kind === 'group' && n.title)).toContain('Applicant');
    });
});

describe('the logic inspector', () => {
    const fields = doc(
        {
            id: 'company',
            type: 'Checkbox'
        },
        {
            id: 'box',
            type: 'Panel',
            label: 'Company details',
            ...container,
            behavior: { visibilityConditions: [{ field: 'company', operator: 'eq', value: true }] }
        },
        {
            id: 'tin',
            type: 'InputText',
            label: 'TIN',
            parentId: 'box',
            behavior: {
                validation: V,
                visibilityConditions: [
                    { field: 'kind', operator: 'in', value: ['plc', 'sc'], logic: 'or' },
                    { field: 'size', operator: 'gt', value: 10 }
                ],
                enabledConditions: [{ field: 'locked', operator: 'neq', value: true }]
            }
        },
        {
            id: 'reason',
            type: 'InputText',
            behavior: { validation: { ...V, requiredWhen: { expression: 'form.size > 100' } } }
        }
    );
    const byId = byIdOf(fields);
    const field = (id: string) => {
        const f = byId.get(id);
        if (!f) throw new Error(id);
        return f;
    };

    it('names the container whose rule hides a field, with the value it looked at', () => {
        const why = explainField(field('tin'), byId, { company: false, kind: 'plc' });
        expect(why.visible).toBe(false);
        expect(why.visibility.map((s) => [s.fieldId, s.rule.holds])).toEqual([
            ['tin', true],
            ['box', false]
        ]);
        expect(why.visibility[1]?.rule.conditions).toEqual([
            { field: 'company', operator: 'eq', actual: false, expected: true, holds: false }
        ]);
    });

    it("explains the field's own list with its logic, each condition decided, and its lock", () => {
        const why = explainField(field('tin'), byId, { company: true, kind: 'ngo', size: 20, locked: true });
        expect(why.visible).toBe(true);
        const own = why.visibility[0];
        expect(own?.rule.logic).toBe('or');
        expect(own?.rule.conditions.map((c) => [c.field, c.actual, c.holds])).toEqual([
            ['kind', 'ngo', false],
            ['size', 20, true]
        ]);
        expect(why.enabled).toBe(false);
        expect(why.enablement[0]?.rule.conditions[0]).toMatchObject({ field: 'locked', actual: true, holds: false });
        expect(why.requiredBy).toBeNull();
    });

    it('says why a field is required: its formula, and whether it holds now', () => {
        expect(explainField(field('reason'), byId, { size: 150 })).toMatchObject({
            required: true,
            requiredBy: { expression: 'form.size > 100', holds: true }
        });
        expect(explainField(field('reason'), byId, { size: 5 }).requiredBy).toEqual({
            expression: 'form.size > 100',
            holds: false
        });
    });
});

describe('the 1.13a review follow-ups', () => {
    it("refuses a typed place on a field that takes only the device's (256)", () => {
        const place = doc({
            id: 'site',
            type: 'GeoPoint',
            props: { allowManual: false },
            behavior: { validation: V }
        });
        expect(validateForm(place, { site: { lat: 6.85, lng: 37.75 } })).toEqual({
            site: 'Take this place with the device: it cannot be typed in.'
        });
        expect(validateForm(place, { site: { lat: 6.85, lng: 37.75, accuracy: 12 } })).toEqual({});
    });

    it('bounds a checklist item text and a section title (257)', () => {
        const sheet = (text: string) => ({
            fields: [
                {
                    id: 'sheet',
                    type: 'Checklist',
                    props: { sections: [{ key: 's', title: 'Brakes', items: [{ key: 'i', text: { en: text } }] }] }
                }
            ]
        });
        expect(checkDocument(sheet('Service brake'))).toEqual([]);
        expect(checkDocument(sheet('x'.repeat(501)))).toEqual([
            expect.objectContaining({ path: expect.stringContaining('items[0].text') as unknown })
        ]);
    });
});
