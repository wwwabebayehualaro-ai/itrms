/**
 * What a case's printed answers need besides the answers (task 0.21e): the registry records their lookup answers name,
 * so the page asks for their labels once per registry.
 */
import type { CaseOut } from '@/lib/workflow';

/** The registry records the steps' lookup answers name, by registry (a repeating section's rows too). */
export function lookupIds(steps: CaseOut['steps']): Map<string, string[]> {
    const wanted = new Map<string, string[]>();
    for (const s of steps) {
        const fields =
            (s.form as { fields?: { id?: unknown; type?: unknown; props?: unknown }[] } | null)?.fields ?? [];
        const providers = new Map<string, string>();
        for (const f of fields) {
            const provider = (f.props as { provider?: unknown } | null | undefined)?.provider;
            if (f.type === 'RegistryLookup' && typeof f.id === 'string' && typeof provider === 'string')
                providers.set(f.id, provider);
        }
        if (providers.size === 0) continue;
        const collect = (values: Record<string, unknown>) => {
            for (const [key, v] of Object.entries(values)) {
                const provider = providers.get(key);
                if (provider && typeof v === 'string' && v !== '')
                    wanted.set(provider, [...(wanted.get(provider) ?? []), v]);
                else if (Array.isArray(v))
                    for (const row of v)
                        if (row && typeof row === 'object' && !Array.isArray(row))
                            collect(row as Record<string, unknown>);
            }
        };
        collect(s.answers);
    }
    return wanted;
}

/**
 * A request's form as its change is filled in (task 0.21e): without the fields shown masked and what they hold (a Sensitive
 * section's columns), so a form's defaults never stand in for answers the person does not see.
 */
export function amendable(document: unknown, masked: readonly string[]): unknown {
    const fields = (document as { fields?: { id?: unknown; parentId?: unknown }[] } | null)?.fields;
    if (!Array.isArray(fields) || masked.length === 0) return document;
    const out = new Set(masked);
    // a field inside one left out goes with it (stored parent first or not: repeat until nothing more goes)
    for (let grew = true; grew;) {
        grew = false;
        for (const f of fields)
            if (typeof f.id === 'string' && !out.has(f.id) && typeof f.parentId === 'string' && out.has(f.parentId)) {
                out.add(f.id);
                grew = true;
            }
    }
    return { ...(document as object), fields: fields.filter((f) => !(typeof f.id === 'string' && out.has(f.id))) };
}
