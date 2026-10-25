/**
 * What can be asked of a form's submissions (task 0.16b; ported from the legacy submission_fields.py): the queryable
 * fields and the part each plays in a view, from the engine's own reading of the form. One place maps a field type to a
 * query kind; the view schema the data viewer reads and the query compiler's allow-list both come from here.
 *
 * Only top-level value fields are queryable: a field inside a repeatable section has one value per row. The caller's
 * fields come from `fieldsFor` (a field restricted to other roles is not there, so it can be neither filtered nor
 * grouped by: either would reveal its values).
 */
import { holdsValue, scopeFields, valueKindOf, type EngineField } from '@itrms/form-engine/core';

export type Kind =
    'text' | 'choice' | 'multi' | 'number' | 'date' | 'datetime' | 'boolean' | 'files' | 'rows' | 'person' | 'unit';

export const OPS_BY_KIND = {
    text: ['contains', 'ncontains', 'eq', 'ne', 'starts', 'in', 'nin', 'empty', 'notempty'],
    choice: ['eq', 'ne', 'in', 'nin', 'contains', 'empty', 'notempty'],
    multi: ['has', 'hasany', 'empty', 'notempty'],
    number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notempty'],
    date: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notempty'],
    datetime: ['eq', 'gt', 'gte', 'lt', 'lte', 'between', 'empty', 'notempty'],
    boolean: ['eq', 'empty', 'notempty'],
    files: ['empty', 'notempty'],
    rows: ['empty', 'notempty'],
    person: ['eq', 'in', 'nin', 'empty', 'notempty'],
    unit: ['eq', 'in', 'nin']
} as const satisfies Record<Kind, readonly string[]>;

export const SORTABLE = new Set<Kind>(['text', 'choice', 'number', 'date', 'datetime', 'boolean', 'person', 'unit']);
export const GROUPABLE = new Set<Kind>(['text', 'choice', 'boolean', 'date', 'datetime', 'person', 'unit']);
export const AGGREGATABLE = new Set<Kind>(['number']);
export const FACETABLE = new Set<Kind>(['text', 'choice', 'boolean', 'person', 'unit']);
export const SEARCHABLE = new Set<Kind>(['text', 'choice']);
/** Kinds whose values the value table holds (ADR-0035). */
export const INDEXABLE = new Set<Kind>(['text', 'choice', 'multi', 'number', 'date', 'datetime', 'boolean']);

/** A key a query may name: what reaches SQL is always a bound parameter, but a key is also shown and logged. */
export const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** The longest text value the value table holds (a longer one is compared on the answers). */
export const MAX_INDEXED_TEXT = 500;

const STAGE_MAX_OPTIONS = 12;

export function kindOf(f: EngineField): Kind | null {
    // the engine's one map of kit types to the kinds of values they hold (core/kinds.ts); a password is never queried,
    // a range is two numbers (no single value to filter), an Ethiopian date is a day like any other
    if (f.type === 'Password') return null;
    const kind = valueKindOf(f);
    if (kind === 'ethdate') return 'date';
    if (kind === 'range') return null;
    return kind;
}

export interface ViewField {
    key: string;
    label: string;
    kind: Kind;
    type: string;
    options: { value: unknown; label: string }[];
    /** its options come from a data source */
    bound: boolean;
    required: boolean;
    currency: string | null;
    /** marked filterable by the author (its values are indexed once `indexed`) */
    filterable: boolean;
}

/** The top-level value fields of a form the caller may see, with their query kind. */
export function valueFields(fields: EngineField[]): ViewField[] {
    const out: ViewField[] = [];
    for (const f of scopeFields(fields, null)) {
        if (!holdsValue(f) || !KEY.test(f.id)) continue;
        const kind = kindOf(f);
        if (!kind) continue;
        out.push({
            key: f.id,
            label: f.label || f.id,
            kind,
            type: f.type,
            options:
                kind === 'choice' || kind === 'multi'
                    ? f.options.filter((o) => !o.items?.length).map((o) => ({ value: o.value, label: o.label }))
                    : [],
            bound: Boolean(f.optionsBinding),
            required: f.rules.required,
            currency: f.props.mode === 'currency' && typeof f.props.currency === 'string' ? f.props.currency : null,
            filterable: f.filterable && INDEXABLE.has(kind) && !f.visibleToRoles?.length
        });
    }
    return out;
}

/** The keys a version marks filterable (and the value table may hold): what the worker fills and a submission writes. */
export const filterableKeys = (fields: EngineField[]): string[] => [...filterableKinds(fields).keys()];

