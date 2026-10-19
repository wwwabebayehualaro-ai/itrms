/**
 * Query-key factory: one shape for every resource so invalidation is predictable.
 *
 *   const templateKeys = createKeys('templates');
 *   templateKeys.all           -> ['templates']
 *   templateKeys.lists()       -> ['templates', 'list']            (invalidate every list)
 *   templateKeys.list(filters) -> ['templates', 'list', filters]
 *   templateKeys.detail(id)    -> ['templates', 'detail', id]
 */
export function createKeys<Scope extends string>(scope: Scope) {
    return {
        all: [scope] as const,
        lists: () => [scope, 'list'] as const,
        list: <F extends object | undefined>(filters?: F) => [scope, 'list', filters ?? {}] as const,
        details: () => [scope, 'detail'] as const,
        detail: (id: string) => [scope, 'detail', id] as const
    };
}
