import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from './index';

/** The app pool every HTTP and worker process needs. */
const DB = { DATABASE_URL: 'postgres://itrms_app@db:5432/itrms' };
const SYSTEM_URL = 'postgres://itrms_system:s3cret-value@db:5432/itrms';

describe('loadConfig', () => {
    it('gives each process its defaults', () => {
        expect(loadConfig('http', DB)).toMatchObject({
            process: 'http',
            PORT: 4000,
            HOST: '127.0.0.1',
            TRUSTED_PROXIES: [],
            LOG_LEVEL: 'info'
        });
        expect(loadConfig('worker', { ...DB, DATABASE_SYSTEM_URL: SYSTEM_URL })).toMatchObject({
            process: 'worker',
            DATABASE_SYSTEM_URL: SYSTEM_URL
        });
        expect(
            loadConfig('http', { ...DB, PORT: '8080', TRUSTED_PROXIES: '10.0.0.5, 172.16.0.0/12,::1' })
        ).toMatchObject({
            PORT: 8080,
            TRUSTED_PROXIES: ['10.0.0.5', '172.16.0.0/12', '::1']
        });
    });

    it('requires the personal-data keys in production, for the API and the worker, each key with one purpose', () => {
        const problems = (env: Record<string, string>, kind: 'http' | 'worker') => {
            try {
                loadConfig(kind, env);
                return [];
            } catch (e) {
                return (e as ConfigError).problems;
            }
        };
        expect(problems({ ...DB, NODE_ENV: 'production' }, 'worker')).toEqual([
            'AUDIT_HMAC_KEY: is required in production',
            'FIELD_KEYS: is required in production',
            'BLIND_INDEX_KEY: is required in production'
        ]);
        const key = 'k'.repeat(40);
        expect(problems({ ...DB, AUDIT_HMAC_KEY: key, BLIND_INDEX_KEY: key }, 'http')).toEqual([
            'BLIND_INDEX_KEY: must differ from AUDIT_HMAC_KEY'
        ]);
        expect(problems({ ...DB, FIELD_KEYS: 'k1:dG9vLXNob3J0' }, 'http')).toEqual([
            'FIELD_KEYS: expected id:base64 entries of 32-byte keys, each id once'
        ]);
    });

    it('fails at startup and names every problem', () => {
        let error: unknown;
        try {
            loadConfig('http', { ...DB, PORT: 'eighty', LOG_LEVEL: 'loud' });
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(ConfigError);
        const { problems, message } = error as ConfigError;
        expect(problems.map((p) => p.split(':')[0]).sort()).toEqual(['LOG_LEVEL', 'PORT']);
        expect(message).toContain('Invalid configuration for the http process');
    });

    it('refuses the system pool and the signing key in the HTTP process, without echoing them', () => {
        const attempt = () => loadConfig('http', { DATABASE_SYSTEM_URL: SYSTEM_URL, DOCUMENT_SIGNING_KEY: 'k3y' });
        expect(attempt).toThrow(ConfigError);
        expect(attempt).toThrow(/DATABASE_SYSTEM_URL: must not be set for the http process/);
        expect(attempt).toThrow(/DOCUMENT_SIGNING_KEY: must not be set for the http process/);
        expect(attempt).not.toThrow(/s3cret|k3y/);
        expect(() => loadConfig('migrate', { DATABASE_SYSTEM_URL: SYSTEM_URL })).toThrow(/DATABASE_SYSTEM_URL/);
        expect(() => loadConfig('worker', { DATABASE_MIGRATE_URL: SYSTEM_URL })).toThrow(/DATABASE_MIGRATE_URL/);
    });

    it('never trusts every proxy: only addresses and CIDR ranges', () => {
        for (const value of ['true', 'nginx', '10.0.0.0/33', '10.0.0.1/8/1'])
            expect(() => loadConfig('http', { TRUSTED_PROXIES: value })).toThrow(/TRUSTED_PROXIES/);
    });

    it('refuses libpq’s own variables in every process', () => {
        for (const kind of ['http', 'worker', 'migrate'] as const)
            expect(() => loadConfig(kind, { PGPASSWORD: 'x' })).toThrow(/PGPASSWORD: must not be set/);
    });

    it('asks each process for its own pool', () => {
        expect(() => loadConfig('http', {})).toThrow(/DATABASE_URL/);
        expect(() => loadConfig('worker', {})).toThrow(/DATABASE_URL/);
        expect(() => loadConfig('migrate', {})).toThrow(/DATABASE_MIGRATE_URL/);
        expect(loadConfig('migrate', { DATABASE_MIGRATE_URL: 'postgres://itrms_owner@db/itrms' }).process).toBe(
            'migrate'
        );
    });

    it('refuses a database address that is not PostgreSQL, without echoing it', () => {
        expect(() => loadConfig('worker', { DATABASE_SYSTEM_URL: 'mysql://u:pw@db/x' })).toThrow(/DATABASE_SYSTEM_URL/);
        expect(() => loadConfig('worker', { DATABASE_SYSTEM_URL: 'mysql://u:pw@db/x' })).not.toThrow(/pw@/);
    });
});
