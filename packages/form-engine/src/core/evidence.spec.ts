// @vitest-environment node
// The inspection and evidence field types (task 1.13a): Checklist, Signature, Photo and GeoPoint, as the server checks them.
import { describe, expect, it } from 'vitest';
import { fieldTexts } from '@itrms/schemas';

import {
    checkDocument,
    checklistOf,
    checklistOutcome,
    contractInput,
    derivedValues,
    initialValues,
    isFileField,
    printValueText,
    readDocument,
    settledValues,
    shapeError,
    submittedValues,
    validateForm as validate,
    valueKindOf
} from './';

const validateForm = (...[fields, values, scope]: Parameters<typeof validate>) =>
    validate(fields, values, scope, { language: 'en' });
const V = { supported: true };
const doc = (...fields: Record<string, unknown>[]) => readDocument({ fields }).fields;
const nth = <T>(xs: readonly T[], i: number): T => {
    const x = xs[i];
    if (x === undefined) throw new Error(`no item ${i}`);
    return x;
};
const first = <T>(xs: readonly T[]): T => nth(xs, 0);

/** The bureau's light-vehicle sheet, shortened: two sections, an item that may not apply. */
const BOLO = {
    id: 'inspection',
    type: 'Checklist',
    behavior: { validation: V },
    props: {
        required: true,
        sections: [
            {
                key: 'brakes',
                title: { am: 'ፍሬን', en: 'Brakes' },
                items: [
                    { key: 'service', text: { am: 'የእግር ፍሬን', en: 'Service brake' } },
                    { key: 'parking', text: { am: 'የእጅ ፍሬን', en: 'Parking brake' } }
                ]
            },
            {
                key: 'lights',
                title: { am: 'መብራቶች', en: 'Lights' },
                items: [
                    { key: 'head', text: 'Headlights' },
                    { key: 'fog', text: 'Fog lights' }
                ]
            }
        ]
    }
};

/** The practical exam's sheet, shortened: points, a critical item, a pass mark. */
const EXAM = {
    id: 'exam',
    type: 'Checklist',
    behavior: { validation: V },
    props: {
        required: true,
        scoring: 'points',
        passMark: 15,
        allowNotApplicable: false,
        remarkOnFail: true,
        sections: [
            {
                key: 'drive',
                items: [
                    { key: 'mirrors', text: 'Mirrors', points: 5 },
                    { key: 'signals', text: 'Signals', points: 5 },
                    { key: 'stop', text: 'Stops at the line', points: 10, critical: true }
                ]
            }
        ]
    }
};

const bolo = () => doc(BOLO);
const exam = () => doc(EXAM);
const all = (result: 'pass' | 'fail' | 'na') => ({
    service: { result },
    parking: { result },
    head: { result },
    fog: { result }
});

