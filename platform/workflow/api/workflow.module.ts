import { Module } from '@nestjs/common';
import { FormsModule } from '@itrms/forms/api';

import { CasesController } from './cases.controller';
import { CasesService } from './cases.service';
import { WorkflowDefinitionsController } from './definitions.controller';
import { WorkflowDefinitionsService } from './definitions.service';

/**
 * Workflow definitions and their checks (task 0.19a); cases, tasks and transitions join in 0.19b. A definition's step
 * forms are looked up through the forms slice; its effects through the kernel's effect registry.
 */
@Module({
    imports: [FormsModule],
    controllers: [WorkflowDefinitionsController, CasesController],
    providers: [WorkflowDefinitionsService, CasesService],
    exports: [WorkflowDefinitionsService, CasesService]
})
export class WorkflowModule {}
