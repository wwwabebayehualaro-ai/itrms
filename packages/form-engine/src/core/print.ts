/**
 * A form's answers as a printable tree (task 0.17c): what the printed form, the case summary and the exports show.
 * UI-free and pure, so it runs in the API (the PDF worker) and in the browser. Hidden fields, fields the reader's roles
 * do not see, display fields and values the form does not know are left out; every value is already worded in one
 * language, with dates Ethiopian. The renderers lay the nodes out; they decide nothing about what shows.
 */
import type { Scope } from './conditions';
import { addisDayTime, ethiopianDateText } from './dates';
import { numberFormatOf } from './format';
import { valueKindOf, type ValueKind } from './kinds';
import { containerTitle, isFormArray, readDocument, type EngineField, type FieldOption } from './model';
import { holdsValue, isVisibleIn, knownValues, pruneHidden, scopeFields } from './values';

export interface PrintWords {
    yes: string;
    no: string;
    /** what a blank answer prints */
    blank: string;
    noRows: string;
    rowNumber: string;
    item: string;
}

export const PRINT_WORDS: PrintWords = {
    yes: 'Yes',
    no: 'No',
    blank: '—',
    noRows: 'No rows',
    rowNumber: 'No.',
    item: 'Item'
};

export type PrintNode =
    | {
          kind: 'value';
          id: string;
          label: string;
          text: string;
          valueKind: ValueKind;
          /** width in a 12-column grid */
          span: number;
          multiline: boolean;
      }
    | {
          kind: 'group';
          id: string;
          type: string;
          title: string;
          subtitle?: string;
          footer?: string;
          breakBefore: boolean;
          children: PrintNode[];
      }
    | { kind: 'divider'; id: string; text?: string }
    | {
          kind: 'rows';
          id: string;
          title: string;
          layout: 'table' | 'list';
          breakBefore: boolean;
          columns: { id: string; label: string }[];
          rows: { title: string; cells: string[]; children: PrintNode[] }[];
          empty?: string;
      };

export interface PrintOptions {
    /** the language of the form's texts and of the dates */
    language: string;
    /** what rules may read besides the form (`user`, ...) */
    scope?: Scope;
    /** the reader's roles: fields limited to other roles are left out (all shown when not given) */
    roles?: readonly string[];
    words?: Partial<PrintWords>;
    /** leave out the answers nobody gave (they print `words.blank` otherwise) */
    omitBlank?: boolean;
    /** add the Gregorian day to an Ethiopian date */
    gregorian?: boolean;
    /** the most columns a repeatable section prints as a table (default 6) */
    maxTableColumns?: number;
}

export interface PrintDocument {
    language: string;
    words: PrintWords;
    nodes: PrintNode[];
}

const PASSWORD_MASK = '••••••';
const GROUPS = new Set(['Panel', 'Fieldset', 'Card', 'FormSection']);
const MAX_TABLE_COLUMNS = 6;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const numOf = (v: unknown) =>
    v === undefined || v === null || v === '' || !Number.isFinite(Number(v)) ? undefined : Number(v);

function isBlankValue(f: Pick<EngineField, 'type'>, v: unknown): boolean {
    if (v === undefined || v === null || v === '') return true;
    if (Array.isArray(v)) return v.length === 0;
    // an untouched rating holds 0
    return f.type === 'Rating' && v === 0;
}

function flatten(options: FieldOption[]): FieldOption[] {
    return options.flatMap((o) => [o, ...(o.items ? flatten(o.items) : [])]);
}

function choiceText(v: unknown, options: FieldOption[]): string {
    if (isRecord(v)) {
        const own =
            nonEmpty(v.label) ??
            (typeof v.value === 'string' || typeof v.value === 'number' ? String(v.value) : undefined);
        return options.find((o) => o.value === v.value)?.label ?? own ?? '';
    }
    const match = options.find((o) => o.value === v) ?? options.find((o) => String(o.value) === String(v));
    return match ? match.label : String(v);
}

function dayText(v: unknown, language: string): string {
    const text = ethiopianDateText(v, { language, long: true });
    return text ? `${text} (${String(v).slice(0, 10)})` : String(v);
}

/** The words a value prints as (the blank word when there is none). */
export function printValueText(
    field: EngineField,
    value: unknown,
    opts: Pick<PrintOptions, 'language' | 'words' | 'gregorian'>
): string {
    const words = { ...PRINT_WORDS, ...opts.words };
    const kind = valueKindOf(field);
    if (!kind || kind === 'rows' || isBlankValue(field, value)) return words.blank;
    const { language } = opts;
    const props = field.props;
    const number = (n: unknown) => {
        const x = numOf(n);
        if (x === undefined) return String(n);
        return `${nonEmpty(props.prefix) ?? ''}${numberFormatOf(props, 'en-US').format(x)}${nonEmpty(props.suffix) ?? ''}`;
    };
    switch (kind) {
        case 'text':
            return field.type === 'Password' ? PASSWORD_MASK : String(value);
        case 'number':
            return field.type === 'Rating'
                ? `${numOf(value) ?? String(value)}/${numOf(props.stars) ?? 5}`
                : number(value);
        case 'range':
            return Array.isArray(value) && value.length === 2
                ? `${number(value[0])} – ${number(value[1])}`
                : number(value);
        case 'boolean':
            return value === true ? words.yes : words.no;
        case 'choice':
            return choiceText(value, flatten(field.options));
        case 'multi': {
            const options = flatten(field.options);
            return (Array.isArray(value) ? value : [value]).map((v) => choiceText(v, options)).join(', ');
        }
        case 'ethdate': {
            const text = ethiopianDateText(value, { language, long: true });
            return text ? (opts.gregorian ? `${text} (${String(value)})` : text) : String(value);
        }
        case 'date':
            return (Array.isArray(value) ? value : [value]).map((d) => dayText(d, language)).join(' – ');
        case 'datetime': {
            const at = addisDayTime(value);
            if (!at) return String(value);
            const text = ethiopianDateText(at.day, { language, long: true });
            return text ? `${text} ${at.time}` : String(value);
        }
        case 'files':
            return (Array.isArray(value) ? value : [])
                .map((f) => (isRecord(f) ? (nonEmpty(f.name) ?? nonEmpty(f.filename) ?? '') : ''))
                .filter(Boolean)
                .join('\n');
    }
}

