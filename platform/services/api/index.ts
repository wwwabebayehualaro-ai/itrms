// Public entry of @itrms/services for API processes (code-structure.md §4): the NestJS module, the service for other
// slices, the pure configuration functions and the tables (task 0.21b).
export { ServicesModule } from './services.module';
export {
    ServicesService,
    importCatalogue,
    addisToday,
    type ServiceSummary,
    type VersionOut,
    type PublishOut
} from './services.service';
export * from './configuration';
export * from './services.table';