describe('a checklist (pass / fail)', () => {
    it('passes only when no item failed, leaves out what does not apply, and decides nothing while an item is open', () => {
        const f = first(bolo());
        const def = checklistOf(f);
        expect(def).not.toBeNull();
        if (!def) return;
        expect(checklistOutcome(def, all('pass'))).toEqual({
            total: 4,
            max: 4,
            failed: [],
            criticalFailed: [],
            passed: true
        });
        expect(checklistOutcome(def, { ...all('pass'), fog: { result: 'na' } })).toMatchObject({
            total: 3,
            max: 3,
            passed: true
        });
        expect(checklistOutcome(def, { ...all('pass'), parking: { result: 'fail' } })).toMatchObject({
            total: 3,
            max: 4,
            failed: ['parking'],
            passed: false
        });
        // one item open: nothing decided, but the failure already shows
        expect(checklistOutcome(def, { service: { result: 'fail' } })).toMatchObject({
            failed: ['service'],
            passed: null
        });
    });

    it('is refused on the server with an item unanswered (named as the sheet numbers it), an item it does not have, or an answer it does not know', () => {
        const fields = bolo();
        expect(validateForm(fields, { inspection: { items: all('pass') } })).toEqual({});
        expect(
            validateForm(fields, { inspection: { items: { service: { result: 'pass' }, head: { result: 'fail' } } } })
        ).toEqual({
            inspection: 'Answer every item: 1.2, 2.2 not answered'
        });
        expect(validateForm(fields, {}).inspection).toBe('This field is required');
        expect(validateForm(fields, { inspection: { items: {} } }).inspection).toBe('This field is required');
        const refused = "Check the checklist's answers";
        expect(
            validateForm(fields, { inspection: { items: { ...all('pass'), wheels: { result: 'pass' } } } }).inspection
        ).toBe(refused);
        expect(
            validateForm(fields, { inspection: { items: { ...all('pass'), fog: { result: 'ok' } } } }).inspection
        ).toBe(refused);
        // a pass/fail item is never given points, and an answer has only its own parts
        expect(
            validateForm(fields, { inspection: { items: { ...all('pass'), fog: { result: 'pass', points: 3 } } } })
                .inspection
        ).toBe(refused);
        expect(
            validateForm(fields, { inspection: { items: { ...all('pass'), fog: { result: 'pass', by: 'x' } } } })
                .inspection
        ).toBe(refused);
        expect(
            validateForm(fields, {
                inspection: { items: { ...all('pass'), fog: { result: 'pass', remark: 'x'.repeat(501) } } }
            }).inspection
        ).toBe(refused);
        expect(validateForm(fields, { inspection: 'passed' }).inspection).toBe(refused);
        expect(validateForm(fields, { inspection: { items: [] } }).inspection).toBe(refused);
    });

    it('keeps the outcome the server works out, never the one sent: a "passed" sent with a failed item is stored as failed', () => {
        const fields = bolo();
        const sent = {
            inspection: {
                items: { ...all('pass'), head: { result: 'fail', remark: '  one lamp out  ' } },
                outcome: { total: 4, max: 4, failed: [], criticalFailed: [], passed: true }
            }
        };
        const stored = submittedValues(fields, sent) as {
            inspection: { items: Record<string, unknown>; outcome: unknown };
        };
        expect(stored.inspection.outcome).toEqual({
            total: 3,
            max: 4,
            failed: ['head'],
            criticalFailed: [],
            passed: false
        });
        expect(stored.inspection.items.head).toEqual({ result: 'fail', remark: 'one lamp out' });
        // the same when a request change recomputes what is derived
        expect((derivedValues(fields, sent) as typeof stored).inspection.outcome).toMatchObject({ passed: false });
        // nothing answered stays nothing
        expect(settledValues(fields, { inspection: { items: {} } })).toEqual({ inspection: { items: {} } });
    });

    it('checks its answers even when the field is not validated: an effect or a report reads them', () => {
        const f = first(doc({ ...BOLO, behavior: {} }));
        expect(f?.validated).toBe(false);
        expect(shapeError(f, { items: { wheels: { result: 'pass' } } }, 'en')).toBe("Check the checklist's answers");
        expect(shapeError(f, { items: { service: { result: 'pass' } } }, 'en')).toBeUndefined();
    });

    it('reads its texts in the language asked, and lists them for the translation table', () => {
        const en = first(readDocument({ fields: [BOLO] }, { language: 'en' }).fields);
        const am = first(readDocument({ fields: [BOLO] }, { language: 'am' }).fields);
        expect(checklistOf(en)?.sections[0]?.items.map((i) => i.text)).toEqual(['Service brake', 'Parking brake']);
        expect(checklistOf(am)?.sections[0]?.title).toBe('ፍሬን');
        const texts = fieldTexts(BOLO).filter((x) => x.kind === 'section' || x.kind === 'item');
        expect(texts.map((x) => [x.path, x.kind, x.ref])).toEqual([
            ['props.sections.0.title', 'section', '1'],
            ['props.sections.0.items.0.text', 'item', '1.1'],
            ['props.sections.0.items.1.text', 'item', '1.2'],
            ['props.sections.1.title', 'section', '2'],
            ['props.sections.1.items.0.text', 'item', '2.1'],
            ['props.sections.1.items.1.text', 'item', '2.2']
        ]);
    });

    it('prints its outcome and the items that failed', () => {
        const f = first(bolo());
        const value = { items: { ...all('pass'), parking: { result: 'fail' } } };
        expect(printValueText(f, value, { language: 'en' })).toBe('Failed: 3 of 4\nFailed items: 1.2');
        expect(printValueText(f, { items: all('pass') }, { language: 'en' })).toBe('Passed: 4 of 4');
        expect(printValueText(f, { items: {} }, { language: 'en' })).toBe('—');
    });
});

