/**
 * @itrms/kernel/config: each process validates its own configuration at startup (code-structure.md §5.1). The schema has
 * one variant per entry point, and a process refuses the secrets that belong to another: `http` never receives the system
 * pool or the document-signing key, so a leak of the HTTP process cannot use them. Values are never echoed in errors.
 */
import { isIP } from 'node:net';

import { z } from 'zod';

import { parseFieldKeys } from '../crypto/field-crypto';

export const PROCESSES = ['http', 'worker', 'migrate'] as const;
export type ProcessKind = (typeof PROCESSES)[number];

/** Secrets only some processes may hold, and who may hold them. */
const RESTRICTED: Record<string, readonly ProcessKind[]> = {
    // the itrms_system pool (BYPASSRLS): only the worker, never the HTTP process
    DATABASE_SYSTEM_URL: ['worker'],
    // the migration owner: only the migrate process
    DATABASE_MIGRATE_URL: ['migrate'],
    // only worker-documents (task 0.23)
    DOCUMENT_SIGNING_KEY: [],
    // the identity-admin service account: the worker's sync (outbox, task 0.11) and the seed, never the HTTP process
    KEYCLOAK_ADMIN_CLIENT_SECRET: ['worker', 'migrate'],
    // libpq's own variables would hand every pool the same role behind the DATABASE_* URLs' backs: use the URLs
    ...Object.fromEntries(
        ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE', 'PGSERVICE', 'PGPASSFILE'].map((k) => [k, []])
    )
};

const common = {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    /** Installed modules switched off in this installation (comma-separated keys); the kernel cannot be. */
    MODULES_DISABLED: z
        .string()
        .default('')
        .transform((v) =>
            v
                .split(',')
                .map((k) => k.trim())
                .filter(Boolean)
        )
        .pipe(z.array(z.string().regex(/^[a-z][a-z0-9-]*$/, 'expected module keys')))
};

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

/** Keycloak's administration, for mirroring org units as groups (`@itrms/kernel/iam` IdentityAdmin); unset: no sync. */
const identityAdmin = {
    KEYCLOAK_URL: z.url({ protocol: /^https?$/ }).optional(),
    KEYCLOAK_REALM: z.string().min(1).default('itrms'),
    KEYCLOAK_ADMIN_CLIENT_ID: z.string().min(1).default('itrms-identity-admin'),
    KEYCLOAK_ADMIN_CLIENT_SECRET: z.string().min(16, 'must be at least 16 characters').optional()
};

/**
 * The key masked audit columns are HMAC'd with (personal data proves a change without being stored). Without one they are
 * written as "[masked]"; the installation sets one before the first table with masked columns (task 0.14).
 */
const auditKey = z.string().min(32, 'must be at least 32 characters').optional();

/**
 * Sensitive personal fields (security.md §11, task 0.14): the key-encryption keys, `id:base64` of 32 bytes each, the
 * first wrapping new data keys; and the separate key of the blind indexes. Without them nothing sensitive can be written.
 */
const fieldKeys = {
    FIELD_KEYS: z
        .string()
        .refine((v) => {
            try {
                parseFieldKeys(v);
                return true;
            } catch {
                return false;
            }
        }, 'expected id:base64 entries of 32-byte keys, each id once')
        .optional(),
    BLIND_INDEX_KEY: z.string().min(32, 'must be at least 32 characters').optional()
};

/**
 * Personal data is never written unprotected in production (SEC-PD-1, SEC-PD-2), and each key has one purpose: the audit
 * log's masking and the blind indexes never share a key (an index would then match an audit mask).
 */
function personalDataKeys(
    c: { NODE_ENV: string; AUDIT_HMAC_KEY?: string; FIELD_KEYS?: string; BLIND_INDEX_KEY?: string },
    ctx: z.RefinementCtx
) {
    if (c.NODE_ENV === 'production') {
        for (const key of ['AUDIT_HMAC_KEY', 'FIELD_KEYS', 'BLIND_INDEX_KEY'] as const)
            if (c[key] === undefined)
                ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
    }
    if (c.BLIND_INDEX_KEY !== undefined && c.BLIND_INDEX_KEY === c.AUDIT_HMAC_KEY)
        ctx.addIssue({ code: 'custom', path: ['BLIND_INDEX_KEY'], message: 'must differ from AUDIT_HMAC_KEY' });
}

/** "10.0.0.5", "10.0.0.0/8", "::1", "fd00::/8". */
function isAddressOrRange(value: string): boolean {
    const [address = '', bits, extra] = value.split('/');
    const family = isIP(address);
    if (!family || extra !== undefined) return false;
    if (bits === undefined) return true;
    const n = Number(bits);
    return /^\d{1,3}$/.test(bits) && n <= (family === 4 ? 32 : 128);
}