/**
 * The filterable keys of a version with the kind each is compared as. Pass the fields nobody is restricted from
 * (`fieldsFor(document, [])`): a field restricted to some roles, or inside a restricted container, is never copied
 * into the value table.
 */
export const filterableKinds = (fields: EngineField[]): Map<string, Kind> =>
    new Map(
        valueFields(fields)
            .filter((f) => f.filterable)
            .map((f) => [f.key, f.kind])
    );

/** Most choices one multiple-choice answer of a filterable field may hold (one value row each). */
export const MAX_INDEXED_CHOICES = 200;

/** Built-in columns every form's submissions have; a form's own field can never shadow them. */
export const BUILTINS: readonly { key: string; kind: Kind; label: string }[] = [
    { key: 'createdAt', kind: 'datetime', label: 'Submitted' },
    { key: 'submittedBy', kind: 'person', label: 'Submitted by' },
    { key: 'handlingUnit', kind: 'unit', label: 'Office' }
];
export const BUILTIN_KEYS = new Set(BUILTINS.map((b) => b.key));

/** Which field plays which part in a view; a view mode is offered only when the parts it needs exist. */
export function rolesOf(fields: ViewField[]) {
    const text = fields.filter((f) => f.kind === 'text');
    const stage = fields.find(
        (f) => f.kind === 'choice' && f.options.length >= 2 && f.options.length <= STAGE_MAX_OPTIONS
    );
    const dates = fields.filter((f) => f.kind === 'date' || f.kind === 'datetime');
    const title = text.find((f) => f.required) ?? text[0];
    const subtitle = fields.find((f) => f.key !== title?.key && (f.kind === 'text' || f.kind === 'choice'));
    const measures = fields
        .filter((f) => f.kind === 'number')
        .sort((a, b) => Number(Boolean(b.currency)) - Number(Boolean(a.currency)));
    return {
        title: title?.key ?? null,
        subtitle: subtitle?.key ?? null,
        // the office is always there to group a board by
        stage: stage?.key ?? 'handlingUnit',
        date: dates[0]?.key ?? 'createdAt',
        dateEnd: dates[1]?.key ?? null,
        measures: measures.map((f) => f.key),
        people: ['submittedBy'],
        files: fields.filter((f) => f.kind === 'files').map((f) => f.key),
        rows: fields.filter((f) => f.kind === 'rows').map((f) => f.key)
    };
}

export interface ViewSchemaField {
    key: string;
    label: string;
    kind: Kind;
    builtin: boolean;
    ops: readonly string[];
    sortable: boolean;
    groupable: boolean;
    aggregatable: boolean;
    options: { value: unknown; label: string }[];
    currency: string | null;
    type: string | null;
    filterable: boolean;
    /** its filters run on the value table's indexes */
    indexed: boolean;
}

/** The view schema: the fields with what each supports, the parts they play, and the view modes that make sense. */
export function describe(
    fields: ViewField[],
    indexedKeys: readonly string[],
    /** the built-ins' choices (the offices and the people in the caller's submissions) */
    builtinOptions: Readonly<Record<string, { value: string; label: string }[]>> = {},
    /** the built-ins' labels in the caller's language (English by default) */
    builtinLabel: (key: string) => string = (k) => BUILTINS.find((b) => b.key === k)?.label ?? k
) {
    const described: ViewSchemaField[] = [
        ...BUILTINS.map((b) => ({
            key: b.key,
            label: builtinLabel(b.key),
            kind: b.kind,
            builtin: true,
            ops: OPS_BY_KIND[b.kind],
            sortable: SORTABLE.has(b.kind),
            groupable: GROUPABLE.has(b.kind),
            aggregatable: false,
            options: builtinOptions[b.key] ?? [],
            currency: null,
            type: null,
            filterable: true,
            indexed: true
        })),
        ...fields
            .filter((f) => !BUILTIN_KEYS.has(f.key))
            .map((f) => ({
                key: f.key,
                label: f.label,
                kind: f.kind,
                builtin: false,
                ops: OPS_BY_KIND[f.kind],
                sortable: SORTABLE.has(f.kind),
                groupable: GROUPABLE.has(f.kind),
                aggregatable: AGGREGATABLE.has(f.kind),
                options: f.options,
                currency: f.currency,
                type: f.type,
                filterable: f.filterable,
                indexed: f.filterable && indexedKeys.includes(f.key)
            }))
    ];
    const roles = rolesOf(fields);
    // table, cards, board, calendar (the submission date at least), pivot and dashboard work for any form
    return { fields: described, roles, modes: ['table', 'cards', 'board', 'calendar', 'pivot', 'dashboard'] };
}
