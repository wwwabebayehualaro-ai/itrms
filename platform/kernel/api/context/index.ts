/**
 * @itrms/kernel/context: what the code serving a request knows about it, without passing it around: the request id (also
 * the `traceId` of problem bodies and the `X-Request-Id` header), the person's language, and once signed in (tasks 0.8–0.9)
 * the user and the active unit. Kept in AsyncLocalStorage for the whole request.
 */
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

export const LANGUAGES = ['am', 'en', 'wal-Latn'] as const;
export type Language = (typeof LANGUAGES)[number];
/** Amharic is the default language of every installation (i18n-and-languages.md). */
export const DEFAULT_LANGUAGE: Language = 'am';

export interface RequestContext {
    readonly requestId: string;
    readonly language: Language;
    /** Set by authentication (task 0.8). */
    user?: { id: string };
    /** The unit the person acts for (task 0.9). */
    unitId?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The context of the request being served, or undefined outside a request (startup, jobs). */
export const currentContext = (): RequestContext | undefined => storage.getStore();

/** Runs `fn`, and everything it starts, inside `context`. */
export const runInContext = <T>(context: RequestContext, fn: () => T): T => storage.run(context, fn);

// letters, digits and . _ : - (a UUID, a W3C trace id, a proxy's id); anything else is replaced
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

/** The caller's X-Request-Id when it is safe to log and echo, else a new one. */
export function requestIdFrom(header: unknown): string {
    return typeof header === 'string' && REQUEST_ID.test(header) ? header : randomUUID();
}

/** The first supported language in Accept-Language, by quality; Amharic when none is supported. */
export function languageFrom(header: unknown): Language {
    if (typeof header !== 'string' || !header) return DEFAULT_LANGUAGE;
    const ranked = header
        .split(',')
        .map((part, i) => {
            const [tag = '', ...params] = part.trim().split(';');
            const q = params.map((p) => /^\s*q=([\d.]+)\s*$/.exec(p)?.[1]).find(Boolean);
            return { tag: tag.toLowerCase(), q: q === undefined ? 1 : Number(q), i };
        })
        .filter((r) => r.q > 0)
        .sort((a, b) => b.q - a.q || a.i - b.i);
    for (const { tag } of ranked) {
        if (tag === 'am' || tag.startsWith('am-')) return 'am';
        if (tag === 'en' || tag.startsWith('en-')) return 'en';
        if (tag === 'wal' || tag.startsWith('wal-')) return 'wal-Latn';
    }
    return DEFAULT_LANGUAGE;
}
