/**
 * @itrms/kernel/config: each process validates its own configuration at startup (code-structure.md §5.1). The schema has
 * one variant per entry point, and a process refuses the secrets that belong to another: `http` never receives the system
 * pool or the document-signing key, so a leak of the HTTP process cannot use them. Values are never echoed in errors.
 */
import { isIP } from 'node:net';

import { z } from 'zod';

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

/**
 * The key masked audit columns are HMAC'd with (personal data proves a change without being stored). Without one they are
 * written as "[masked]"; the installation sets one before the first table with masked columns (task 0.14).
 */
const auditKey = z.string().min(32, 'must be at least 32 characters').optional();

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
    http: z.object({
        ...common,
        /** The API's pool: role itrms_app, subject to RLS. */
        DATABASE_URL: postgresUrl,
        AUDIT_HMAC_KEY: auditKey,
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
        BODY_LIMIT: z.coerce.number().int().min(1024).default(1_048_576)
    }),
    worker: z.object({
        ...common,
        /** The worker's request-like work: role itrms_app. */
        DATABASE_URL: postgresUrl,
        AUDIT_HMAC_KEY: auditKey,
        /** The system pool (role itrms_system, BYPASSRLS): outbox relay and sweeps (task 0.11). */
        DATABASE_SYSTEM_URL: postgresUrl.optional()
    }),
    migrate: z.object({
        ...common,
        /** The migration owner: role itrms_owner. */
        DATABASE_MIGRATE_URL: postgresUrl
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
