/**
 * Validation of a form's values against its fields, compiled to Zod. Only visible and enabled fields are checked (a hidden or
 * disabled field never blocks a submission), each repeatable row against its own values. No author code runs: rules are data.
 *
 * Result: a flat map from a value path to the first message for it — `amount`, `items` (row count), `items[2].qty`. That is
 * the shape TanStack Form takes from a form-level validator, and what the error summary counts.
 */
import { z } from 'zod';
import type { Scope } from './conditions';
import { ethiopianDateText, isIsoDay, parseDate } from './dates';
import { shapeError } from './kinds';
import { isFormArray, isRequiredIn, type EngineField, type FieldOption } from './model';
import { evalCondition } from './runtime/formula';
import { str } from './runtime/path';
import { engineTranslator, type EngineTranslate } from './messages';
import { compilePattern } from './safePattern';
import { MAX_ROWS, holdsValue, isEnabledIn, isListField, isVisibleIn, pruneHidden, scopeFields } from './values';

export type FieldErrors = Record<string, string>;

const fill = (message: string, vars: Record<string, unknown>) =>
    message.replace(/\{(\w+)\}/g, (m: string, k: string) => (k in vars ? str(vars[k]) : m));
const isBlank = (v: unknown) => v === undefined || v === null || v === '';

export { parseDate };

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

/**
 * The Zod schema for one field's value. Built per validation run (cheap) because `required` etc. never change mid-form. The
 * author's messages are the field's own; the defaults are the engine's words in `language` (default Amharic).
 */
