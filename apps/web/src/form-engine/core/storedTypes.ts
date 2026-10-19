/**
 * What a stored form (`form_config.fields`) is made of, as TypeScript types. Lenient on purpose: forms saved by older builders
 * carry more keys (PrimeReact props, editor metadata), and every key is kept when a form is read and written back. Validation
 * of the shape is `storedFieldSchema` (model.ts); the backend checks the same contract (contracts/form-config.schema.json).
 */
import type { FieldOptionsBinding, FieldRowsBinding } from '../Runtime/types';

/** A rule on values: `field` is a field key or a dotted reference (`data.customer.type`, `user.role`). */
export type { VisibilityCondition } from './conditionTypes';
import type { VisibilityCondition } from './conditionTypes';

/** Something a field does on an event (see renderer/actions.ts). */
export type Action = {
    type: 'navigate' | 'apiCall' | 'stateUpdate' | 'event' | 'custom' | 'componentMethod' | 'setValue' | 'refetch';
    target?: string;
    payload?: any;
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
    label?: string;
    /** `Input` (holds a value), `Layout` (a container), `Data` (shows data). */
    category?: string;
    /** The container it sits in (none: the top level). */
    parentId?: string | null;
    /** Settings of the type (placeholder, options, min, ...), plus `required`, `span`, `helpText`, `disabled`. */
    props: Record<string, any>;
    data?: {
        /** Settings from the palette of older builders (props win over them). */
        defaultProps?: Record<string, any>;
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
            errorMessages?: Record<string, string>;
            /** Valid only when this data source's lookup (which reads the field) succeeded; its error is the field's message. */
            remote?: { dataSourceId: string; message?: string };
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
    [key: string]: unknown;
}
