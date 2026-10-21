import { Writable } from 'node:stream';

import { Controller, Get, Module, type DynamicModule } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { createHttpApp } from '../bootstrap';
import { loadConfig } from '../config';
import { KernelModule } from '../kernel.module';
import { createLogger } from '../observability/logger';
import { Public, Require, type Authenticator, type Principal } from './access';

@Controller('guarded')
class GuardedController {
    @Get('read')
    @Require('thing:read')
    read() {
        return { ok: true };
    }

    @Get('open')
    @Public()
    open() {
        return { ok: true };
    }
}

@Controller('unmarked')
class UnmarkedController {
    @Get()
    forgotten() {
        return { ok: true };
    }
}

async function appWith(controllers: (new (...args: never[]) => object)[], authenticator?: Authenticator) {
    const config = loadConfig('http', { DATABASE_URL: 'postgres://itrms_app@localhost:5432/itrms' });
    const logger = createLogger(config, new Writable({ write: (_c, _e, done) => done() }));
    @Module({ controllers })
    class Root {}
    const root: DynamicModule = { module: Root, imports: [KernelModule.forRoot(config, logger, { authenticator })] };
    const app = await createHttpApp(root, config, logger);
    await app.init();
    return app;
}

const principal = (permissions: string[]): Principal => ({
    userId: '0199f0a0-0000-7000-8000-000000000001',
    unitId: '0199f0a0-0000-7000-8000-000000000002',
    regionId: '0199f0a0-0000-7000-8000-000000000003',
    scopePath: 'u1.u2',
    roles: ['tester'],
    permissions: new Set(permissions)
});

describe('access (SEC-AC-1)', () => {
    it('refuses to start with a handler that has neither @Require nor @Public', async () => {
        await expect(appWith([UnmarkedController])).rejects.toThrow(/UnmarkedController\.forgotten/);
    });

    it('answers 401 to every @Require route while no one can sign in, and serves @Public routes', async () => {
        const app = await appWith([GuardedController]);
        const inject = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
        try {
            expect((await inject({ method: 'GET', url: '/guarded/read' })).statusCode).toBe(401);
            expect((await inject({ method: 'GET', url: '/guarded/open' })).statusCode).toBe(200);
            expect((await inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
        } finally {
            await app.close();
        }
    });

    it('checks the permission the caller holds in the active unit', async () => {
        let caller: Principal | undefined = principal(['other:read']);
        const app = await appWith([GuardedController], { authenticate: () => Promise.resolve(caller) });
        const inject = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
        try {
            const denied = await inject({ method: 'GET', url: '/guarded/read' });
            expect(denied.statusCode).toBe(403);
            expect(denied.json()).toMatchObject({ code: 'forbidden' });
            caller = principal(['thing:read']);
            expect((await inject({ method: 'GET', url: '/guarded/read' })).statusCode).toBe(200);
        } finally {
            await app.close();
        }
    });

    it('accepts only resource:action permissions', () => {
        expect(() => Require('org_unit:read')).toThrow(/not a resource:action/);
        expect(() => Require('thing:read', { recentAuth: 0 })).toThrow(/recentAuth/);
    });
});