describe('a checklist (points)', () => {
    const answers = (mirrors: number, signals: number, stop: number) => ({
        mirrors: { points: mirrors },
        signals: { points: signals },
        stop: { points: stop, ...(stop === 0 ? { remark: 'Rolled over the line' } : {}) }
    });

    it('passes on the pass mark with no critical item left without points', () => {
        const f = first(exam());
        const def = checklistOf(f);
        if (!def) throw new Error('no checklist');
        expect(checklistOutcome(def, answers(5, 5, 10))).toMatchObject({ total: 20, max: 20, passed: true });
        expect(checklistOutcome(def, answers(5, 0, 10))).toMatchObject({
            total: 15,
            failed: ['signals'],
            passed: true
        });
        expect(checklistOutcome(def, answers(0, 0, 10))).toMatchObject({ total: 10, passed: false });
        // full marks elsewhere do not make up for a critical item with none
        expect(checklistOutcome({ ...def, passMark: 10 }, answers(5, 5, 0))).toMatchObject({
            total: 10,
            criticalFailed: ['stop'],
            passed: false
        });
    });

    it('refuses points above the item\'s own, a fraction, a pass or fail, "does not apply" where it is not allowed, and a failed item without a remark', () => {
        const fields = exam();
        const refused = "Check the checklist's answers";
        expect(validateForm(fields, { exam: { items: answers(5, 5, 10) } })).toEqual({});
        expect(validateForm(fields, { exam: { items: answers(6, 5, 10) } }).exam).toBe(refused);
        expect(validateForm(fields, { exam: { items: { ...answers(5, 5, 10), mirrors: { points: 2.5 } } } }).exam).toBe(
            refused
        );
        expect(validateForm(fields, { exam: { items: { ...answers(5, 5, 10), mirrors: { points: -1 } } } }).exam).toBe(
            refused
        );
        expect(
            validateForm(fields, { exam: { items: { ...answers(5, 5, 10), mirrors: { result: 'pass' } } } }).exam
        ).toBe(refused);
        expect(
            validateForm(fields, { exam: { items: { ...answers(5, 5, 10), mirrors: { result: 'na' } } } }).exam
        ).toBe('Every item applies here: answer each one');
        expect(validateForm(fields, { exam: { items: { ...answers(5, 5, 10), signals: { points: 0 } } } }).exam).toBe(
            'Give a remark for each failed item: 1.2'
        );
    });

    it('is a checklist the form may hold only when its definition is one', () => {
        const at = (props: Record<string, unknown>) =>
            checkDocument({ fields: [{ ...EXAM, props: { ...EXAM.props, ...props } }] }).map((p) => p.path);
        expect(at({})).toEqual([]);
        expect(at({ passMark: 21 })).toEqual(['fields[0].props.passMark']);
        expect(
            at({
                sections: [
                    {
                        key: 'a',
                        items: [
                            { key: 'x', text: 'X', points: 10 },
                            { key: 'x', text: 'Y', points: 10 }
                        ]
                    }
                ]
            })
        ).toEqual(['fields[0].props.sections[0].items[1].key']);
        expect(at({ passMark: 0, sections: [{ key: 'a', items: [{ key: 'x', text: 'X' }] }] })).toEqual([
            'fields[0].props.sections[0].items[0].points'
        ]);
        expect(at({ passMark: 0, sections: [] })).toEqual(['fields[0].props.sections']);
        expect(at({ sections: [{ key: '1a', items: [{ key: 'x', text: 'X', points: 20 }] }] })).toEqual([
            'fields[0].props.sections[0].key'
        ]);
    });

    it('gives an effect its answers with the outcome, and refuses one without an outcome', () => {
        const stored = submittedValues(exam(), { exam: { items: answers(5, 5, 10) } });
        expect(contractInput({ exam: { kind: 'checklist' } }, stored).input.exam).toMatchObject({
            outcome: { total: 20, passed: true }
        });
        expect(contractInput({ exam: { kind: 'checklist' } }, { exam: { items: answers(5, 5, 10) } }).invalid).toEqual([
            'exam'
        ]);
    });
});

