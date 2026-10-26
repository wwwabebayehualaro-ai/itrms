// @vitest-environment node
// Task 0.17c: the printable tree of a form and its answers (generated fixture, no real people).
import { describe, expect, it } from 'vitest';

import { addisDayTime, ethiopianDateText, printModel, PRINT_WORDS, type PrintNode } from './';

const L = (am: string, en: string) => ({ am, en });
const F = (id: string, type: string, extra: Record<string, unknown> = {}) => ({
    id,
    type,
    category: 'Input',
    label: L(`${id}-am`, `${id}-en`),
    props: {},
    ...extra
});
const C = (id: string, type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    F(id, type, { category: 'Layout', props, ...extra });
const inside = (parentId: string, f: Record<string, unknown>) => ({ ...f, parentId });
const when = (field: string, value: unknown) => ({
    behavior: { visibilityConditions: [{ field, operator: 'eq', value }] }
});

const form = {
    fields: [
        C('personal', 'Card', { title: L('የግል', 'Personal'), subTitle: 'Sub', footer: 'Foot', printBreakBefore: true }),
        inside('personal', F('name', 'InputText', { props: { span: 6 } })),
        inside('personal', F('notes', 'InputTextarea')),
        inside('personal', F('pin', 'Password')),
        inside('personal', F('married', 'Checkbox')),
        inside('personal', F('kind', 'Dropdown', { props: { options: [{ label: L('አንድ', 'One'), value: 1 }] } })),
        inside(
            'personal',
            F('tags', 'MultiSelect', {
                props: {
                    options: [
                        { label: L('ሀ', 'Alpha'), value: 'a', items: [{ label: L('ለ', 'Beta'), value: 'b' }] },
                        { label: L('ሐ', 'Gamma'), value: 'c' }
                    ]
                }
            })
        ),
        inside('personal', F('born', 'EthDate')),
        inside('personal', F('issued', 'Calendar')),
        inside('personal', F('seen', 'Calendar', { props: { showTime: true } })),
        inside('personal', F('docs', 'FileUpload')),
        inside('personal', F('fee', 'InputNumber', { props: { mode: 'currency', currency: 'ETB', locale: 'en-US' } })),
        inside('personal', F('stars', 'Rating', { props: { stars: 5 } })),
        inside('personal', F('band', 'Slider', { props: { range: true } })),
        inside('personal', F('chips', 'Chips')),
        inside('personal', F('mode', 'Dropdown', { props: { options: [{ label: 'On', value: 'on' }] } })),
        inside('personal', F('hidden', 'InputText', when('mode', 'off'))),
        inside('personal', F('cascade', 'InputText', when('hidden', 'x'))),
        inside('personal', F('staff', 'InputText', { visibleToRoles: ['clerk'] })),
        C('empty', 'Panel', { header: 'Empty' }),
        inside('empty', F('ghost', 'InputText', when('mode', 'off'))),
        C('div', 'Divider', { content: 'Part two' }),
        { ...C('table', 'DataTable', {}), category: 'Data' },
        C('items', 'FormArray', { itemLabel: L('ዕቃ', 'Thing'), printBreakBefore: false }),
        inside('items', F('what', 'InputText')),
        inside('items', F('qty', 'InputNumber')),
        inside('items', F('detail', 'InputText', when('what', 'big'))),
        C('wide', 'FormArray', { emptyMessage: L('ባዶ', 'Nothing here') }),
        ...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((c) => inside('wide', F(`w${c}`, 'InputText'))),
        C('forced', 'FormArray', { printLayout: 'rows' }),
        inside('forced', F('fx', 'InputText'))
    ]
};

const values = {
    name: 'Abebe Sample',
    notes: 'line one\nline two',
    pin: '4321',
    married: false,
    kind: 1,
    tags: ['b', 'c', 'zz'],
    born: '2000-09-11',
    issued: '2026-10-19',
    seen: '2026-10-19T22:30:00Z',
    docs: [{ name: 'a.pdf' }, { filename: 'b.png' }],
    fee: 12345.5,
    stars: 4,
    band: [10, 20],
    chips: ['x', 'y'],
    mode: 'on',
    hidden: 'x',
    cascade: 'shown?',
    staff: 'internal',
    ghost: 'g',
    items: [
        { what: 'small', qty: 2 },
        { what: 'big', qty: 1000, detail: 'extra' }
    ],
    wide: [],
    forced: [{ fx: 'one' }]
};

const print = (opts: Partial<Parameters<typeof printModel>[2]> = {}, v: Record<string, unknown> = values) =>
    printModel(form, v, { language: 'en', ...opts });

const flat = (nodes: PrintNode[]): PrintNode[] =>
    nodes.flatMap((n) => [n, ...(n.kind === 'group' ? flat(n.children) : [])]);
const find = (nodes: PrintNode[], id: string) => flat(nodes).find((n) => n.id === id);
const text = (nodes: PrintNode[], id: string) => {
    const n = find(nodes, id);
    return n?.kind === 'value' ? n.text : undefined;
};
const rows = (nodes: PrintNode[], id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (n?.kind !== 'rows') throw new Error(`no rows ${id}`);
    return n;
};

describe('printModel', () => {
    // with mode "on" the fields shown only for "off" are hidden, and the one shown by a hidden field's value goes too
    const { nodes } = print();

    it('leaves out hidden, cascade-hidden, display and emptied-group fields', () => {
        for (const id of ['hidden', 'cascade', 'ghost', 'empty', 'table']) expect(find(nodes, id), id).toBeUndefined();
        expect(find(nodes, 'name')).toBeDefined();
        const off = print({}, { ...values, mode: 'off', hidden: 'x', cascade: 'shown' }).nodes;
        for (const id of ['hidden', 'cascade', 'ghost']) expect(find(off, id), id).toBeDefined();
        expect(find(off, 'empty')).toBeDefined();
    });

    it('words labels and titles in each language', () => {
        expect(find(nodes, 'name')).toMatchObject({ label: 'name-en' });
        expect(find(print({ language: 'am' }).nodes, 'name')).toMatchObject({ label: 'name-am' });
        expect(find(nodes, 'personal')).toMatchObject({
            kind: 'group',
            title: 'Personal',
            subtitle: 'Sub',
            footer: 'Foot',
            breakBefore: true
        });
        expect(find(print({ language: 'am' }).nodes, 'personal')).toMatchObject({ title: 'የግል' });
    });

    it('prints values by kind', () => {
        expect(text(nodes, 'name')).toBe('Abebe Sample');
        expect(text(nodes, 'notes')).toBe('line one\nline two');
        expect(text(nodes, 'pin')).toBe('••••••');
        expect(text(nodes, 'married')).toBe('No');
        expect(text(nodes, 'kind')).toBe('One');
        expect(text(nodes, 'tags')).toBe('Beta, Gamma, zz');
        expect(text(nodes, 'fee')).toContain('12,345.5');
        expect(text(nodes, 'fee')).toContain('ETB');
        expect(text(nodes, 'stars')).toBe('4/5');
        expect(text(nodes, 'band')).toBe('10 – 20');
        expect(text(nodes, 'chips')).toBe('x, y');
        expect(text(nodes, 'docs')).toBe('a.pdf\nb.png');
        expect(text(nodes, 'staff')).toBe('internal');
        expect(find(nodes, 'name')).toMatchObject({ span: 6, valueKind: 'text', multiline: false });
        expect(find(nodes, 'notes')).toMatchObject({ multiline: true });
        expect(find(nodes, 'band')).toMatchObject({ span: 12 });
    });

    it('prints dates Ethiopian, with the Gregorian day where asked', () => {
        const long = (iso: string, language = 'en') => ethiopianDateText(iso, { language, long: true });
        expect(text(nodes, 'born')).toBe(long('2000-09-11'));
        expect(text(print({ gregorian: true }).nodes, 'born')).toBe(`${long('2000-09-11')} (2000-09-11)`);
        expect(text(nodes, 'issued')).toBe(`${long('2026-10-19')} (2026-10-19)`);
        expect(text(print({ language: 'am' }).nodes, 'born')).toBe(long('2000-09-11', 'am'));
    });

    it('prints a date and time on its Addis Ababa day', () => {
        expect(addisDayTime('2026-10-19T22:30:00Z')).toEqual({ day: '2026-10-20', time: '01:30' });
        expect(text(nodes, 'seen')).toBe(`${ethiopianDateText('2026-10-20', { language: 'en', long: true })} 01:30`);
    });

    it('words blanks and booleans, or omits blanks', () => {
        const some = print({ words: { blank: 'n/a', yes: 'Ja' } }, { married: true });
        expect(text(some.nodes, 'name')).toBe('n/a');
        expect(text(some.nodes, 'married')).toBe('Ja');
        expect(text(print({}, {}).nodes, 'name')).toBe(PRINT_WORDS.blank);
        const omitted = print({ omitBlank: true }, { name: 'x' });
        expect(find(omitted.nodes, 'notes')).toBeUndefined();
        expect(find(omitted.nodes, 'name')).toBeDefined();
    });

    it('prints a divider with its text', () => {
        expect(find(nodes, 'div')).toEqual({ kind: 'divider', id: 'div', text: 'Part two' });
    });

    it('prints a short section as a table, a hidden cell empty, a column hidden in every row dropped', () => {
        const items = rows(nodes, 'items');
        expect(items).toMatchObject({ layout: 'table', title: 'items-en', breakBefore: false });
        expect(items.columns.map((c) => c.id)).toEqual(['what', 'qty', 'detail']);
        expect(items.rows.map((r) => r.cells)).toEqual([
            ['small', '2', ''],
            ['big', '1,000', 'extra']
        ]);
        const small = rows(print({}, { items: [{ what: 'small', qty: 2 }] }).nodes, 'items');
        expect(small.columns.map((c) => c.id)).toEqual(['what', 'qty']);
    });

    it('prints a wide or forced section as a list, with its row titles', () => {
        const wide = rows(print({}, { wide: [{ wa: 'x' }] }).nodes, 'wide');
        expect(wide).toMatchObject({ layout: 'list', columns: [] });
        expect(wide.rows[0]?.title).toBe('Item 1');
        expect(wide.rows[0]?.children).toHaveLength(7);
        const forced = rows(nodes, 'forced');
        expect(forced.layout).toBe('list');
        expect(forced.rows[0]?.children).toMatchObject([{ id: 'fx', text: 'one' }]);
        const narrow = rows(print({ maxTableColumns: 2 }).nodes, 'items');
        expect(narrow.layout).toBe('list');
        expect(narrow.rows[0]?.title).toBe('Thing 1');
    });

    it('says so when a section has no rows', () => {
        expect(rows(nodes, 'wide').empty).toBe('Nothing here');
        expect(rows(print({ language: 'am' }).nodes, 'wide').empty).toBe('ባዶ');
        expect(rows(nodes, 'forced').empty).toBeUndefined();
        expect(rows(print({ words: { noRows: 'None' } }, {}).nodes, 'forced').empty).toBe('None');
    });

    it('drops the fields the reader roles do not see', () => {
        expect(find(print({ roles: ['citizen'] }).nodes, 'staff')).toBeUndefined();
        expect(find(print({ roles: ['clerk'] }).nodes, 'staff')).toBeDefined();
        expect(find(print({}).nodes, 'staff')).toBeDefined();
    });
});
