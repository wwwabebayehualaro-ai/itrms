// Public entry of @itrms/competency (code-structure.md §4): the NestJS module, the effects for the slice's list, the tables and the
// register's service.
export { CompetencyModule } from './competency.module';
export { LICENCE_EFFECTS } from './licence.effects';
export { BACK_CAPTURE_EFFECTS } from './back-capture.effects';
export { BackCaptureService, type BackCaptureInput } from './back-capture.service';
export { BOLO_EFFECTS } from './bolo.effects';
export { BoloService, type BoloInput } from './bolo.service';
export { EXCHANGE_EFFECTS } from './exchange.effects';
export { PlateExchangeService, type ExchangeInput } from './exchange.service';
export { REGISTRATION_EFFECTS } from './registration.effects';
export { LicencesService } from './licences.service';
export { VehicleRegistrationService, type RegistrationInput } from './registration.service';
export * from './competency.table';
export { boloValidity, daysAfter } from './bolo-validity';
