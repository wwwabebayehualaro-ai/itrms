/**
 * What a stored form (`form_config.fields`) is made of, as TypeScript types. Lenient on purpose: forms saved by older builders
 * carry more keys (PrimeReact props, editor metadata), and every key is kept when a form is read and written back. Validation
 * of the shape is `storedFieldSchema` (schema.ts).
 */
import type { VisibilityCondition } from './conditions';
import type { FieldOptionsBinding, FieldRowsBinding } from './runtime';
import { LANGUAGE_TAG } from '../i18n';
import { DEFAULT_FORM_TEXT_LANGUAGE, type FormText } from './text';

/** Something a field does on an event (see the form engine's renderer/actions.ts). */
export type Action = {
    type: 'navigate' | 'apiCall' | 'stateUpdate' | 'event' | 'custom' | 'componentMethod' | 'setValue' | 'refetch';
    target?: string;
    payload?: unknown;
    onSuccess?: Action[];
    onError?: Action[];
    meta?: { newTab?: string | boolean; [key: string]: unknown };
    conditions?: VisibilityCondition[];
};

/** One stored field. */
export interface FormField {
    /** The field's key: its name in submitted data, rules and formulas. */
    id: string;
    /** Stable type name, looked up in the field kit. */
    type: string;
    /** One text for every language, or a map by language (forms/text.ts). */
    label?: FormText;
    /** `Input` (holds a value), `Layout` (a container), `Data` (shows data). */
    category?: string;
    /** The container it sits in (none: the top level). */
    parentId?: string | null;
    /** Settings of the type (placeholder, options, min, ...), plus `required`, `span`, `helpText`, `disabled`. */
    props: Record<string, unknown>;
    data?: {
        /** Settings from the palette of older builders (props win over them). */
        defaultProps?: Record<string, unknown>;
        dataSource?: { staticData?: unknown[]; [key: string]: unknown };
        optionsBinding?: FieldOptionsBinding;
        rowsBinding?: FieldRowsBinding;
        computed?: { expression: string; readOnly?: boolean };
        [key: string]: unknown;
    };
    behavior?: {
        validation?: {
            supported?: boolean;
            types?: string[];
            rules?: {
                minLength?: number;
                maxLength?: number;
                min?: number;
                max?: number;
                pattern?: string;
                patternMessage?: string;
                [key: string]: unknown;
            };
            errorMessages?: Record<string, FormText>;
            /** Valid only when this data source's lookup (which reads the field) succeeded; its error is the field's message. */
            remote?: { dataSourceId: string; message?: FormText };
            /** Required only while this formula holds (task 0.17b). */
            requiredWhen?: { expression: string };
            /** Formulas that must hold, each with its message (task 0.17b). */
            validWhen?: { expression: string; message?: FormText }[];
            [key: string]: unknown;
        };
        visibilityConditions?: VisibilityCondition[];
        enabledConditions?: VisibilityCondition[];
        actions?: Record<string, Action[]>;
        [key: string]: unknown;
    };
    layout?: {
        options?: { isContainer?: boolean; acceptsChildren?: string[]; [key: string]: unknown };
        [key: string]: unknown;
    };
    metadata?: { description?: string; [key: string]: unknown };
    /** Only these roles see the field (on screen and in exports). */
    visibleToRoles?: string[];
    /** A published key taken out of the form: kept (its old answers stay readable), but never shown, taken or checked. */
    removed?: boolean | null;
    [key: string]: unknown;
}

/** The stored fields of a `form_config` in either shape: `{ fields, runtime }`, or the bare list older builders saved. */
export function storedFieldsOf(formConfig: unknown): FormField[] {
    if (Array.isArray(formConfig)) return formConfig as FormField[];
    const fields = (formConfig as { fields?: unknown } | null | undefined)?.fields;
    return Array.isArray(fields) ? (fields as FormField[]) : [];
}

/** A template's attached files (`file_relations`), a list; anything else holds none. */
export const fileRelationsOf = (relations: unknown): unknown[] => (Array.isArray(relations) ? relations : []);

/** The language the form's plain-string texts are written in: its `textLanguage`, else Amharic. */
export function textLanguageOf(formConfig: unknown): string {
    const tag = Array.isArray(formConfig)
        ? undefined
        : (formConfig as { textLanguage?: unknown } | null | undefined)?.textLanguage;
    return typeof tag === 'string' && LANGUAGE_TAG.test(tag) ? tag : DEFAULT_FORM_TEXT_LANGUAGE;
}