describe('a signature and a photo', () => {
    const image = (name: string, type = 'image/png') => ({
        file_id: '0199f0a0-d000-7000-8000-000000000001',
        name,
        size: 2048,
        type
    });
    const fields = doc(
        { id: 'signed', type: 'Signature', behavior: { validation: V }, props: { required: true } },
        { id: 'face', type: 'Photo', behavior: { validation: V }, props: { crop: 'face' } }
    );

    it('are file answers of one image each', () => {
        expect(fields.map((f) => [valueKindOf(f), isFileField(f)])).toEqual([
            ['files', true],
            ['files', true]
        ]);
        expect(validateForm(fields, { signed: [image('sig.png')], face: [image('face.jpg', 'image/jpeg')] })).toEqual(
            {}
        );
        expect(validateForm(fields, { signed: [] }).signed).toBe('This field is required');
        expect(validateForm(fields, { signed: [image('a.png'), image('b.png')] }).signed).toBe(
            'Only one image can be kept here'
        );
        expect(validateForm(fields, { signed: [image('sig.pdf', 'application/pdf')] }).signed).toBe(
            'Invalid file type'
        );
        expect(validateForm(fields, { signed: [image('sig.png')], face: [{ name: 'x' }] }).face).toBe('Invalid file');
    });

    it('start empty and print the file names', () => {
        expect(initialValues(fields)).toMatchObject({ signed: [], face: [] });
        expect(printValueText(nth(fields, 0), [image('sig.png')], { language: 'en' })).toBe('sig.png');
    });
});

describe('a place', () => {
    const fields = doc(
        { id: 'at', type: 'GeoPoint', behavior: { validation: V }, props: { required: true } },
        { id: 'precise', type: 'GeoPoint', behavior: { validation: V }, props: { maxAccuracy: 50 } }
    );

    it('is a latitude and longitude on the earth, with how sure the device was', () => {
        expect(valueKindOf(nth(fields, 0))).toBe('geopoint');
        expect(validateForm(fields, { at: { lat: 6.8476, lng: 37.7524 } })).toEqual({});
        expect(validateForm(fields, {}).at).toBe('This field is required');
        const invalid = 'Enter a place with its latitude and longitude';
        expect(validateForm(fields, { at: { lat: 91, lng: 37 } }).at).toBe(invalid);
        expect(validateForm(fields, { at: { lat: '6.8', lng: 37 } }).at).toBe(invalid);
        expect(validateForm(fields, { at: { lat: 6.8, lng: 37, by: 'me' } }).at).toBe(invalid);
        expect(validateForm(fields, { at: [6.8, 37] }).at).toBe(invalid);
    });

    it('asks for a fix at least as exact as the field wants: a place typed in has no accuracy and is not taken there', () => {
        const at = { lat: 6.8476, lng: 37.7524 };
        expect(validateForm(fields, { at, precise: { ...at, accuracy: 12 } })).toEqual({});
        expect(validateForm(fields, { at, precise: { ...at, accuracy: 80 } }).precise).toBe(
            'The location is not exact enough: it must be within 50 m'
        );
        expect(validateForm(fields, { at, precise: at }).precise).toBe(
            'The location is not exact enough: it must be within 50 m'
        );
    });

    it('prints its coordinates, and is given to an effect as it is', () => {
        expect(printValueText(nth(fields, 0), { lat: 6.8476, lng: 37.7524, accuracy: 9.6 }, { language: 'en' })).toBe(
            '6.847600, 37.752400 (within 10 m)'
        );
        expect(contractInput({ at: { kind: 'geopoint' } }, { at: { lat: 6.8, lng: 37.7 } }).input.at).toEqual({
            lat: 6.8,
            lng: 37.7
        });
        expect(contractInput({ at: { kind: 'geopoint' } }, { at: { lat: 'x', lng: 37.7 } }).invalid).toEqual(['at']);
    });
});

