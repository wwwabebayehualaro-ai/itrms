// The HTTP process (code-structure.md §5.1): NestJS on Fastify with the kernel's problem+json filter and validation pipe.
import 'reflect-metadata';

import { createHttpApp } from '@itrms/kernel/api';

import { AppModule } from './app.module';
import { fail, start } from './start';

async function main() {
    const { config, logger } = start('http');
    try {
        const app = await createHttpApp(AppModule.forRoot(config, logger), config, logger);
        await app.listen({ port: config.PORT, host: config.HOST });
    } catch (error) {
        fail(logger, error);
    }
}

void main();
