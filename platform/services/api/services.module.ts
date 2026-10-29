import { Global, Module } from '@nestjs/common';
import { SERVICE_CATALOGUE } from '@itrms/kernel/org';
import { WorkflowModule } from '@itrms/workflow/api';

import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

/**
 * The service catalogue, its versions and overrides, and requests started as cases (task 0.21b). Global for one reason:
 * the kernel's service enablement checks a code against the catalogue through its port (SERVICE_CATALOGUE), and the
 * kernel cannot import this slice.
 */
@Global()
@Module({
    imports: [WorkflowModule],
    controllers: [ServicesController],
    providers: [ServicesService, { provide: SERVICE_CATALOGUE, useExisting: ServicesService }],
    exports: [ServicesService, SERVICE_CATALOGUE]
})
export class ServicesModule {}