describe('the review of 1.13a: what a checklist value can never smuggle in', () => {
    const optional = { ...BOLO, props: { ...BOLO.props, required: false } };

    it('keeps no outcome a browser sent with nothing answered, and refuses anything beside the answers', () => {
        const fields = doc(optional);
        const forged = { items: {}, outcome: { total: 4, max: 4, failed: [], criticalFailed: [], passed: true } };
        expect(submittedValues(fields, { inspection: forged })).toEqual({ inspection: { items: {} } });
        expect(validateForm(fields, { inspection: { ...forged, verdict: 'passed' } }).inspection).toBe(
            "Check the checklist's answers"
        );
        // a remark-only answer to an item the sheet does not have is refused, not kept
        expect(validateForm(fields, { inspection: { items: { wipers: { remark: 'x' } } } }).inspection).toBe(
            "Check the checklist's answers"
        );
        expect(validateForm(fields, { inspection: { items: { fog: { remark: 'x'.repeat(501) } } } }).inspection).toBe(
            "Check the checklist's answers"
        );
    });

    it('refuses an item the sheet does not have after the server settles it, rather than dropping it', () => {
        const fields = bolo();
        const settled = submittedValues(fields, {
            inspection: { items: { ...all('pass'), wipers: { result: 'pass' } } }
        });
        expect(validateForm(fields, settled).inspection).toBe("Check the checklist's answers");
    });

    it('never lets a critical item, or a whole sheet, pass by not applying', () => {
        const critical = {
            ...BOLO,
            props: {
                ...BOLO.props,
                sections: [
                    {
                        key: 'brakes',
                        items: [
                            { key: 'service', text: 'Service brake', critical: true },
                            { key: 'parking', text: 'Parking brake' }
                        ]
                    }
                ]
            }
        };
        const fields = doc(critical);
        expect(
            validateForm(fields, { inspection: { items: { service: { result: 'na' }, parking: { result: 'pass' } } } })
                .inspection
        ).toBe('A critical item always applies: answer 1.1');
        const def = checklistOf(first(bolo()));
        if (!def) throw new Error('no checklist');
        expect(checklistOutcome(def, all('na'))).toMatchObject({ total: 0, max: 0, passed: false });
    });

    it('reads only answers the value holds itself, whatever an item is called', () => {
        const odd = {
            ...BOLO,
            props: {
                ...BOLO.props,
                sections: [
                    {
                        key: 's',
                        items: [
                            { key: 'constructor', text: 'Odd' },
                            { key: 'toString', text: 'Odder' }
                        ]
                    }
                ]
            }
        };
        const fields = doc(odd);
        expect(validateForm(fields, { inspection: { items: { constructor: { result: 'pass' } } } }).inspection).toBe(
            'Answer every item: 1.2 not answered'
        );
        const def = checklistOf(first(fields));
        if (!def) throw new Error('no checklist');
        expect(checklistOutcome(def, {})).toMatchObject({ total: 0, max: 2, passed: null });
    });

    it('refuses a place field whose accuracy no fix could meet', () => {
        const at = (maxAccuracy: unknown) =>
            checkDocument({ fields: [{ id: 'at', type: 'GeoPoint', props: { maxAccuracy } }] }).map((p) => p.path);
        expect(at(20)).toEqual([]);
        expect(at(0)).toEqual(['fields[0].props.maxAccuracy']);
        expect(at(-5)).toEqual(['fields[0].props.maxAccuracy']);
    });
});
