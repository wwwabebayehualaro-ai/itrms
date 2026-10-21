/**
 * Validation of a form's values against its fields, compiled to Zod. Only visible and enabled fields are checked (a hidden or
 * disabled field never blocks a submission), each repeatable row against its own values. No author code runs: rules are data.
 *
 * Result: a flat map from a value path to the first message for it — `amount`, `items` (row count), `items[2].qty`. That is
 * the shape TanStack Form takes from a form-level validator, and what the error summary counts.
 */
import { z } from 'zod';
import type { Scope } from './conditions';
import { isFormArray, type EngineField } from './model';
import { str } from './runtime/path';
import { compilePattern } from './safePattern';
import { isEnabledIn, isListField, isVisibleIn, scopeFields } from './values';

export type FieldErrors = Record<string, string>;

const fill = (message: string, vars: Record<string, unknown>) =>
    message.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? str(vars[k]) : m));
const isBlank = (v: unknown) => v === undefined || v === null || v === '';

/** "YYYY-MM-DD" is the day the person picked (stored without a time zone); anything else is parsed as an instant. */
export function parseDate(v: unknown): Date | null {
    if (isBlank(v)) return null;
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
    const day = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    const d = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(v as string);
    return Number.isNaN(d.getTime()) ? null : d;
}

const STRING_TYPES = new Set([
    'InputText',
    'InputTextarea',
    'Password',
    'InputMask',
    'ColorPicker',
    'RadioButton',
    'AutoComplete'
]);
const NUMBER_TYPES = new Set(['InputNumber', 'Rating', 'Knob']);
const BOOLEAN_TYPES = new Set(['Checkbox', 'InputSwitch']);

/** The Zod schema for one field's value. Built per validation run (cheap) because `required` etc. never change mid-form. */
export function fieldSchema(f: EngineField): z.ZodType<unknown> {
    const m = f.messages;
    const r = f.rules;
    const requiredMsg = m.required || 'This field is required';

    if (f.type === 'FileUpload') {
        const maxSize = r.maxFileSize ?? 2_000_000;
        const exts = r.accept
            ?.split(',')
            .map((e) => e.trim().toLowerCase())
            .filter(Boolean);
        return z.unknown().superRefine((value, ctx) => {
            const files = Array.isArray(value) ? (value as Array<Record<string, unknown>>) : [];
            if (r.required && files.length === 0) return void ctx.addIssue({ code: 'custom', message: requiredMsg });
            if (files.some((file) => !file || typeof file.name !== 'string' || !(Number(file.size) > 0)))
                return void ctx.addIssue({ code: 'custom', message: m.fileType || 'Invalid file' });
            if (files.some((file) => Number(file.size) > maxSize))
                return void ctx.addIssue({
                    code: 'custom',
                    message: m.fileSize || `File must be smaller than ${maxSize / 1_000_000}MB`
                });
            if (
                exts?.length &&
                files.some(
                    (file) =>
                        !exts.some(
                            (e) =>
                                String(file.name).toLowerCase().endsWith(e) ||
                                (e.endsWith('/*') && str(file.type ?? '').startsWith(e.slice(0, -1)))
                        )
                )
            )
                ctx.addIssue({ code: 'custom', message: m.fileType || 'Invalid file type' });
        });
    }

    if (isListField(f)) {
        return z
            .unknown()
            .transform((v): unknown[] =>
                v === null || v === undefined || v === '' ? [] : Array.isArray(v) ? (v as unknown[]) : [v]
            )
            .superRefine((list, ctx) => {
                if (r.required && list.length === 0) ctx.addIssue({ code: 'custom', message: requiredMsg });
                else if (list.some((x) => x === undefined))
                    ctx.addIssue({ code: 'custom', message: m.type || 'Please check your selection' });
            });
    }

    if (BOOLEAN_TYPES.has(f.type)) {
        return z.unknown().superRefine((v, ctx) => {
            if (!isBlank(v) && typeof v !== 'boolean')
                return void ctx.addIssue({ code: 'custom', message: m.type || 'Please choose yes or no' });
            // a required checkbox must be ticked (an agreement); a required switch only needs an answer
            if (r.required && (f.type === 'Checkbox' ? v !== true : isBlank(v)))
                ctx.addIssue({ code: 'custom', message: requiredMsg });
        });
    }

    if (f.type === 'Calendar') {
        return z.unknown().superRefine((v, ctx) => {
            if (isBlank(v) || (Array.isArray(v) && v.length === 0))
                return void (r.required && ctx.addIssue({ code: 'custom', message: requiredMsg }));
            const dates = (Array.isArray(v) ? v : [v]).map(parseDate);
            if (dates.some((d) => d === null))
                return void ctx.addIssue({ code: 'custom', message: m.type || 'Please enter a valid date' });
            const min = parseDate(r.minDate);
            const max = parseDate(r.maxDate);
            if (min && dates.some((d) => d !== null && d < min))
                return void ctx.addIssue({ code: 'custom', message: m.minDate || 'Date is too early' });
            if (max && dates.some((d) => d !== null && d > max))
                ctx.addIssue({ code: 'custom', message: m.maxDate || 'Date is too late' });
        });
    }

    if (NUMBER_TYPES.has(f.type) || (f.type === 'Slider' && !f.props.range)) {
        return z.unknown().superRefine((v, ctx) => {
            if (isBlank(v)) return void (r.required && ctx.addIssue({ code: 'custom', message: requiredMsg }));
            const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
            if (!Number.isFinite(n))
                return void ctx.addIssue({ code: 'custom', message: m.type || 'Please enter a valid number' });
            if (r.min !== undefined && n < r.min)
                return void ctx.addIssue({
                    code: 'custom',
                    message: fill(m.min || `Must be at least ${r.min}`, { min: r.min })
                });
            if (r.max !== undefined && n > r.max)
                ctx.addIssue({
                    code: 'custom',
                    message: fill(m.max || `Cannot be more than ${r.max}`, { max: r.max })
                });
        });
    }

    if (STRING_TYPES.has(f.type)) {
        const email = r.typeEmail || (f.type === 'InputText' && f.props.type === 'email');
        // RE2 (linear time), because this also runs on the server (SEC-IN-2, SEC-IN-4). An invalid or unsupported
        // expression is ignored rather than blocking every submission; the designer flags it.
        const pattern = r.pattern ? (compilePattern(r.pattern) ?? undefined) : undefined;
        return z.unknown().superRefine((v, ctx) => {
            if (isBlank(v)) return void (r.required && ctx.addIssue({ code: 'custom', message: requiredMsg }));
            if (typeof v !== 'string' && typeof v !== 'number')
                return void ctx.addIssue({ code: 'custom', message: m.type || 'Please enter text' });
            const s = String(v);
            const add = (message: string) => ctx.addIssue({ code: 'custom', message });
            if (email && !z.email().safeParse(s).success)
                return void add(m.email || 'Please enter a valid email address');
            if (r.typeMinLength !== undefined && s.length < r.typeMinLength)
                return void add(
                    fill(m.minLength || `Must be at least ${r.typeMinLength} characters`, {
                        minLength: r.typeMinLength,
                        min: r.typeMinLength
                    })
                );
            if (r.typeMaxLength !== undefined && s.length > r.typeMaxLength)
                return void add(
                    fill(m.maxLength || `Cannot exceed ${r.typeMaxLength} characters`, {
                        maxLength: r.typeMaxLength,
                        max: r.typeMaxLength
                    })
                );
            if (r.minLength !== undefined && r.minLength > 0 && s.length < r.minLength)
                return void add(`Must be at least ${r.minLength} characters`);
            if (r.maxLength !== undefined && r.maxLength > 0 && s.length > r.maxLength)
                return void add(`Cannot be longer than ${r.maxLength} characters`);
            if (pattern && !pattern(s)) add(r.patternMessage || 'Please check the format');
        });
    }

    // single choices (option values may be strings, numbers or objects), tree selections, registered custom types, ranges
    return z.unknown().superRefine((v, ctx) => {
        if (r.required && (isBlank(v) || (Array.isArray(v) && v.length === 0)))
            ctx.addIssue({ code: 'custom', message: requiredMsg });
    });
}

