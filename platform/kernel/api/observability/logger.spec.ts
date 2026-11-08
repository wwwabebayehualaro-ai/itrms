import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { languageFrom, requestIdFrom, runInContext } from '../context';
import { createLogger, maskSecrets } from './logger';

function capture() {
    const lines: string[] = [];
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            lines.push(chunk.toString());
            callback();
        }
    });
    return { logger: createLogger({ LOG_LEVEL: 'info', process: 'http' }, sink), text: () => lines.join('') };
}

describe('logs', () => {
    it('redact credential headers and keys named like secrets', () => {
        const { logger, text } = capture();
        logger.info({
            req: { headers: { authorization: 'Bearer abc.def', cookie: 'sid=xyz', accept: 'json' } },
            user: { name: 'Abebe', password: 'p4ss', token: 't0k' },
            client_secret: 'cs'
        });
        const out = text();
        expect(out).not.toMatch(/abc\.def|sid=xyz|p4ss|t0k|"cs"/);
        expect(out).toContain('[redacted]');
        expect(out).toContain('Abebe');
    });

    it('redact secret keys at any depth and in any case', () => {
        const { logger, text } = capture();
        logger.info({
            body: { user: { Password: 'deep-1' } },
            err_config: { headers: { Authorization: 'Bearer deep-2' } },
            list: [{ api_key: 'deep-3' }]
        });
        expect(text()).not.toMatch(/deep-1|deep-2|deep-3/);
    });

    it('mask credentials in connection strings: messages, fields, errors and their properties', () => {
        expect(maskSecrets('connect postgres://itrms_app:pa:ss@db:5432/x and redis://:v@lkey@cache')).toBe(
            'connect postgres://***@db:5432/x and redis://***@cache'
        );
        // a password with '/', and a user with '@'
        expect(maskSecrets('postgres://itrms_app:Ab/cd+ef=@db/itrms')).toBe('postgres://***@db/itrms');
        expect(maskSecrets('postgres://user@srv:pw@host/db')).toBe('postgres://***@host/db');
        // JSON text around a URL with a port is left whole
        expect(maskSecrets('{"a":"http://h:80","b":"x@y"}')).toBe('{"a":"http://h:80","b":"x@y"}');
        expect(maskSecrets('see https://example.org/path?e=a@b')).toBe('see https://example.org/path?e=a@b');

        const { logger, text } = capture();
        logger.error({ err: new Error('cannot reach postgres://app:hunter2@db/itrms') }, 'at postgres://a:b@c/d');
        logger.info({ url: 'postgres://u:fieldpw@h/d' }, 'object field');
        let invalid: unknown;
        try {
            new URL('redis://:urlpw@ho st');
        } catch (e) {
            invalid = e;
        }
        logger.error({ err: invalid }, 'an error property');
        expect(text()).not.toMatch(/hunter2|a:b@|fieldpw|urlpw/);
    });

    it('never write a verification token, only its path (security review 0.26c1 A6)', () => {
        const token = 'Ab_cdefghijklmnopqrstu';
        expect(maskSecrets(`GET /api/v1/public/verifications/${token}`)).toBe(
            'GET /api/v1/public/verifications/[redacted]'
        );
        const { logger, text } = capture();
        logger.info({ req: { method: 'GET', url: `/api/v1/public/verifications/${token}` } }, 'incoming request');
        logger.info(`asked /v1/public/verifications/${token}`);
        const out = text();
        expect(out).not.toContain(token);
        expect(out).toContain('/api/v1/public/verifications/[redacted]');
    });

    it('log what was thrown even when it is not an Error', () => {
        const { logger, text } = capture();
        logger.error({ err: 'timeout talking to postgres://a:strpw@db/x' }, 'a string');
        logger.error({ err: null }, 'null');
        logger.error({ err: { reason: 'gone', token: 'objpw' } }, 'an object');
        const out = text();
        expect(out).toContain('timeout talking to postgres://***@db/x');
        expect(out).toContain('"reason":"gone"');
        expect(out).not.toMatch(/strpw|objpw/);
        expect(out.trim().split('\n')).toHaveLength(3);
    });

    it('carry the request id inside a request', () => {
        const { logger, text } = capture();
        runInContext({ requestId: 'r-1', language: 'am' }, () => logger.info('inside'));
        logger.info('outside');
        const [inside, outside] = text().trim().split('\n');
        expect(inside).toContain('"requestId":"r-1"');
        expect(outside).not.toContain('requestId');
    });
});

