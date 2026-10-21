/**
 * The application: the kernel plus the enabled slices (code-structure.md §5.1). The manifest loader checks every installed
 * manifest first; a broken one stops the start with a message naming the module and the problem.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { KernelModule, loadSlices, type Logger } from '@itrms/kernel/api';
import type { KernelConfig } from '@itrms/kernel/config';

import { SLICES, type ApiSlice } from './slices';

@Module({})
export class AppModule {
    static forRoot(config: KernelConfig, logger: Logger, slices: readonly ApiSlice[] = SLICES): DynamicModule {
        const { manifests, modules } = loadSlices(slices, { disabled: config.MODULES_DISABLED });
        logger.info({ modules: manifests.map((m) => m.key) }, 'modules loaded');
        return { module: AppModule, imports: [KernelModule.forRoot(config, logger), ...modules] };
    }
}
