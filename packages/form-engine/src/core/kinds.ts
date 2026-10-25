/**
 * What kind of value a field holds, and whether a value is of that kind. Checked for every value field, validated or not:
 * a direct API call can send anything, and a rule or a report must never meet a value of the wrong shape.
 */
import { isIsoDay, parseDate } from './dates';
import { isFormArray, type EngineField } from './model';

export type ValueKind =
    'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'ethdate' | 'choice' | 'multi' | 'range' | 'files' | 'rows';

const TEXT_TYPES = new Set(['InputText', 'InputTextarea', 'InputMask', 'AutoComplete', 'ColorPicker', 'Password']);
const MULTI_TYPES = new Set(['MultiSelect', 'CheckboxGroup', 'Chips']);
const NUMBER_TYPES = new Set(['InputNumber', 'Rating', 'Knob']);
const BOOLEAN_TYPES = new Set(['Checkbox', 'InputSwitch']);

/** The kind of value a field holds; null for containers and display fields (and types this version does not know). */
export function valueKindOf(f: Pick<EngineField, 'type' | 'props'>): ValueKind | null {
    const t = f.type;
    if (TEXT_TYPES.has(t)) return 'text';
    if (t === 'Dropdown') return f.props.multiple ? 'multi' : 'choice';
    if (t === 'RadioButton') return 'choice';
    if (MULTI_TYPES.has(t)) return 'multi';
    if (t === 'Slider') return f.props.range ? 'range' : 'number';
    if (NUMBER_TYPES.has(t)) return 'number';
    if (BOOLEAN_TYPES.has(t)) return 'boolean';
    if (t === 'Calendar') return f.props.showTime ? 'datetime' : 'date';
    if (t === 'EthDate') return 'ethdate';
    if (t === 'FileUpload') return 'files';
    if (isFormArray(f)) return 'rows';
    return null;
}

const isBlank = (v: unknown) => v === undefined || v === null || v === '';
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isScalar = (v: unknown) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
const isOption = (v: unknown) => isScalar(v) || isObject(v);
const isNumeric = (v: unknown) =>
    (typeof v === 'number' && Number.isFinite(v)) ||
    (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
const INSTANT = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function isInstant(v: unknown): boolean {
    const m = typeof v === 'string' ? INSTANT.exec(v) : null;
    return !!m && isIsoDay(m[1]) && !Number.isNaN(new Date(v as string).getTime());
}

function isFile(v: unknown): boolean {
    return isObject(v) && typeof v.file_id === 'string' && typeof v.name === 'string' && Number(v.size) > 0;
}

/**
 * The message when `v` is not a value of the field's kind, or undefined (a blank is fine here: "required" is another
 * rule). The author's `messages.type` replaces the default text. Nothing is coerced: "12" is a number to a number box
 * only as the text a browser sends, and the stored value stays what was sent.
 */
export function shapeError(f: EngineField, v: unknown): string | undefined {
    const kind = valueKindOf(f);
    if (!kind || kind === 'rows' || isBlank(v)) return undefined;
    const bad = (fallback: string) => f.messages.type || fallback;
    switch (kind) {
        case 'text':
            return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
                ? undefined
                : bad('Please enter text');
        case 'number':
            return isNumeric(v) ? undefined : bad('Please enter a valid number');
        case 'boolean':
            return typeof v === 'boolean' ? undefined : bad('Please choose yes or no');
        case 'date':
            return (Array.isArray(v) ? v : [v]).every((d) => parseDate(d) !== null)
                ? undefined
                : bad('Please enter a valid date');
        case 'datetime':
            return isInstant(v) ? undefined : bad('Please enter a valid date');
        case 'ethdate':
            return isIsoDay(v) ? undefined : bad('Please enter a valid date');
        case 'choice':
            return isOption(v) ? undefined : bad('Please check your selection');
        case 'multi':
            return Array.isArray(v) && v.every(isOption) ? undefined : bad('Please check your selection');
        case 'range':
            return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
                ? undefined
                : bad('Please check your selection');
        case 'files':
            return Array.isArray(v) && v.every(isFile) ? undefined : bad('Invalid file');
    }
}
