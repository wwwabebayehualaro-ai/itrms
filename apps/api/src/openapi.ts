/**
 * The API contract (tech-stack T9, T37): the OpenAPI document generated from the Zod schemas of every enabled slice's
 * controllers (nestjs-zod), plus the problem+json body. `pnpm openapi` writes it to packages/api-client/openapi.json,
 * from which the web's types are generated; openapi.spec.ts fails when the committed file has drifted.
 */
import { Writable } from 'node:stream';

import { createHttpApp, createLogger } from '@itrms/kernel/api';
import { loadConfig } from '@itrms/kernel/config';
import { problemSchema } from '@itrms/kernel/errors';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { z } from 'zod';

import { AppModule } from './app.module';

const VERSION = '0.0.0';

/** The problem+json body as a JSON Schema component (OpenAPI 3.1 takes JSON Schema 2020-12 as it is). */
function problemComponent(): Record<string, unknown> {
    const schema = { ...(z.toJSONSchema(problemSchema) as Record<string, unknown>) };
    delete schema.$schema;
    return schema;
}

/** Keys in a stable order, so the file changes only when the contract does. */
function sorted(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sorted);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((k) => [k, sorted((value as Record<string, unknown>)[k])])
    );
}

export async function buildOpenApiDocument(): Promise<OpenAPIObject> {
    // the HTTP process's modules, without listening and without logs: the document is all we want from it
    // no database: the document comes from the modules, and nothing here runs a query
    const config = loadConfig('http', { DATABASE_URL: 'postgres://itrms_app@localhost:5432/itrms' });
    const logger = createLogger({ ...config, LOG_LEVEL: 'silent' }, new Writable({ write: (_c, _e, cb) => cb() }));
    const app = await createHttpApp(AppModule.forRoot(config, logger), config, logger);
    await app.init();
    try {
        const document = SwaggerModule.createDocument(
            app,
            new DocumentBuilder()
                .setTitle('ITRMS API')
                .setDescription(
                    'Integrated Transport and Road Management System. Errors are application/problem+json (Problem).'
                )
                .setVersion(VERSION)
                .setOpenAPIVersion('3.1.0')
                .build()
        );
        const clean = cleanupOpenApiDoc(document, { version: '3.1' });
        clean.components = {
            ...clean.components,
            schemas: {
                ...clean.components?.schemas,
                Problem: problemComponent()
            }
        };
        return clean;
    } finally {
        await app.close();
    }
}

/** The document as committed: sorted keys, two-space indent, a final newline. */
export const serializeOpenApi = (document: OpenAPIObject): string => `${JSON.stringify(sorted(document), null, 2)}\n`;