export function fieldSchema(f: EngineField, language = 'am'): z.ZodType<unknown> {
    const m = f.messages;
    const r = f.rules;
    const t = engineTranslator(language);
    const requiredMsg = m.required || t('form-engine.core.validation.required');

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
                return void ctx.addIssue({
                    code: 'custom',
                    message: m.fileType || t('form-engine.core.validation.invalidFile')
                });
            if (files.some((file) => Number(file.size) > maxSize))
                return void ctx.addIssue({
                    code: 'custom',
                    message:
                        m.fileSize ||
                        t('form-engine.core.validation.fileTooLarge', { size: String(maxSize / 1_000_000) })
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
                ctx.addIssue({
                    code: 'custom',
                    message: m.fileType || t('form-engine.core.validation.invalidFileType')
                });
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
                    ctx.addIssue({
                        code: 'custom',
                        message: m.type || t('form-engine.core.validation.checkSelection')
                    });
            });
    }

    if (BOOLEAN_TYPES.has(f.type)) {
        return z.unknown().superRefine((v, ctx) => {
            if (!isBlank(v) && typeof v !== 'boolean')
                return void ctx.addIssue({
                    code: 'custom',
                    message: m.type || t('form-engine.core.validation.yesOrNo')
                });
            // a required checkbox must be ticked (an agreement); a required switch only needs an answer
            if (r.required && (f.type === 'Checkbox' ? v !== true : isBlank(v)))
                ctx.addIssue({ code: 'custom', message: requiredMsg });
        });
    }

    if (f.type === 'EthDate') {
        // the day is stored as an ISO Gregorian date, so the limits are too and compare as text; they are worded Ethiopian
        const limit = (v: unknown) => (typeof v === 'string' && isIsoDay(v) ? v : undefined);
        const min = limit(r.minDate);
        const max = limit(r.maxDate);
        return z.unknown().superRefine((v, ctx) => {
            if (isBlank(v)) return void (r.required && ctx.addIssue({ code: 'custom', message: requiredMsg }));
            if (!isIsoDay(v))
                return void ctx.addIssue({
                    code: 'custom',
                    message: m.type || t('form-engine.core.validation.invalidDate')
                });
            if (min && v < min)
                return void ctx.addIssue({
                    code: 'custom',
                    message: fill(m.minDate || t('form-engine.core.validation.tooEarly'), {
                        min: ethiopianDateText(min, { language })
                    })
                });
            if (max && v > max)
                ctx.addIssue({
                    code: 'custom',
                    message: fill(m.maxDate || t('form-engine.core.validation.tooLate'), {
                        max: ethiopianDateText(max, { language })
                    })
                });
        });
    }

    if (f.type === 'Calendar') {
        return z.unknown().superRefine((v, ctx) => {
            if (isBlank(v) || (Array.isArray(v) && v.length === 0))
                return void (r.required && ctx.addIssue({ code: 'custom', message: requiredMsg }));
            const dates = (Array.isArray(v) ? v : [v]).map(parseDate);
            if (dates.some((d) => d === null))
                return void ctx.addIssue({
                    code: 'custom',
                    message: m.type || t('form-engine.core.validation.invalidDate')
                });
            const min = parseDate(r.minDate);
            const max = parseDate(r.maxDate);
            if (min && dates.some((d) => d !== null && d < min))
                return void ctx.addIssue({
                    code: 'custom',
                    message: m.minDate || t('form-engine.core.validation.tooEarly')
                });
            if (max && dates.some((d) => d !== null && d > max))
                ctx.addIssue({ code: 'custom', message: m.maxDate || t('form-engine.core.validation.tooLate') });
        });
    }

    if (NUMBER_TYPES.has(f.type) || (f.type === 'Slider' && !f.props.range)) {
        return z.unknown().superRefine((v, ctx) => {
            if (isBlank(v)) return void (r.required && ctx.addIssue({ code: 'custom', message: requiredMsg }));
            const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
            if (!Number.isFinite(n))
                return void ctx.addIssue({
                    code: 'custom',
                    message: m.type || t('form-engine.core.validation.invalidNumber')
                });
            if (r.min !== undefined && n < r.min)
                return void ctx.addIssue({
                    code: 'custom',
                    message: fill(m.min || t('form-engine.core.validation.min', { min: String(r.min) }), { min: r.min })
                });
            if (r.max !== undefined && n > r.max)
                ctx.addIssue({
                    code: 'custom',
                    message: fill(m.max || t('form-engine.core.validation.max', { max: String(r.max) }), { max: r.max })
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
                return void ctx.addIssue({
                    code: 'custom',
                    message: m.type || t('form-engine.core.validation.enterText')
                });
            const s = String(v);
            const add = (message: string) => ctx.addIssue({ code: 'custom', message });
            if (email && !z.email().safeParse(s).success)
                return void add(m.email || t('form-engine.core.validation.email'));
            if (r.typeMinLength !== undefined && s.length < r.typeMinLength)
                return void add(
                    fill(m.minLength || t('form-engine.core.validation.minLength', { min: String(r.typeMinLength) }), {
                        minLength: r.typeMinLength,
                        min: r.typeMinLength
                    })
                );
            if (r.typeMaxLength !== undefined && s.length > r.typeMaxLength)
                return void add(
                    fill(m.maxLength || t('form-engine.core.validation.maxLength', { max: String(r.typeMaxLength) }), {
                        maxLength: r.typeMaxLength,
                        max: r.typeMaxLength
                    })
                );
            if (r.minLength !== undefined && r.minLength > 0 && s.length < r.minLength)
                return void add(t('form-engine.core.validation.minLength', { min: String(r.minLength) }));
            if (r.maxLength !== undefined && r.maxLength > 0 && s.length > r.maxLength)
                return void add(t('form-engine.core.validation.longerThan', { max: String(r.maxLength) }));
            if (pattern && !pattern(s)) add(r.patternMessage || t('form-engine.core.validation.format'));
        });
    }

    // single choices (option values may be strings, numbers or objects), tree selections, registered custom types, ranges
    return z.unknown().superRefine((v, ctx) => {
        if (r.required && (isBlank(v) || (Array.isArray(v) && v.length === 0)))
            ctx.addIssue({ code: 'custom', message: requiredMsg });
    });
}

const CHOICE_TYPES = new Set(['Dropdown', 'MultiSelect', 'RadioButton', 'CheckboxGroup']);

/**
 * A choice is one of the field's own options (in option groups too). Not checked when the options come from a data source
 * or the field takes free text (`editable`): those are checked where the data is.
 */
function choiceError(f: EngineField, value: unknown, t: EngineTranslate): string | undefined {
    if (!CHOICE_TYPES.has(f.type) || f.optionsBinding || f.props.editable || f.options.length === 0) return undefined;
    if (isBlank(value) || (Array.isArray(value) && value.length === 0)) return undefined;
    const allowed = new Set<string>();
    const add = (options: readonly FieldOption[]) =>
        options.forEach((o) => (o.items?.length ? add(o.items) : allowed.add(JSON.stringify(o.value))));
    add(f.options);
    const picked = Array.isArray(value) ? (value as unknown[]) : [value];
    return picked.every((v) => allowed.has(JSON.stringify(v)))
        ? undefined
        : f.messages.type || t('form-engine.core.validation.chooseOption');
}

/** The message shown while a remote check runs (the renderer shows it as progress, not as a mistake). */
export const remotePendingText = (language: string): string =>
    engineTranslator(language)('form-engine.core.validation.checking');

/** The message of a field checked by a data source (`behavior.validation.remote`), from `scope.status.<id>`. */
function remoteError(f: EngineField, scope: Scope, t: EngineTranslate): string | undefined {
    const remote = f.remote;
    if (!remote) return undefined;
    const st = (scope.status as Record<string, { state?: string; error?: string | null }> | undefined)?.[
        remote.dataSourceId
    ];
    if (st?.state === 'loading') return t('form-engine.core.validation.checking');
    if (st?.state === 'error') return st.error || remote.message || t('form-engine.core.validation.notVerified');
    return undefined;
}

function rowCountMessage(f: EngineField, rows: number, needsRow: boolean, t: EngineTranslate): string | undefined {
    const { minItems } = f.rules;
    const max = Math.min(f.rules.maxItems, MAX_ROWS);
    const min = needsRow ? Math.max(1, minItems) : minItems;
    const label = f.label || t('form-engine.core.validation.thisSection');
    if (needsRow && rows === 0 && minItems === 0 && f.messages.required) return f.messages.required;
    if (rows < min)
        return fill(f.messages.minItems ?? t('form-engine.core.validation.minItems', { label, count: min }), {
            minItems: min
        });
    if (rows > max)
        return fill(f.messages.maxItems ?? t('form-engine.core.validation.maxItems', { label, max: String(max) }), {
            maxItems: max
        });
    return undefined;
}

/** What a rule's formula may read on the server too: the form, its row, the whole form and the user. */
const ruleScope = (scope: Scope, current: Record<string, unknown>, root: Record<string, unknown>) => ({
    user: scope.user,
    form: current,
    row: current,
    root
});

/** The message of the first `validWhen` rule of a filled value that does not hold (a rule that cannot run holds). */
function validWhenError(
    f: EngineField,
    value: unknown,
    scope: Scope,
    current: Record<string, unknown>,
    root: Record<string, unknown>,
    t: EngineTranslate
): string | undefined {
    if (isBlank(value) || (Array.isArray(value) && value.length === 0)) return undefined;
    const failed = f.rules.validWhen.find(
        (rule) => evalCondition(rule.expression, ruleScope(scope, current, root)) === false
    );
    return failed ? failed.message || t('form-engine.core.validation.notValid') : undefined;
}

/**
 * Validate `values` (the whole form). `scope` is the runtime context (`data`, `user`, `route`, `variables`) that conditions may
 * read. Returns `{}` when everything is fine. Values of hidden fields are dropped first, so the browser and the server agree
 * on what a rule reads. The engine's own messages are in `opts.language` (default Amharic); the author's are the fields'.
 */
export function validateForm(
    fields: EngineField[],
    values: Record<string, unknown>,
    scope: Scope = {},
    opts: { language?: string } = {}
): FieldErrors {
    const language = opts.language ?? 'am';
    const t = engineTranslator(language);
    const byId = new Map(fields.map((f) => [f.id, f]));
    const errors: FieldErrors = {};
    const root = pruneHidden(fields, values, scope);

    const run = (parentId: string | null, current: Record<string, unknown>, prefix: string) => {
        const ctx = { ...scope, root };
        for (const f of scopeFields(fields, parentId)) {
            if (!isVisibleIn(f, byId, current, ctx, parentId) || !isEnabledIn(f, byId, current, ctx, parentId))
                continue;
            const path = `${prefix}${f.id}`;
            if (isFormArray(f)) {
                const rows = Array.isArray(current[f.id]) ? (current[f.id] as Record<string, unknown>[]) : [];
                const needsRow = f.validated && isRequiredIn(f, current, root, { user: scope.user });
                const count = rowCountMessage(f, rows.length, needsRow, t);
                if (count) {
                    errors[path] = count;
                    continue;
                }
                // the section's own checks read its rows (count(form.lines) <= 5), then each row is checked
                const check = f.validated ? validWhenError(f, rows, scope, current, root, t) : undefined;
                if (check) errors[path] = check;
                rows.forEach((row, i) => run(f.id, row ?? {}, `${path}[${i}].`));
                continue;
            }
            if (holdsValue(f) && !f.computed?.readOnly) {
                const shape = shapeError(f, current[f.id], language);
                if (shape) {
                    errors[path] = shape;
                    continue;
                }
            }
            if (!f.validated) continue;
            const required = isRequiredIn(f, current, root, { user: scope.user });
            const result = fieldSchema(
                required && !f.rules.required ? { ...f, rules: { ...f.rules, required } } : f,
                language
            ).safeParse(current[f.id]);
            if (!result.success) {
                errors[path] = result.error.issues[0]?.message ?? t('form-engine.core.validation.invalidValue');
                continue;
            }
            const message =
                choiceError(f, current[f.id], t) ?? validWhenError(f, current[f.id], scope, current, root, t);
            if (message) errors[path] = message;
            else if (f.remote && !isBlank(current[f.id])) {
                const remote = remoteError(f, scope, t);
                if (remote) errors[path] = remote;
            }
        }
    };
    run(null, root, '');
    return errors;
}
