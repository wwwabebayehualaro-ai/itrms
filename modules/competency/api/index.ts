// Public entry of @itrms/competency (code-structure.md §4): the NestJS module, the effects for the slice's list, the tables and the
// register's service.
export { CompetencyModule } from './competency.module';
export { LICENCE_EFFECTS } from './licence.effects';
export { REGISTRATION_EFFECTS } from './registration.effects';
export { LicencesService } from './licences.service';
export { VehicleRegistrationService, type RegistrationInput } from './registration.service';
export * from './competency.table';
