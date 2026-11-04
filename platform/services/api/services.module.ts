import { Global, Module } from '@nestjs/common';
import { SERVICE_CATALOGUE } from '@itrms/kernel/org';
import { FORM_PUBLISH_GUARD, FormsModule } from '@itrms/forms/api';
import { CasesService, WorkflowModule } from '@itrms/workflow/api';
import { FEE_CASE_PORT, FEE_REQUEST_SOURCE, FeesModule } from '@itrms/fees/api';

import { ServiceFormGuard } from './contracts';
import { ServicesController } from './services.controller';
import { ServicesService } from './services.service';

/**
 * The service catalogue, its versions and overrides, and requests started as cases (task 0.21b). Global because two
 * slices below it ask it through their ports: the kernel's service enablement checks a code against the catalogue
 * (SERVICE_CATALOGUE), and the forms' publication checks a version against the effects' input contracts
 * (FORM_PUBLISH_GUARD, task 0.21d); and the fees' preview reads a request as filing would (FEE_REQUEST_SOURCE, 0.22a).
 */
@Global()
@Module({
    imports: [FormsModule, WorkflowModule, FeesModule],
    controllers: [ServicesController],
    providers: [
        ServicesService,
        ServiceFormGuard,
        { provide: SERVICE_CATALOGUE, useExisting: ServicesService },
        { provide: FORM_PUBLISH_GUARD, useExisting: ServiceFormGuard },
        { provide: FEE_REQUEST_SOURCE, useExisting: ServicesService },
        // the workflow moves a case its payment settles (task 0.22b): bound here, above both slices
        { provide: FEE_CASE_PORT, useExisting: CasesService }
    ],
    exports: [ServicesService, SERVICE_CATALOGUE, FORM_PUBLISH_GUARD, FEE_REQUEST_SOURCE, FEE_CASE_PORT]
})
export class ServicesModule {}
