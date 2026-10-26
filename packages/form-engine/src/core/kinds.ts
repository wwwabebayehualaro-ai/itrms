/**
 * What kind of value a field holds, and whether a value is of that kind. Checked for every value field, validated or not:
 * a direct API call can send anything, and a rule or a report must never meet a value of the wrong shape.
 */
import { isIsoDay, parseDate } from './dates';
import { isFormArray, type EngineField } from './model';
import { engineTranslator, type EngineMessageKey } from './messages';

export type ValueKind =
    | 'text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'ethdate'
    | 'choice'
    | 'multi'
    | 'range'
    | 'files'
    | 'rows'
    | 'ref';

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
    if (t === 'RegistryLookup') return 'ref';
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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANT = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function isInstant(v: unknown): boolean {
    const m = typeof v === 'string' ? INSTANT.exec(v) : null;
    return !!m && isIsoDay(m[1]) && !Number.isNaN(new Date(v as string).getTime());
}

/**
 * An uploaded file as the engine records it (`host/files.ts`: `{ file_id, url, filename, content_type, size }`), or as
 * older forms stored it (`{ name, size }`): an object that names the file, with a size that is a count of bytes if given.
 */
function isFile(v: unknown): boolean {
    if (!isObject(v)) return false;
    const named = typeof v.file_id === 'string' || typeof v.filename === 'string' || typeof v.name === 'string';
    return named && (v.size === undefined || (typeof v.size === 'number' && Number.isFinite(v.size) && v.size >= 0));
}

/**
 * The message when `v` is not a value of the field's kind, or undefined (a blank is fine here: "required" is another
 * rule). The author's `messages.type` replaces the default text. Nothing is coerced: "12" is a number to a number box
 * only as the text a browser sends, and the stored value stays what was sent.
 */
export function shapeError(f: EngineField, v: unknown, language = 'am'): string | undefined {
    const kind = valueKindOf(f);
    if (!kind || kind === 'rows' || isBlank(v)) return undefined;
    const t = engineTranslator(language);
    const bad = (fallback: EngineMessageKey) => f.messages.type || t(fallback);
    switch (kind) {
        case 'text':
            return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))
                ? undefined
                : bad('form-engine.core.validation.enterText');
        case 'number':
            return isNumeric(v) ? undefined : bad('form-engine.core.validation.invalidNumber');
        case 'boolean':
            return typeof v === 'boolean' ? undefined : bad('form-engine.core.validation.yesOrNo');
        case 'date':
            return (Array.isArray(v) ? v : [v]).every((d) => parseDate(d) !== null)
                ? undefined
                : bad('form-engine.core.validation.invalidDate');
        case 'datetime':
            return isInstant(v) ? undefined : bad('form-engine.core.validation.invalidDate');
        case 'ethdate':
            return isIsoDay(v) ? undefined : bad('form-engine.core.validation.invalidDate');
        case 'choice':
            return isOption(v) ? undefined : bad('form-engine.core.validation.checkSelection');
        case 'multi':
            return Array.isArray(v) && v.every(isOption)
                ? undefined
                : bad('form-engine.core.validation.checkSelection');
        case 'range':
            // an untouched range slider still holds the scalar default of a plain slider: nothing chosen yet
            if (typeof v === 'number') return undefined;
            return Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n))
                ? undefined
                : bad('form-engine.core.validation.checkSelection');
        case 'ref':
            return typeof v === 'string' && UUID.test(v)
                ? undefined
                : bad('form-engine.core.validation.invalidReference');
        case 'files':
            return Array.isArray(v) && v.every(isFile) ? undefined : bad('form-engine.core.validation.invalidFile');
    }
}
