/**
 * A rule on values: `field` is a field key or a dotted reference (`data.customer.type`, `user.role`). Shared by stored fields
 * and the runtime block; it imports nothing.
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
    value?: unknown;
    /** How a list combines (read from its first entry): all (default), any, exactly one. */
    logic?: 'and' | 'or' | 'xor';
    /** A group: these conditions together (`operator: 'not'` negates the group). */
    conditions?: VisibilityCondition[];
    clientOnly?: boolean;
    serverOnly?: boolean;
};
