/**
 * The application: the kernel plus the enabled slices (code-structure.md §5.1). The manifest loader checks every installed
 * manifest first; a broken one stops the start with a message naming the module and the problem. The entry passes the
 * process's database (none for the OpenAPI writer and the tests that need no data).
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { KernelModule, loadSlices, type Logger } from '@itrms/kernel/api';
import { rolePermissions } from '@itrms/kernel/iam';
import type { KernelConfig } from '@itrms/kernel/config';
import type { Database } from '@itrms/kernel/db';

import { SLICES, type ApiSlice } from './slices';

export interface AppOptions {
    database?: Database;
    slices?: readonly ApiSlice[];
}

@Module({})
export class AppModule {
    static forRoot(
        config: KernelConfig,
        logger: Logger,
        { database, slices = SLICES }: AppOptions = {}
    ): DynamicModule {
        const { manifests, modules, messages } = loadSlices(slices, { disabled: config.MODULES_DISABLED });
        logger.info({ modules: manifests.map((m) => m.key) }, 'modules loaded');
        const identity =
            config.process === 'http' && config.OIDC_ISSUER
                ? { issuer: config.OIDC_ISSUER, audience: config.OIDC_AUDIENCE, jwksUrl: config.OIDC_JWKS_URL }
                : undefined;
        return {
            module: AppModule,
            imports: [
                KernelModule.forRoot(config, logger, {
                    database,
                    identity,
                    roles: rolePermissions(manifests),
                    shell: { manifests, messages }
                }),
                ...modules
            ]
        };
    }
}
