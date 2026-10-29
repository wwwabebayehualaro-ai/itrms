import { Global, Module } from '@nestjs/common';
import { SERVICE_CATALOGUE } from '@itrms/kernel/org';
import { FORM_PUBLISH_GUARD, FormsModule } from '@itrms/forms/api';
import { WorkflowModule } from '@itrms/workflow/api';

import { ServiceFormGuard } from './contracts';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

/**
 * The service catalogue, its versions and overrides, and requests started as cases (task 0.21b). Global because two
 * slices below it ask it through their ports: the kernel's service enablement checks a code against the catalogue
 * (SERVICE_CATALOGUE), and the forms' publication checks a version against the effects' input contracts
 * (FORM_PUBLISH_GUARD, task 0.21d).
 */
@Global()
@Module({
    imports: [FormsModule, WorkflowModule],
    controllers: [ServicesController],
    providers: [
        ServicesService,
        ServiceFormGuard,
        { provide: SERVICE_CATALOGUE, useExisting: ServicesService },
        { provide: FORM_PUBLISH_GUARD, useExisting: ServiceFormGuard }
    ],
    exports: [ServicesService, SERVICE_CATALOGUE, FORM_PUBLISH_GUARD]
})
export class ServicesModule {}
