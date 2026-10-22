// Public entry of @itrms/parties for API processes (code-structure.md §4): the NestJS module, its service for other
// slices, and the tables (other slices' foreign keys to persons and organisations).
export { PartiesModule } from './parties.module';
export { PersonsService, nameKeyOf, searchTextOf } from './persons.service';
export * from './parties.table';
