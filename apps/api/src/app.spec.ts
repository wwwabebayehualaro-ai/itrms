import { Writable } from 'node:stream';

import {
    createHttpApp,
    createLogger,
    createWorkerContext,
    ManifestError,
    Metrics,
    notReplayableHandlers
} from '@itrms/kernel/api';
import { loadConfig } from '@itrms/kernel/config';
import { defineModule } from '@itrms/module-sdk';
import { describe, expect, it } from 'vitest';

import { AppModule } from './app.module';
import { SLICES } from './slices';

/** No database is reached in these tests: the pool connects only when a query runs. */
const DB = { DATABASE_URL: 'postgres://itrms_app@localhost:5432/itrms' };

const quiet = new Writable({ write: (_chunk, _encoding, callback) => callback() });

describe('POSTs kept out of the idempotency records (@NotReplayable)', () => {
    it('are only the reviewed reads whose answer or request holds sensitive values in clear', () => {
        // the slices are loaded by the import of SLICES above; each entry here is reviewed with its handler
        expect(SLICES.length).toBeGreaterThan(0);
        expect(notReplayableHandlers()).toEqual([
            // confirming an upload: checked against the object outside a transaction, and safe to repeat by its state
            'FilesController.confirm',
            // the duplicate check and the FIN/phone lookup: a sensitive value in the request
            'PersonsController.duplicates',
            'PersonsController.lookup',
            // the sensitive fields in clear in the answer
            'PersonsController.reveal',
            // a file of submissions' answers (personal data) in the answer; the export itself is an audited event
            'SubmissionsController.export',
            // a read sent as POST (the query is a document): its answer holds submissions' answers (personal data)
            'SubmissionsController.query'
        ]);
    });
});

describe('the API', () => {
    it('starts as the HTTP process, answers health and an unknown route as problem+json', async () => {
        const config = loadConfig('http', DB);
        const logger = createLogger(config, quiet);
        const app = await createHttpApp(AppModule.forRoot(config, logger), config, logger);
        await app.listen({ port: 0, host: '127.0.0.1' });
        try {
            const base = await app.getUrl();
            const health = await fetch(`${base}/healthz`);
            expect(health.status).toBe(200);
            expect(health.headers.get('x-request-id')).toBeTruthy();
            const missing = await fetch(`${base}/no-such-route`, { headers: { 'accept-language': 'en' } });
            expect(missing.status).toBe(404);
            expect(missing.headers.get('content-type')).toBe('application/problem+json; charset=utf-8');
            expect(await missing.json()).toMatchObject({ code: 'not_found', status: 404, title: 'Not found.' });
        } finally {
            await app.close();
        }
    });

    it('starts as the worker, with the same modules and no HTTP server', async () => {
        const config = loadConfig('worker', DB);
        const logger = createLogger(config, quiet);
        const context = await createWorkerContext(AppModule.forRoot(config, logger), logger);
        try {
            expect(context.get(Metrics)).toBeInstanceOf(Metrics);
            expect('getHttpAdapter' in context).toBe(false);
        } finally {
            await context.close();
        }
    });
});

describe('the installed modules', () => {
    it('pass the manifest checks', () => {
        const config = loadConfig('worker', DB);
        expect(() => AppModule.forRoot(config, createLogger(config, quiet))).not.toThrow();
    });

    it('stop the start on a broken manifest, naming the module and the problem', () => {
        const config = loadConfig('http', DB);
        const logger = createLogger(config, quiet);
        const broken = defineModule({
            key: 'freight',
            layer: 'work-process',
            version: '1.0.0',
            title: { am: 'ጭነት', en: 'Freight' },
            workProcess: 3,
            dependsOn: ['kernel', 'drivers'],
            effects: ['freight.issuePermit']
        });
        expect(() => AppModule.forRoot(config, logger, { slices: [...SLICES, { manifest: broken }] })).toThrow(
            /The installed modules cannot start:\n- freight: depends on "drivers", which is not installed\n- freight: effect "freight.issuePermit" is declared but not implemented/
        );
        expect(() => AppModule.forRoot(loadConfig('http', { ...DB, MODULES_DISABLED: 'kernel' }), logger)).toThrow(
            ManifestError
        );
    });
});
