import type { FormField } from '../core/storedTypes';
import type { TemplateRuntimeConfig } from '../Runtime/types';

/**
 * Field keys. A field's `id` is its *key* in submitted data and in bindings/formulas (`{{form.amount}}`, `row.qty`),
 * so builders can give it a readable name.
 */
export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/** Returns an error message, or null when `key` can be used for `fieldId`. */
export function validateFieldKey(key: string, fieldId: string, fields: FormField[]): string | null {
    if (!KEY_PATTERN.test(key)) return 'Start with a letter; use letters, digits and _ only (max 64)';
    if (fields.some((f) => f.id === key && f.id !== fieldId)) return 'Another field already uses this key';
    return null;
}

/** "Unit price (EUR)" -> "unitPriceEur". Used to propose a key from a label. */
export function keyFromLabel(label: string): string {
    const words = label
        .replace(/[^A-Za-z0-9]+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
    const tidy = (w: string) => (w === w.toUpperCase() && w.length > 1 ? w.toLowerCase() : w); // EUR -> eur, but keep camelCase words
    const key = words
        .map((w, i) =>
            i === 0
                ? tidy(w).charAt(0).toLowerCase() + tidy(w).slice(1)
                : tidy(w).charAt(0).toUpperCase() + tidy(w).slice(1)
        )
        .join('');
    return /^[A-Za-z]/.test(key) ? key : `f${key}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// `form.old`, `row.old`, `root.old` inside bindings/formulas (word-boundary safe: `form.oldest` is untouched)
const refPattern = (oldKey: string) => new RegExp(`\\b((?:form|row|root)\\.)${escape(oldKey)}(?![A-Za-z0-9_])`, 'g');

const renameInValue = (value: unknown, oldKey: string, newKey: string): unknown => {
    if (typeof value === 'string')
        return value.includes('{{') ? value.replace(refPattern(oldKey), `$1${newKey}`) : value;
    if (Array.isArray(value)) return value.map((v) => renameInValue(v, oldKey, newKey));
    if (value && typeof value === 'object')
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renameInValue(v, oldKey, newKey)]));
    return value;
};

const renameConditions = (conds: any[] | undefined, oldKey: string, newKey: string): any[] | undefined =>
    conds?.map((c) => ({
        ...c,
        field:
            c.field === oldKey
                ? newKey
                : typeof c.field === 'string'
                  ? c.field.replace(refPattern(oldKey), `$1${newKey}`)
                  : c.field,
        value: renameInValue(c.value, oldKey, newKey),
        conditions: renameConditions(c.conditions, oldKey, newKey)
    }));

/** Rename a field key everywhere it is referenced by other fields (parent links, conditions, computed values, option bindings). */
export function renameFieldKey(fields: FormField[], oldKey: string, newKey: string): FormField[] {
    if (oldKey === newKey) return fields;
    return fields.map((f) => {
        const next: FormField = { ...f };
        if (f.id === oldKey) {
            next.id = newKey;
            next.props = { ...f.props, ...(f.props?.id !== undefined && { id: newKey }) };
            next.data = {
                ...f.data,
                defaultProps: { ...f.data?.defaultProps, ...(f.data?.defaultProps?.id !== undefined && { id: newKey }) }
            };
        }
        if (f.parentId === oldKey) next.parentId = newKey;
        if (f.behavior?.visibilityConditions || f.behavior?.enabledConditions) {
            next.behavior = {
                ...f.behavior,
                visibilityConditions:
                    renameConditions(f.behavior.visibilityConditions, oldKey, newKey) ??
                    f.behavior.visibilityConditions,
                enabledConditions: renameConditions(f.behavior.enabledConditions, oldKey, newKey)
            };
        }
        if (f.data?.computed)
            next.data = { ...next.data, computed: renameInValue(f.data.computed, oldKey, newKey) as any };
        return next;
    });
}

/** Same rename inside the template's data sources / variables / submit body. */
export const renameInRuntime = (
    runtime: TemplateRuntimeConfig,
    oldKey: string,
    newKey: string
): TemplateRuntimeConfig => renameInValue(runtime, oldKey, newKey) as TemplateRuntimeConfig;
