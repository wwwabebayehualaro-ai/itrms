/**
 * The kernel's HTTP application with test routes, for the kernel's own tests (not exported). Logs go to a buffer the test
 * can read, so a test can assert what was (and was not) logged.
 */
import { Writable } from 'node:stream';

import { Body, Controller, Get, Module, Post, type DynamicModule } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { createHttpApp } from './bootstrap';
import { loadConfig } from './config';
import { currentContext } from './context';
import { ConflictError, RateLimitedError } from './errors';
import { KernelModule } from './kernel.module';
import { createLogger } from './observability/logger';

class CreateThing extends createZodDto(
    z.object({
        name: z.string().min(2),
        count: z.number().int().positive(),
        items: z.array(z.object({ qty: z.number() }))
    })
) {}

@Controller('test')
class TestController {
    @Get('context')
    context() {
        return { requestId: currentContext()?.requestId, language: currentContext()?.language };
    }

    @Post('things')
    create(@Body() body: CreateThing) {
        return { ok: true, name: body.name, requestId: currentContext()?.requestId };
    }

    @Get('conflict')
    conflict(): never {
        throw new ConflictError('stale_version', { detail: 'Version 3 is current.' });
    }

    @Get('limited')
    limited(): never {
        throw new RateLimitedError(30);
    }

    @Get('upstream')
    upstream(): never {
        // what an HTTP client throws when another system answers 401: our failure, not the person's session
        throw Object.assign(new Error('Response status code 401'), {
            name: 'ResponseStatusCodeError',
            statusCode: 401
        });
    }

    @Get('boom')
    boom(): never {
        throw new Error('database password is hunter2 at postgres://app:hunter2@db/itrms');
    }
}

@Module({ controllers: [TestController] })
class TestModule {}

export async function testApp(env: Record<string, string> = { TRUSTED_PROXIES: '127.0.0.1' }) {
    const lines: string[] = [];
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            lines.push(chunk.toString());
            callback();
        }
    });
    const config = loadConfig('http', {
        LOG_LEVEL: 'debug',
        BODY_LIMIT: '2048',
        DATABASE_URL: 'postgres://itrms_app@localhost:5432/itrms',
        ...env
    });
    const logger = createLogger(config, sink);
    const root: DynamicModule = { module: TestModule, imports: [KernelModule.forRoot(config, logger)] };
    const app = await createHttpApp(root, config, logger);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    return {
        app,
        logs: () => lines.join(''),
        inject: app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance())
    };
}
