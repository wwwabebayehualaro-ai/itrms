/**
 * The BFF's configuration (server only), checked once at first use. Like the API's (`@itrms/kernel/config`), a problem is
 * named without its value: the client secret and the session keys must never reach a log.
 */
import { z } from 'zod';

import { parseKeyring, type Keyring } from './seal';

const httpUrl = z.url({ protocol: /^https?$/ });

const schema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        /** The public origin of the staff app (`https://app.bureau.example`); redirects and the Origin check use it. */
        APP_ORIGIN: httpUrl.transform((u) => new URL(u).origin),
        /** Where the BFF reaches the API (`http://api:4000` in Compose). */
        API_URL: httpUrl.transform((u) => u.replace(/\/+$/, '')),
        /** The Keycloak realm (`…/realms/itrms`). */
        OIDC_ISSUER: httpUrl.transform((u) => u.replace(/\/+$/, '')),
        OIDC_CLIENT_ID: z.string().min(1).default('itrms-web'),
        OIDC_CLIENT_SECRET: z.string().min(16, 'must be at least 16 characters'),
        /** The sessions' Valkey (a separate instance from the queues', architecture §12). */
        SESSION_VALKEY_URL: z.url({ protocol: /^rediss?$/ }),
        /**
         * AES-256-GCM keys for the session records: `id:base64key[,id:base64key…]`, the first one current. Older keys stay
         * listed until every session sealed with them has expired (12 hours), so a key can be rotated without signing
         * everyone out (security.md SEC-CR-3).
         */
        SESSION_KEYS: z.string().min(1)
    })
    .refine(
        (c) => c.NODE_ENV !== 'production' || [c.APP_ORIGIN, c.OIDC_ISSUER].every((u) => u.startsWith('https://')),
        { path: ['APP_ORIGIN'], message: 'the app and the realm must be https in production' }
    );

export type BffConfig = Omit<z.infer<typeof schema>, 'SESSION_KEYS'> & { keyring: Keyring };

export class BffConfigError extends Error {
    constructor(readonly problems: string[]) {
        super(`Invalid BFF configuration:\n${problems.map((p) => `- ${p}`).join('\n')}`);
        this.name = 'BffConfigError';
    }
}

export function loadBffConfig(env: Record<string, string | undefined> = process.env): BffConfig {
    const parsed = schema.safeParse(env);
    if (!parsed.success)
        throw new BffConfigError(
            parsed.error.issues.map((i) => `${i.path.join('.') || '(environment)'}: ${i.message}`)
        );
    const { SESSION_KEYS, ...rest } = parsed.data;
    try {
        return { ...rest, keyring: parseKeyring(SESSION_KEYS) };
    } catch (e) {
        throw new BffConfigError([`SESSION_KEYS: ${(e as Error).message}`]);
    }
}
