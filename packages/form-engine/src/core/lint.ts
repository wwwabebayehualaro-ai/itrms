/**
 * The form lint (task 0.18a): what is wrong with a stored form before it is published. Errors block a publication, warnings
 * are shown and do not (the missing am/en labels are a warning, docs/i18n-and-languages.md). Removed fields (and the fields
 * inside a removed container) are never a subject: they are out of the form. Key stability against the published version is
 * keys.ts; the messages are the catalogue's `form-engine.core.lint.<rule>`.
 */
import {
    FORM_FIELD_LIMIT,
    REQUIRED_TEXT_LANGUAGES,
    storedFieldsOf,
    textLanguageOf,
    type VisibilityCondition
} from '@itrms/schemas';

import { conditionReferences } from './conditions';
import { valueKindOf } from './kinds';
import type { EngineMessageKey, EngineValues } from './messages';
import { readDocument, type EngineField, type FieldOption } from './model';
import { extractReferences } from './runtime/expression';
import { formulaReferences } from './runtime/formula';
import { untranslatedTexts } from './text';
import { holdsValue, initialValueOf } from './values';

export type LintRule =
    | 'unknown-reference'
    | 'unreachable'
    | 'cycle'
    | 'duplicate-option'
    | 'too-many-fields'
    | 'data-source'
    | 'data-source-unlisted'
    | 'untranslated'
    | 'required-hideable'
    | 'unknown-option'
    | 'reads-removed'
    | 'unknown-role'
    | 'key-missing'
    | 'key-retyped'
    | 'key-moved'
    | 'unclassified';

export interface LintProblem {
    rule: LintRule;
    severity: 'error' | 'warning';
    /** The field it is about (its key), null for the form as a whole. */
    fieldId: string | null;
    /** Where, from the document's root: `fields[2].behavior.visibilityConditions` */
    path: string;
    message: EngineMessageKey;
    values?: EngineValues;
}

/** A request a form's data source may make: the method and the start of the path (no leading `/` or `api/`). */
export interface DataSourceAllowance {
    method: string;
    path: string;
}

export interface LintOptions {
    /** The most fields a form should have (default `FORM_FIELD_LIMIT`). */
    maxFields?: number;
    /** The requests data sources may make; undefined skips the allow-list check. */
    dataSources?: readonly DataSourceAllowance[];
    /** The roles that exist; undefined skips the role check. */
    roleKeys?: readonly string[];
    /** The languages every text needs (default Amharic and English). */
    required?: readonly string[];
}

const messageOf = (rule: LintRule): `form-engine.core.lint.${LintRule}` => `form-engine.core.lint.${rule}`;

const FORM_ROOTS = new Set(['form', 'row', 'root']);
const SCOPE_ROOTS = new Set(['data', 'user', 'route', 'variables']);

