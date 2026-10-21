// `pnpm openapi`: writes the API contract to packages/api-client/openapi.json (the API client generates its types from it).
import 'reflect-metadata';

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildOpenApiDocument, serializeOpenApi } from './openapi';

const target = join(__dirname, '..', '..', '..', 'packages', 'api-client', 'openapi.json');
buildOpenApiDocument()
    .then((document) => {
        writeFileSync(target, serializeOpenApi(document));
        console.warn(`wrote ${target}`);
    })
    .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
    });
