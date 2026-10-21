/**
 * The application: the kernel plus the installed slices (code-structure.md §5.1). The module manifest loader (task 0.6a)
 * registers the slices listed in slices.ts.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { KernelModule, type Logger } from '@itrms/kernel/api';
import type { KernelConfig } from '@itrms/kernel/config';

import { SLICES } from './slices';

@Module({})
export class AppModule {
    static forRoot(config: KernelConfig, logger: Logger): DynamicModule {
        return { module: AppModule, imports: [KernelModule.forRoot(config, logger), ...SLICES] };
    }
}