/** The field a reference reads: `age`, `form.age`, `row.qty`, `root.items[0].qty` → its key; null for `data.*`, `user.*` … */
function nameOf(ref: string): string | null {
    const parts = ref.split(/[.[]/);
    const root = parts[0] ?? '';
    if (SCOPE_ROOTS.has(root)) return null;
    if (FORM_ROOTS.has(root)) return parts[1] || null;
    return root || null;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
/** A value written in the rule, not a `{{binding}}` resolved at run time. */
const isLiteral = (v: unknown) => !(typeof v === 'string' && v.includes('{{'));
const written = (v: unknown) => JSON.stringify(v) ?? 'undefined';
const shown = (v: unknown) => (typeof v === 'string' ? v : written(v));

/** True when the condition fails for a field that has no value (a removed field never has one). */
function failsOnEmpty(c: VisibilityCondition): boolean {
    if (c.conditions?.length) return false;
    switch (c.operator) {
        case 'notEmpty':
            return true;
        case 'eq':
        case 'contains':
        case 'startsWith':
        case 'endsWith':
            return isLiteral(c.value) && !isBlank(c.value);
        case 'gt':
        case 'gte':
        case 'lt':
        case 'lte':
        case 'regex':
            return isLiteral(c.value);
        case 'in':
            return Array.isArray(c.value) && c.value.every((v) => isLiteral(v) && !isBlank(v));
        default:
            return false;
    }
}

/** The subject of a condition as written (`form.age` is `age`), '' when it has none. */
const subjectOf = (c: VisibilityCondition) => c.field.replace(/^form\./, '');

/** Whether a list of visibility conditions can never hold. */
function neverHolds(list: readonly VisibilityCondition[], isGone: (c: VisibilityCondition) => boolean): boolean {
    const logic = list[0]?.logic ?? 'and';
    if (list.length === 0 || logic === 'xor') return false;
    const dead = (c: VisibilityCondition) => isGone(c) && failsOnEmpty(c);
    if (logic === 'or') return list.every(dead);
    if (list.some(dead)) return true;
    const equals = new Map<string, string>();
    const nonBlankEquals = new Set<string>();
    const empties = new Set<string>();
    for (const c of list) {
        const subject = subjectOf(c);
        if (c.conditions?.length || !subject) continue;
        if (c.operator === 'eq' && isLiteral(c.value)) {
            const other = equals.get(subject);
            if (other !== undefined && other !== written(c.value)) return true;
            equals.set(subject, written(c.value));
            if (!isBlank(c.value)) nonBlankEquals.add(subject);
        } else if (c.operator === 'empty') empties.add(subject);
    }
    return [...nonBlankEquals].some((s) => empties.has(s));
}

function walkConditions(list: readonly VisibilityCondition[], fn: (c: VisibilityCondition) => void) {
    for (const c of list) {
        fn(c);
        if (c.conditions) walkConditions(c.conditions, fn);
    }
}

/** The values of raw static options, nested items flattened. */
function flatValues(raw: unknown, acc: unknown[] = []): unknown[] {
    if (!Array.isArray(raw)) return acc;
    for (const o of raw as unknown[]) {
        if (o && typeof o === 'object') {
            const option = o as { value?: unknown; items?: unknown };
            if (option.value !== undefined) acc.push(option.value);
            flatValues(option.items, acc);
        } else if (typeof o === 'string' || typeof o === 'number') acc.push(o);
    }
    return acc;
}

function optionValueKeys(options: readonly FieldOption[], acc = new Set<string>()): Set<string> {
    for (const o of options) {
        acc.add(written(o.value));
        if (o.items) optionValueKeys(o.items, acc);
    }
    return acc;
}

const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/)/i;

/** The path segments of a data source's URL as the allow-list reads them (a placeholder is one segment). */
function urlSegments(url: string): string[] {
    const path =
        url
            .replace(/\{\{[^}]*\}\}/g, '_')
            .replace(/\{[^}]*\}/g, '_')
            .split(/[?#]/)[0] ?? '';
    return path
        .replace(/^\/+/, '')
        .replace(/^api\//, '')
        .split('/')
        .filter(Boolean);
}

function allowed(method: string, url: string, list: readonly DataSourceAllowance[]): boolean {
    const segments = urlSegments(url);
    return list.some((entry) => {
        if (entry.method.toUpperCase() !== method.toUpperCase()) return false;
        const want = entry.path.split('/').filter(Boolean);
        return want.length <= segments.length && want.every((w, i) => isPlaceholder(w) || w === segments[i]);
    });
}

/** A path segment written `{name}`: any one segment matches it. */
const isPlaceholder = (segment: string) =>
    segment.length >= 2 && segment.startsWith('{') && segment.indexOf('}') === segment.length - 1;

/** The problems of a stored form, errors first. */
export function lintDocument(raw: unknown, opts: LintOptions = {}): LintProblem[] {
    const doc = readDocument(raw);
    const stored = storedFieldsOf(raw);
    const position = new Map<string, number>();
    stored.forEach((f, i) => {
        if (!position.has(String(f.id))) position.set(String(f.id), i);
    });
    const byId = new Map(doc.fields.map((f) => [f.id, f]));
    const order = new Map(doc.fields.map((f, i) => [f.id, i]));

    const goneMemo = new Map<string, boolean>();
    const gone = (f: EngineField): boolean => {
        const known = goneMemo.get(f.id);
        if (known !== undefined) return known;
        let result = false;
        const seen = new Set<string>();
        let up: EngineField | undefined = f;
        while (up && !seen.has(up.id)) {
            seen.add(up.id);
            if (up.removed) {
                result = true;
                break;
            }
            up = up.parentId ? byId.get(up.parentId) : undefined;
        }
        goneMemo.set(f.id, result);
        return result;
    };
    const subjects = doc.fields.filter((f) => !gone(f));
    const at = (f: EngineField) => `fields[${position.get(f.id) ?? 0}]`;

    const out: LintProblem[] = [];
    const add = (
        rule: LintRule,
        severity: LintProblem['severity'],
        field: EngineField | null,
        path: string,
        values?: EngineValues
    ) => out.push({ rule, severity, fieldId: field?.id ?? null, path, message: messageOf(rule), values });

    /** What a field reads, by where it is written. */
    const readsOf = (f: EngineField) => {
        const reads: { path: string; refs: Iterable<string>; graph: boolean; formula: boolean }[] = [];
        if (f.computed)
            reads.push({
                path: `${at(f)}.data.computed.expression`,
                refs: extractReferences(f.computed.expression),
                graph: true,
                formula: true
            });
        reads.push(
            {
                path: `${at(f)}.behavior.visibilityConditions`,
                refs: conditionReferences(f.visibleWhen),
                graph: true,
                formula: false
            },
            {
                path: `${at(f)}.behavior.enabledConditions`,
                refs: conditionReferences(f.enabledWhen),
                graph: true,
                formula: false
            }
        );
        if (f.rules.requiredWhen)
            reads.push({
                path: `${at(f)}.behavior.validation.requiredWhen.expression`,
                refs: formulaReferences(f.rules.requiredWhen),
                graph: false,
                formula: false
            });
        f.rules.validWhen.forEach((rule, j) =>
            reads.push({
                path: `${at(f)}.behavior.validation.validWhen[${j}].expression`,
                refs: formulaReferences(rule.expression),
                graph: false,
                formula: true
            })
        );
        return reads;
    };

    // unknown-reference and reads-removed
    for (const f of subjects) {
        const flagged = new Set<string>();
        for (const read of readsOf(f))
            for (const ref of read.refs) {
                const name = nameOf(ref);
                if (!name) continue;
                const target = byId.get(name);
                if (!target) {
                    if (flagged.has(`u|${read.path}|${ref}`)) continue;
                    flagged.add(`u|${read.path}|${ref}`);
                    add('unknown-reference', 'error', f, read.path, { ref });
                } else if (read.formula && gone(target) && !flagged.has(`r|${read.path}|${name}`)) {
                    flagged.add(`r|${read.path}|${name}`);
                    add('reads-removed', 'warning', f, read.path, { key: name });
                }
            }
    }

    // unreachable
    const subjectGone = (c: VisibilityCondition) => {
        const name = nameOf(subjectOf(c));
        const target = name ? byId.get(name) : undefined;
        return target !== undefined && gone(target);
    };
    for (const f of subjects)
        if (neverHolds(f.visibleWhen, subjectGone))
            add('unreachable', 'error', f, `${at(f)}.behavior.visibilityConditions`);

    // cycle
    const edges = new Map<string, string[]>();
    for (const f of subjects) {
        const next = new Set<string>();
        for (const read of readsOf(f).filter((r) => r.graph))
            for (const ref of read.refs) {
                const name = nameOf(ref);
                const target = name ? byId.get(name) : undefined;
                if (target && !gone(target)) next.add(target.id);
            }
        edges.set(f.id, [...next]);
    }
    const state = new Map<string, 1 | 2>();
    const stack: string[] = [];
    const reported = new Set<string>();
    const visit = (id: string) => {
        state.set(id, 1);
        stack.push(id);
        for (const next of edges.get(id) ?? []) {
            const s = state.get(next);
            if (s === 1) {
                const cycle = stack.slice(stack.indexOf(next));
                const first = cycle.reduce((a, b) => ((order.get(b) ?? 0) < (order.get(a) ?? 0) ? b : a));
                const from = cycle.indexOf(first);
                const ring = [...cycle.slice(from), ...cycle.slice(0, from)];
                const key = ring.join('\u0000');
                if (!reported.has(key)) {
                    reported.add(key);
                    const head = byId.get(first);
                    if (head) add('cycle', 'error', head, at(head), { path: [...ring, first].join(' → ') });
                }
            } else if (s === undefined) visit(next);
        }
        stack.pop();
        state.set(id, 2);
    };
    for (const f of subjects) if (!state.has(f.id)) visit(f.id);

    // duplicate-option
    for (const f of subjects) {
        const values = flatValues(f.source.data?.dataSource?.staticData ?? f.props.options);
        const seen = new Set<string>();
        const duplicate = values.find((v) => {
            if (seen.has(written(v))) return true;
            seen.add(written(v));
            return false;
        });
        if (duplicate !== undefined)
            add('duplicate-option', 'error', f, `${at(f)}.props.options`, { value: shown(duplicate) });
    }

    // too-many-fields
    const max = opts.maxFields ?? FORM_FIELD_LIMIT;
    if (subjects.length > max) add('too-many-fields', 'error', null, 'fields', { count: subjects.length, max });

    // data-source (an address that leaves the API) and data-source-unlisted (one the manifests do not list)
    doc.runtime?.dataSources.forEach((source, i) => {
        const url = typeof source.request?.url === 'string' ? source.request.url : '';
        const path = `runtime.dataSources[${i}].request.url`;
        if (ABSOLUTE_URL.test(url) || url.includes('..'))
            add('data-source', 'error', null, path, { id: source.id, url });
        else if (opts.dataSources && !allowed(String(source.request.method ?? 'GET'), url, opts.dataSources))
            add('data-source-unlisted', 'warning', null, path, { id: source.id, url });
    });

    // untranslated
    const missing = new Map<string, { count: number; languages: Set<string> }>();
    for (const text of untranslatedTexts(stored, textLanguageOf(raw), opts.required ?? REQUIRED_TEXT_LANGUAGES)) {
        const entry = missing.get(text.fieldId) ?? { count: 0, languages: new Set<string>() };
        entry.count += 1;
        text.missing.forEach((l) => entry.languages.add(l));
        missing.set(text.fieldId, entry);
    }
    for (const f of subjects) {
        const entry = missing.get(f.id);
        if (entry)
            add('untranslated', 'warning', f, at(f), {
                count: entry.count,
                languages: [...entry.languages].join(', ')
            });
    }

    // required-hideable
    for (const f of subjects) {
        if (!holdsValue(f) || !(f.rules.required || f.rules.requiredWhen)) continue;
        let hideable = false;
        const seen = new Set<string>();
        let up: EngineField | undefined = f;
        while (up && !seen.has(up.id)) {
            seen.add(up.id);
            if (up.visibleWhen.length > 0 || (up.visibleToRoles?.length ?? 0) > 0) hideable = true;
            up = up.parentId ? byId.get(up.parentId) : undefined;
        }
        if (hideable && isBlank(initialValueOf(f, doc.fields))) add('required-hideable', 'warning', f, at(f));
    }

    // unknown-option
    for (const f of subjects) {
        const flagged = new Set<string>();
        for (const [list, area] of [
            [f.visibleWhen, 'visibilityConditions'],
            [f.enabledWhen, 'enabledConditions']
        ] as const)
            walkConditions(list, (c) => {
                const name = nameOf(subjectOf(c));
                const target = name ? byId.get(name) : undefined;
                if (!target || valueKindOf(target) !== 'choice' || target.optionsBinding || target.options.length === 0)
                    return;
                const known = optionValueKeys(target.options);
                const literals =
                    c.operator === 'eq'
                        ? [c.value]
                        : c.operator === 'in' && Array.isArray(c.value)
                          ? (c.value as unknown[])
                          : [];
                for (const v of literals) {
                    if (!isLiteral(v) || isBlank(v) || known.has(written(v))) continue;
                    const key = `${area}|${target.id}|${written(v)}`;
                    if (flagged.has(key)) continue;
                    flagged.add(key);
                    add('unknown-option', 'warning', f, `${at(f)}.behavior.${area}`, {
                        field: target.id,
                        value: shown(v)
                    });
                }
            });
    }

    // unknown-role
    const roleKeys = opts.roleKeys;
    if (roleKeys)
        for (const f of subjects)
            for (const role of new Set(f.visibleToRoles ?? []))
                if (!roleKeys.includes(role)) add('unknown-role', 'warning', f, `${at(f)}.visibleToRoles`, { role });

    // unclassified: an answer's data class decides what may leave the server (SEC-DC-1); unset counts as personal
    for (const f of subjects)
        if (holdsValue(f) && !f.source.classification)
            add('unclassified', 'warning', f, `${at(f)}.classification`, { field: f.label || f.id });

    return [...out.filter((p) => p.severity === 'error'), ...out.filter((p) => p.severity === 'warning')];
}