describe('request context helpers', () => {
    it('pick the language by quality, Amharic by default', () => {
        expect(languageFrom(undefined)).toBe('am');
        expect(languageFrom('fr-FR, de')).toBe('am');
        expect(languageFrom('en-US,en;q=0.9,am;q=0.8')).toBe('en');
        expect(languageFrom('en;q=0.5, am;q=0.9')).toBe('am');
        expect(languageFrom('wal-Latn')).toBe('wal-Latn');
        expect(languageFrom('en;q=0, am')).toBe('am');
    });

    it('keep a safe request id and replace anything else', () => {
        expect(requestIdFrom('4bf92f3577b34da6a3ce929d0e0e4736')).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
        expect(requestIdFrom('a b')).not.toBe('a b');
        expect(requestIdFrom('x'.repeat(65))).toHaveLength(36);
        expect(requestIdFrom(['a', 'b'])).toHaveLength(36);
    });
});

describe('a failed query in the log (follow-up 95)', () => {
    it('keeps the statement and drops its values, wherever the error carries them', () => {
        const { logger, text } = capture();
        // as drizzle-orm's DrizzleQueryError builds it, around node-postgres's error
        const cause = Object.assign(
            new Error('duplicate key value violates unique constraint "persons_fin_index_key"'),
            {
                code: '23505',
                detail: 'Key (fin_index)=(c2VjcmV0LWJsaW5kLWluZGV4) already exists.'
            }
        );
        const failed = Object.assign(
            new Error(
                'Failed query: insert into "parties"."persons" ("name", "fin_index") values ($1, $2)\nparams: Abebe Kebede,c2VjcmV0LWJsaW5kLWluZGV4'
            ),
            { params: ['Abebe Kebede', 'c2VjcmV0LWJsaW5kLWluZGV4'], cause }
        );
        logger.error({ err: failed }, 'request failed');
        const line = text();
        expect(line).toContain('insert into \\"parties\\".\\"persons\\"');
        expect(line).not.toContain('Abebe Kebede');
        expect(line).not.toContain('c2VjcmV0LWJsaW5kLWluZGV4');
        expect(line).toContain('"params":"[redacted]"');
        // node-postgres's error passed on its own (a plain object, as some callers log it): its detail names the value
        logger.error({ err: { code: '23505', detail: cause.detail } }, 'insert refused');
        expect(text()).toContain('Key (fin_index)=([redacted]) already exists.');
        expect(text()).not.toContain('c2VjcmV0LWJsaW5kLWluZGV4');
    });
});

describe('a failed query whose values hold newlines', () => {
    it('drops every line of them, in the message and in the stack', () => {
        const { logger, text } = capture();
        const failed = new Error(
            'Failed query: insert into "workflow"."case_comments" ("body") values ($1)\nparams: first line\nAbebe 0911000000'
        );
        Object.assign(failed, { params: ['first line\nAbebe 0911000000'] });
        logger.error({ err: failed }, 'request failed');
        expect(text()).toContain('case_comments');
        expect(text()).not.toContain('Abebe');
        expect(text()).not.toContain('0911000000');
        expect(text()).toContain('at ');
    });

    it('keeps an AppError’s detail placeholders and masks a violated row', () => {
        const { logger, text } = capture();
        logger.error(
            { err: { code: '23502', detail: 'Failing row contains (1, Abebe, c2VjcmV0).', params: { seconds: 30 } } },
            'x'
        );
        expect(text()).not.toContain('Abebe');
        expect(text()).toContain('"seconds":30');
    });
});
