// Public entry of @itrms/vehicles for API processes (code-structure.md §4): the NestJS module, the register's command
// service for the case effects of other slices, and the tables (their foreign keys to vehicles).
export { VehiclesModule } from './vehicles.module';
export { VehicleRegistry } from './vehicle-registry.service';
export { VehiclesService } from './vehicles.service';
export * from './vehicles.table';
