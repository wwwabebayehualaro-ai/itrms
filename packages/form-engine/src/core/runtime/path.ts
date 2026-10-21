/** Safe path access shared by the binding and formula engines: prototype-polluting keys are never traversed. */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);

export const isForbiddenKey = (k: string) => FORBIDDEN.has(k);

/** `String(v)` of a value from form data or a response, exactly as JavaScript writes it (an object as "[object Object]"). */
export const str = (v: unknown): string => String(v);

/** The same, with null and undefined as empty text. */
export const text = (v: unknown): string => (v === null || v === undefined ? '' : str(v));

export function parsePath(path: string): string[] {
    const parts: string[] = [];
    path.replace(/\[(\d+)\]/g, '.$1')
        .split('.')
        .forEach((p) => {
            const t = p.trim();
            if (t) parts.push(t);
        });
    return parts;
}

export function getByPath(source: unknown, path?: string): unknown {
    if (!path) return source;
    let cur: unknown = source;
    for (const key of parsePath(path)) {
        if (cur === null || cur === undefined || FORBIDDEN.has(key)) return undefined;
        if (typeof cur !== 'object') return undefined;
        cur =
            Object.prototype.hasOwnProperty.call(cur, key) || Array.isArray(cur)
                ? (cur as Record<string, unknown>)[key]
                : undefined;
    }
    return cur;
}
