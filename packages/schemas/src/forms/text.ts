/**
 * Texts of a stored form in every language (task 0.17a): a field's label, help text, placeholder, option labels and
 * custom messages are each a plain string (one text for every language, the older shape) or a map by language tag
 * (`{ am, en, 'wal-Latn' }`). They are resolved to one language where a form is read, so the engine draws strings.
 * `fieldTexts` names every translatable text of a field once: resolving, the save-time check, the builder's translation
 * table and the untranslated count all walk it.
 */
import { z } from 'zod';

import { LANGUAGE_TAG, fallbackChain } from '../i18n';

/** The most languages one text holds. */
export const MAX_TEXT_LANGUAGES = 10;
/** The languages every text should have; others are the installation's own, reported but not counted. */
export const REQUIRED_TEXT_LANGUAGES = ['am', 'en'] as const;

export const formTextSchema = z.union([
    z.string(),
    z
        .record(z.string().regex(LANGUAGE_TAG, 'is not a language tag'), z.string())
        .refine((t) => Object.keys(t).length <= MAX_TEXT_LANGUAGES, `at most ${MAX_TEXT_LANGUAGES} languages`)
]);

export type FormText = z.infer<typeof formTextSchema>;

const isMap = (text: unknown): text is Record<string, unknown> =>
    !!text && typeof text === 'object' && !Array.isArray(text);

/**
 * A text in a language: the language asked for, then Amharic, then English, then any other (in tag order, so it is
 * the same everywhere); an empty one counts as missing. A plain string is every language's. Undefined when there is none.
 */
export function formTextIn(text: unknown, language: string): string | undefined {
    if (typeof text === 'string') return text;
    if (typeof text === 'number') return String(text);
    if (!isMap(text)) return undefined;
    for (const tag of fallbackChain(language)) {
        const value = text[tag];
        if (typeof value === 'string' && value) return value;
    }
    for (const tag of Object.keys(text).sort()) {
        const value = text[tag];
        if (typeof value === 'string' && value) return value;
    }
    return undefined;
}

/**
 * The text a language has of its own (no fallback): a map's entry, or a plain string as the text of `plainAs` (the
 * language it was written in: the builder's authoring language). '' when it has none.
 */
export function ownText(text: unknown, language: string, plainAs: string): string {
    if (typeof text === 'string') return language === plainAs ? text : '';
    if (!isMap(text)) return '';
    const value = text[language];
    return typeof value === 'string' ? value : '';
}

/** Whether a text has nothing of its own in a language. */
export const missingIn = (text: unknown, language: string, plainAs: string) => ownText(text, language, plainAs) === '';

/**
 * A text with one language's text set (the builder's write). A plain string written in its own language stays a plain
 * string (what older builders stored); written in another, it becomes a map that keeps it. '' removes a language; a map
 * left empty is no text. A map never turns back into a plain string.
 */
export function setTextIn(text: unknown, language: string, value: string, plainAs: string): FormText | undefined {
    if (!isMap(text)) {
        const plain = typeof text === 'string' ? text : '';
        if (language === plainAs) return value === '' ? undefined : value;
        const next: Record<string, string> = plain ? { [plainAs]: plain } : {};
        if (value) next[language] = value;
        return Object.keys(next).length ? next : undefined;
    }
    const next: Record<string, string> = {};
    for (const [tag, v] of Object.entries(text)) if (typeof v === 'string' && v) next[tag] = v;
    if (value) next[language] = value;
    else delete next[language];
    return Object.keys(next).length ? next : undefined;
}

export type FieldTextKind = 'label' | 'helpText' | 'placeholder' | 'option' | 'message';

export interface FieldText {
    /** Where it is stored, dotted from the field (`props.helpText`, `props.options.1.label`). */
    path: string;
    kind: FieldTextKind;
    /** The option's number (from 1) or the message's rule. */
    ref?: string;
    value: unknown;
}

type Loose = Record<string, unknown> | null | undefined;
const obj = (v: unknown): Loose => (isMap(v) ? v : undefined);

/** The option list a field's choices come from (the first one present), and where it is stored. */
function optionList(field: Loose): { path: string; items: unknown[] } | undefined {
    const data = obj(field?.data);
    const lists: [string, unknown][] = [
        ['data.dataSource.staticData', obj(data?.dataSource)?.staticData],
        ['props.options', obj(field?.props)?.options],
        ['data.defaultProps.options', obj(data?.defaultProps)?.options]
    ];
    for (const [path, items] of lists) if (Array.isArray(items)) return { path, items };
    return undefined;
}

/** Every translatable text of a stored field, in a fixed order (absent ones left out, the label always there). */
export function fieldTexts(field: unknown): FieldText[] {
    const f = obj(field);
    if (!f) return [];
    const props = obj(f.props);
    const defaults = obj(obj(f.data)?.defaultProps);
    const validation = obj(obj(f.behavior)?.validation);
    const texts: FieldText[] = [{ path: 'label', kind: 'label', value: f.label }];
    for (const kind of ['helpText', 'placeholder'] as const) {
        const own = props?.[kind];
        const inherited = defaults?.[kind];
        if (own !== undefined && own !== null) texts.push({ path: `props.${kind}`, kind, value: own });
        else if (inherited !== undefined && inherited !== null)
            // read from the palette's defaults; a change is written to props (props win over them)
            texts.push({ path: `props.${kind}`, kind, value: inherited });
    }
    const list = optionList(f);
    const walk = (items: unknown[], path: string, prefix: string) =>
        items.forEach((o, i) => {
            const option = obj(o);
            // a bare string or number is its own label and value: not translatable
            if (!option) return;
            const ref = `${prefix}${i + 1}`;
            texts.push({ path: `${path}.${i}.label`, kind: 'option', ref, value: option.label });
            if (Array.isArray(option.items)) walk(option.items, `${path}.${i}.items`, `${ref}.`);
        });
    if (list) walk(list.items, list.path, '');
    const messages = obj(validation?.errorMessages);
    for (const rule of Object.keys(messages ?? {}))
        texts.push({
            path: `behavior.validation.errorMessages.${rule}`,
            kind: 'message',
            ref: rule,
            value: messages?.[rule]
        });
    const pattern = obj(validation?.rules)?.patternMessage;
    if (pattern !== undefined && pattern !== null)
        texts.push({
            path: 'behavior.validation.rules.patternMessage',
            kind: 'message',
            ref: 'pattern',
            value: pattern
        });
    const remote = obj(validation?.remote)?.message;
    if (remote !== undefined && remote !== null)
        texts.push({ path: 'behavior.validation.remote.message', kind: 'message', ref: 'remote', value: remote });
    const validWhen = validation?.validWhen;
    if (Array.isArray(validWhen))
        validWhen.forEach((rule, i) => {
            const message = obj(rule)?.message;
            if (message !== undefined && message !== null)
                texts.push({
                    path: `behavior.validation.validWhen.${i}.message`,
                    kind: 'message',
                    ref: `validWhen.${i + 1}`,
                    value: message
                });
        });
    return texts;
}