/**
 * The printable tree of a form with its answers. `form` is a stored `form_config` (any version), `values` the answers
 * keyed by field id. Nothing here throws on odd data: what is not a value of its field's kind prints as it is.
 */
export function printModel(form: unknown, values: Record<string, unknown>, opts: PrintOptions): PrintDocument {
    const { fields } = readDocument(form, { language: opts.language });
    const words: PrintWords = { ...PRINT_WORDS, ...opts.words };
    const scope = opts.scope ?? {};
    const maxColumns = opts.maxTableColumns ?? MAX_TABLE_COLUMNS;
    const byId = new Map(fields.map((f) => [f.id, f]));
    const root = pruneHidden(fields, knownValues(fields, values), scope);
    const ctx = { ...scope, root };
    const printOpts = { language: opts.language, words, gregorian: opts.gregorian };

    const allowed = (f: EngineField) =>
        !opts.roles || !f.visibleToRoles?.length || f.visibleToRoles.some((r) => opts.roles?.includes(r));
    const shown = (f: EngineField, current: Record<string, unknown>, sectionId: string | null) =>
        allowed(f) && isVisibleIn(f, byId, current, ctx, sectionId);
    // the repeatable section a field sits in (its rules' scope ends there), null at the top level
    const sectionOf = (f: EngineField): string | null => {
        for (
            let p = f.parentId ? byId.get(f.parentId) : undefined;
            p;
            p = p.parentId ? byId.get(p.parentId) : undefined
        )
            if (isFormArray(p)) return p.id;
        return null;
    };

    const walk = (parentId: string | null, current: Record<string, unknown>): PrintNode[] => {
        const out: PrintNode[] = [];
        for (const f of fields) {
            if (f.parentId !== parentId || !shown(f, current, sectionOf(f))) continue;
            const node = nodeOf(f, current);
            if (node) out.push(node);
        }
        return out;
    };

    const nodeOf = (f: EngineField, current: Record<string, unknown>): PrintNode | undefined => {
        const breakBefore = f.props.printBreakBefore === true;
        if (GROUPS.has(f.type)) {
            const children = walk(f.id, current);
            if (!children.length) return undefined;
            return {
                kind: 'group',
                id: f.id,
                type: f.type,
                title: containerTitle(f),
                subtitle: nonEmpty(
                    f.type === 'Card' ? f.props.subTitle : f.type === 'FormSection' ? f.props.description : undefined
                ),
                footer: f.type === 'Card' ? nonEmpty(f.props.footer) : undefined,
                breakBefore,
                children
            };
        }
        if (f.type === 'Divider') return { kind: 'divider', id: f.id, text: nonEmpty(f.props.content) };
        if (isFormArray(f)) return rowsOf(f, current, breakBefore);
        const kind = valueKindOf(f);
        if (!kind || !holdsValue(f)) return undefined;
        const raw = Object.hasOwn(current, f.id) ? current[f.id] : undefined;
        if (opts.omitBlank && isBlankValue(f, raw)) return undefined;
        const text = printValueText(f, raw, printOpts);
        return {
            kind: 'value',
            id: f.id,
            label: f.label,
            text,
            valueKind: kind,
            span: numOf(f.props.span) ?? 12,
            multiline: kind === 'text' ? f.type === 'InputTextarea' || text.includes('\n') : kind === 'files'
        };
    };

    const rowsOf = (f: EngineField, current: Record<string, unknown>, breakBefore: boolean): PrintNode => {
        const raw = Object.hasOwn(current, f.id) ? current[f.id] : undefined;
        const data = (Array.isArray(raw) ? raw : []).filter(isRecord);
        const members = scopeFields(fields, f.id).filter(holdsValue).filter(allowed);
        const layoutProp = f.props.printLayout;
        const table =
            layoutProp === 'table' ||
            (layoutProp !== 'rows' && !members.some(isFormArray) && members.length <= maxColumns);
        const itemLabel = nonEmpty(f.props.itemLabel) ?? words.item;
        const head = { kind: 'rows' as const, id: f.id, title: containerTitle(f), breakBefore };
        const empty = data.length ? undefined : (nonEmpty(f.props.emptyMessage) ?? words.noRows);
        if (!table)
            return {
                ...head,
                layout: 'list',
                columns: [],
                rows: data.map((row, i) => ({ title: `${itemLabel} ${i + 1}`, cells: [], children: walk(f.id, row) })),
                empty
            };
        // a nested section has no cell in a table
        const columns = members
            .filter((c) => !isFormArray(c))
            .filter((c) => !data.length || data.some((row) => shown(c, row, f.id)));
        return {
            ...head,
            layout: 'table',
            columns: columns.map((c) => ({ id: c.id, label: c.label })),
            rows: data.map((row, i) => ({
                title: String(i + 1),
                cells: columns.map((c) => {
                    if (!shown(c, row, f.id)) return '';
                    const v = Object.hasOwn(row, c.id) ? row[c.id] : undefined;
                    return opts.omitBlank && isBlankValue(c, v) ? '' : printValueText(c, v, printOpts);
                }),
                children: []
            })),
            empty
        };
    };

    return { language: opts.language, words, nodes: walk(null, root) };
}
