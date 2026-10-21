/**
 * BFF sessions in Valkey (ADR-0021, security.md §5). The browser holds only the opaque id; Valkey holds the record, sealed
 * with AES-256-GCM, under the id's SHA-256, so a copy of Valkey gives neither the cookies nor the tokens. Two indexes
 * find a person's sessions: by Keycloak session (back-channel logout) and by subject (sign out everywhere).
 */
import { createHash } from 'node:crypto';

import type { Redis } from 'ioredis';

import { open, seal, type Keyring } from './seal';

export interface SessionRecord {
    /** Keycloak's subject: who signed in. */
    sub: string;
    /** Keycloak's session id (`sid`), which back-channel logout names. */
    sid?: string;
    /** The unit the person acts for (`X-Org-Unit`); unset: their default unit. */
    activeUnit?: string;
    /** The double-submit CSRF token (SEC-SE-6). */
    csrf: string;
    /** When the person signed in (ms), for the absolute timeout. */
    createdAt: number;
    accessToken: string;
    /** When the access token expires (ms). */
    accessExpiresAt: number;
    refreshToken?: string;
    /** For Keycloak's end-session endpoint (`id_token_hint`). */
    idToken?: string;
}

/** The commands the store uses (`valkeyKeyValue` maps them to Valkey), so tests can run on a map. */
export interface KeyValue {
    get(key: string): Promise<string | null>;
    /** SET … EX seconds */
    setFor(key: string, value: string, seconds: number): Promise<void>;
    /** SET … EX seconds NX: true when it was set */
    setIfAbsent(key: string, value: string, seconds: number): Promise<boolean>;
    /** SET … EX seconds XX: true when it was set (the key existed) */
    setIfPresent(key: string, value: string, seconds: number): Promise<boolean>;
    del(...keys: string[]): Promise<number>;
    sadd(key: string, ...members: string[]): Promise<number>;
    smembers(key: string): Promise<string[]>;
    expire(key: string, seconds: number): Promise<number>;
}

/** 30 minutes idle, 12 hours absolute (SEC-SE-2). */
export const IDLE_SECONDS = 30 * 60;
export const ABSOLUTE_SECONDS = 12 * 60 * 60;

const hash = (id: string) => createHash('sha256').update(id).digest('base64url');

export class SessionStore {
    constructor(
        private readonly kv: KeyValue,
        private readonly keyring: Keyring,
        private readonly prefix = 'bff'
    ) {}

    private recordKey = (h: string) => `${this.prefix}:s:${h}`;
    private sidKey = (sid: string) => `${this.prefix}:kc:${sid}`;
    private subKey = (sub: string) => `${this.prefix}:sub:${sub}`;

    /** The record, or undefined when missing, unreadable or past the absolute timeout (then it is deleted). */
    async get(id: string, now = Date.now()): Promise<SessionRecord | undefined> {
        const h = hash(id);
        const sealed = await this.kv.get(this.recordKey(h));
        const plain = sealed === null ? undefined : open(this.keyring, sealed, h);
        if (plain === undefined) return undefined;
        const record = JSON.parse(plain) as SessionRecord;
        if (now - record.createdAt >= ABSOLUTE_SECONDS * 1000) {
            await this.delete(id);
            return undefined;
        }
        return record;
    }

    /** The idle timeout from now, never past the absolute one; 0 when the session is over. */
    private ttl(record: SessionRecord, now: number): number {
        const left = Math.floor((record.createdAt + ABSOLUTE_SECONDS * 1000 - now) / 1000);
        return Math.max(0, Math.min(IDLE_SECONDS, left));
    }

    /** Stores a new session (sign-in, a unit switch's new id). */
    async put(id: string, record: SessionRecord, now = Date.now()): Promise<void> {
        const h = hash(id);
        const ttl = this.ttl(record, now);
        if (ttl === 0) return;
        await this.kv.setFor(this.recordKey(h), seal(this.keyring, JSON.stringify(record), h), ttl);
        for (const index of [record.sid && this.sidKey(record.sid), this.subKey(record.sub)]) {
            if (!index) continue;
            await this.kv.sadd(index, h);
            await this.kv.expire(index, ABSOLUTE_SECONDS);
        }
    }

    /**
     * Restarts the idle timeout without writing the record (EXPIRE): a request that read the record never writes back an
     * old copy, and a session deleted meanwhile (sign-out, back-channel logout) stays deleted. False when it is gone.
     */
    async touch(id: string, record: SessionRecord, now = Date.now()): Promise<boolean> {
        const ttl = this.ttl(record, now);
        if (ttl === 0) {
            await this.delete(id);
            return false;
        }
        return (await this.kv.expire(this.recordKey(hash(id)), ttl)) === 1;
    }

    /** Replaces an existing record (after a refresh); never brings back a deleted one. False when it is gone. */
    async update(id: string, record: SessionRecord, now = Date.now()): Promise<boolean> {
        const h = hash(id);
        const ttl = this.ttl(record, now);
        if (ttl === 0) return false;
        return this.kv.setIfPresent(this.recordKey(h), seal(this.keyring, JSON.stringify(record), h), ttl);
    }

    async delete(id: string): Promise<void> {
        await this.kv.del(this.recordKey(hash(id)));
    }

    /** Back-channel logout: every session of that Keycloak session. */
    async deleteByKeycloakSession(sid: string): Promise<number> {
        return this.deleteIndexed(this.sidKey(sid));
    }

    /** Sign out everywhere, and back-channel logout without a `sid`. */
    async deleteBySubject(sub: string): Promise<number> {
        return this.deleteIndexed(this.subKey(sub));
    }

    private async deleteIndexed(index: string): Promise<number> {
        const members = await this.kv.smembers(index);
        const deleted = members.length ? await this.kv.del(...members.map(this.recordKey)) : 0;
        await this.kv.del(index);
        return deleted;
    }

    /** True the first time a key is claimed within `seconds`: a back-channel token's `jti`, a refresh in progress. */
    async claim(key: string, seconds: number): Promise<boolean> {
        return this.kv.setIfAbsent(`${this.prefix}:once:${key}`, '1', seconds);
    }

    async release(key: string): Promise<void> {
        await this.kv.del(`${this.prefix}:once:${key}`);
    }
}

export function valkeyKeyValue(redis: Redis): KeyValue {
    return {
        get: (key) => redis.get(key),
        setFor: async (key, value, seconds) => {
            await redis.set(key, value, 'EX', seconds);
        },
        setIfAbsent: async (key, value, seconds) => (await redis.set(key, value, 'EX', seconds, 'NX')) === 'OK',
        setIfPresent: async (key, value, seconds) => (await redis.set(key, value, 'EX', seconds, 'XX')) === 'OK',
        del: (...keys) => redis.del(...keys),
        sadd: (key, ...members) => redis.sadd(key, ...members),
        smembers: (key) => redis.smembers(key),
        expire: (key, seconds) => redis.expire(key, seconds)
    };
}
