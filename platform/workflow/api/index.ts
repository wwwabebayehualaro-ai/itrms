// Public entry of @itrms/workflow for API processes (code-structure.md §4): the NestJS module, the definitions service for
// other slices (services, task 0.21), the engine's checks and rules, and the tables.
export { WorkflowModule } from './workflow.module';
export { WorkflowDefinitionsService } from './definitions.service';
export { CasesService, caseConfigSchema, type CaseActor, type CaseConfig } from './cases.service';
export { checkDefinition, CHECK_CODES, type CheckCode, type CheckProblem, type Known } from './engine/check';
export * from './engine/rules';
export * from './workflow.table';