/** Shown while a remote check runs (the renderer shows it as progress, not as a mistake). */
export const REMOTE_PENDING = 'Checking…';

/** The message of a field checked by a data source (`behavior.validation.remote`), from `scope.status.<id>`. */
function remoteError(f: EngineField, scope: Scope): string | undefined {
    const remote = f.remote;
    if (!remote) return undefined;
    const st = (scope.status as Record<string, { state?: string; error?: string | null }> | undefined)?.[
        remote.dataSourceId
    ];
    if (st?.state === 'loading') return REMOTE_PENDING;
    if (st?.state === 'error') return st.error || remote.message || 'Could not be verified';
    return undefined;
}

function rowCountMessage(f: EngineField, rows: number): string | undefined {
    const { minItems: min, maxItems: max } = f.rules;
    const label = f.label || 'This section';
    if (rows < min)
        return fill(f.messages.minItems ?? `${label}: at least ${min} row${min === 1 ? '' : 's'} required`, {
            minItems: min
        });
    if (rows > max) return fill(f.messages.maxItems ?? `${label}: at most ${max} rows allowed`, { maxItems: max });
    return undefined;
}

/**
 * Validate `values` (the whole form). `scope` is the runtime context (`data`, `user`, `route`, `variables`) that conditions may
 * read. Returns `{}` when everything is fine.
 */
export function validateForm(fields: EngineField[], values: Record<string, unknown>, scope: Scope = {}): FieldErrors {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const errors: FieldErrors = {};
    const root = values;

    const run = (parentId: string | null, current: Record<string, unknown>, prefix: string) => {
        const ctx = { ...scope, root };
        for (const f of scopeFields(fields, parentId)) {
            if (!f.validated && !isFormArray(f)) continue;
            if (!isVisibleIn(f, byId, current, ctx, parentId) || !isEnabledIn(f, byId, current, ctx, parentId))
                continue;
            const path = `${prefix}${f.id}`;
            if (isFormArray(f)) {
                const rows = Array.isArray(current[f.id]) ? (current[f.id] as Record<string, unknown>[]) : [];
                const count = rowCountMessage(f, rows.length);
                if (count) errors[path] = count;
                else rows.forEach((row, i) => run(f.id, row ?? {}, `${path}[${i}].`));
                continue;
            }
            const result = fieldSchema(f).safeParse(current[f.id]);
            if (!result.success) errors[path] = result.error.issues[0]?.message ?? 'Invalid value';
            else if (f.remote && !isBlank(current[f.id])) {
                const remote = remoteError(f, scope);
                if (remote) errors[path] = remote;
            }
        }
    };
    run(null, values, '');
    return errors;
}
