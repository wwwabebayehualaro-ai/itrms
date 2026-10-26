// @vitest-environment node
// Task 0.17c: the printed form renders on the server (no DOM, no host) as plain markup. Generated fixture, no real people.
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { PrintForm } from './PrintForm';

const L = (am: string, en: string) => ({ am, en });
const F = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    category: 'Input',
    label: L(`${id}-am`, `${id}-en`),
    props: {},
    ...extra
});
const C = (id: string, type: string, props: Record<string, unknown>) => F(id, type, { category: 'Layout', props });
const inside = (parentId: string, f: Record<string, unknown>) => ({ ...f, parentId });

const form = {
    fields: [
        C('personal', 'Panel', { header: L('የግል', 'Personal') }),
        inside('personal', F('name', 'InputText', { props: { span: 6 } })),
        inside('personal', F('note', 'InputText')),
        inside('personal', F('born', 'EthDate')),
        inside('personal', F('issued', 'Calendar')),
        inside('personal', F('kind', 'Dropdown', { props: { options: [{ label: L('አንድ', 'One'), value: 1 }] } })),
        inside('personal', F('married', 'Checkbox')),
        inside('personal', F('mode', 'Dropdown', { props: { options: [{ label: 'On', value: 'on' }] } })),
        inside('personal', {
            ...F('privateNote', 'InputText'),
            behavior: { visibilityConditions: [{ field: 'mode', operator: 'eq', value: 'off' }] }
        }),
        C('items', 'FormArray', { itemLabel: L('ዕቃ', 'Thing'), printBreakBefore: true }),
        inside('items', F('what', 'InputText')),
        inside('items', F('qty', 'InputNumber'))
    ]
};

const values = {
    name: 'Abebe Sample',
    note: '<script>alert(1)</script>',
    born: '2000-09-11',
    issued: '2026-10-19',
    kind: 1,
    married: true,
    mode: 'on',
    privateNote: 'must not print',
    items: [
        { what: 'small', qty: 2 },
        { what: 'big', qty: 10 }
    ]
};

describe('PrintForm (task 0.17c)', () => {
    for (const language of ['am', 'en'] as const) {
        it(`renders the form in ${language} as plain markup`, async () => {
            const html = renderToStaticMarkup(
                <PrintForm form={form} values={values} language={language} title="Sample form" />
            );
            await expect(html).toMatchFileSnapshot(`./__snapshots__/print.${language}.html`);
            for (const tag of ['<input', '<button', '<select', '<textarea', ' style=']) expect(html).not.toContain(tag);
            expect(html).toContain('&lt;script&gt;');
            expect(html).not.toContain('<script>');
            expect(html).toContain('<thead>');
            expect(html).toContain('data-break-before');
            expect(html).toContain(`lang="${language}"`);
            expect(html).not.toContain('must not print');
        });
    }

    it('words the same answers in the chosen language', () => {
        const am = renderToStaticMarkup(<PrintForm form={form} values={values} language="am" />);
        const en = renderToStaticMarkup(<PrintForm form={form} values={values} language="en" />);
        expect(am).toContain('የግል');
        expect(en).toContain('Personal');
        expect(en).toContain('One');
        expect(en).toContain('<td>2</td>');
    });
});
