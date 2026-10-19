/**
 * The condition shape shared by stored fields (core) and the runtime. It imports nothing, so neither side depends on the
 * other through it (it used to close an import cycle core/storedTypes ↔ Runtime/types; task 0.5 separates them fully).
 */
export type VisibilityCondition = {
    field: string;
    operator:
        | 'eq'
        | 'neq'
        | 'gt'
        | 'lt'
        | 'contains'
        | 'startsWith'
        | 'endsWith'
        | 'empty'
        | 'notEmpty'
        | 'regex'
        | 'gte'
        | 'lte'
        | 'in'
        | 'notIn'
        | 'not';
    value?: any;
    /** How a list combines (read from its first entry): all (default), any, exactly one. */
    logic?: 'and' | 'or' | 'xor';
    /** A group: these conditions together (`operator: 'not'` negates the group). */
    conditions?: VisibilityCondition[];
    clientOnly?: boolean;
    serverOnly?: boolean;
};