const schemas = {
    http: z
        .object({
            ...common,
            /** The API's pool: role itrms_app, subject to RLS. */
            DATABASE_URL: postgresUrl,
            AUDIT_HMAC_KEY: auditKey,
            ...fieldKeys,
            PORT: z.coerce.number().int().min(1).max(65535).default(4000),
            HOST: z.string().min(1).default('127.0.0.1'),
            /**
             * The proxies (Nginx) whose X-Forwarded-For and X-Request-Id are believed: comma-separated addresses or CIDR ranges.
             * Empty: none, the peer address is the client. Never "trust all": a client could then choose its own address.
             */
            TRUSTED_PROXIES: z
                .string()
                .default('')
                .transform((v) =>
                    v
                        .split(',')
                        .map((p) => p.trim())
                        .filter(Boolean)
                )
                .pipe(z.array(z.string().refine(isAddressOrRange, 'expected IP addresses or CIDR ranges'))),
            /** Request bodies above this many bytes are refused (413). */
            BODY_LIMIT: z.coerce.number().int().min(1024).default(1_048_576),
            /**
             * The Keycloak realm whose access tokens the API accepts (`…/realms/itrms`). Without it nobody can sign in, which
             * only development and tests may run with.
             */
            OIDC_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
            /** The audience the API's tokens carry. */
            OIDC_AUDIENCE: z.string().min(1).default('itrms-api'),
            /** The realm's keys when the API reaches Keycloak by another address than the issuer (the Compose network). */
            OIDC_JWKS_URL: z.url({ protocol: /^https?$/ }).optional()
        })
        .superRefine(personalDataKeys)
        .refine((c) => c.NODE_ENV !== 'production' || c.OIDC_ISSUER !== undefined, {
            path: ['OIDC_ISSUER'],
            message: 'is required in production'
        })
        // the realm's keys decide every signature: never fetched over plain HTTP in production
        .refine(
            (c) =>
                c.NODE_ENV !== 'production' ||
                [c.OIDC_ISSUER, c.OIDC_JWKS_URL].every((u) => u === undefined || u.startsWith('https://')),
            { path: ['OIDC_JWKS_URL'], message: 'must be https in production' }
        ),
    worker: z
        .object({
            ...common,
            /** The worker's request-like work: role itrms_app. */
            DATABASE_URL: postgresUrl,
            AUDIT_HMAC_KEY: auditKey,
            ...fieldKeys,
            /** The system pool (role itrms_system, BYPASSRLS): outbox relay and sweeps (task 0.11). */
            DATABASE_SYSTEM_URL: postgresUrl.optional(),
            /** The queues' Valkey (BullMQ): with the system pool, the worker relays and runs the outbox. */
            VALKEY_QUEUES_URL: z.url({ protocol: /^rediss?$/ }).optional(),
            ...identityAdmin
        })
        .superRefine(personalDataKeys),
    migrate: z.object({
        ...common,
        /** The migration owner: role itrms_owner. */
        DATABASE_MIGRATE_URL: postgresUrl,
        ...identityAdmin
    })
};

export type HttpConfig = z.infer<typeof schemas.http> & { process: 'http' };
export type WorkerConfig = z.infer<typeof schemas.worker> & { process: 'worker' };
export type MigrateConfig = z.infer<typeof schemas.migrate> & { process: 'migrate' };
export type KernelConfig = HttpConfig | WorkerConfig | MigrateConfig;
type ConfigOf<P extends ProcessKind> = Extract<KernelConfig, { process: P }>;

/** A configuration the process cannot start with. The message names every problem, never a value. */
export class ConfigError extends Error {
    constructor(
        readonly processKind: ProcessKind,
        readonly problems: string[]
    ) {
        super(`Invalid configuration for the ${processKind} process:\n${problems.map((p) => `- ${p}`).join('\n')}`);
        this.name = 'ConfigError';
    }
}

/** Reads and checks the environment for one process; throws a ConfigError listing every problem. */
export function loadConfig<P extends ProcessKind>(
    processKind: P,
    env: Record<string, string | undefined> = process.env
): ConfigOf<P> {
    const problems: string[] = [];
    for (const [key, allowed] of Object.entries(RESTRICTED)) {
        if (env[key] !== undefined && !allowed.includes(processKind))
            problems.push(`${key}: must not be set for the ${processKind} process`);
    }
    const parsed = schemas[processKind].safeParse(env);
    if (!parsed.success)
        // the issue message only, never the received value (it may be a secret)
        problems.push(...parsed.error.issues.map((i) => `${i.path.join('.') || '(environment)'}: ${i.message}`));
    if (problems.length || !parsed.success) throw new ConfigError(processKind, problems);
    return { ...parsed.data, process: processKind } as ConfigOf<P>;
}
