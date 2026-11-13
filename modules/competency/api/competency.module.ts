import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { DocumentsModule } from '@itrms/documents/api';
import { FeesModule } from '@itrms/fees/api';
import { FormsModule, RegistryLookups } from '@itrms/forms/api';
import { PartiesModule } from '@itrms/parties/api';
import { VehiclesModule } from '@itrms/vehicles/api';

import { BACK_CAPTURE_EFFECTS } from './back-capture.effects';
import { BackCaptureService } from './back-capture.service';
import { BOLO_EFFECTS } from './bolo.effects';
import { BoloService } from './bolo.service';
import { CompetencyController } from './competency.controller';
import { EXCHANGE_EFFECTS } from './exchange.effects';
import { PlateExchangeService } from './exchange.service';
import { LICENCE_EFFECTS } from './licence.effects';
import { LicencesService } from './licences.service';
import { LicenceLookup, TrainingSchoolLookup } from './lookups';
import { RegisterService } from './register.service';
import { REGISTRATION_EFFECTS } from './registration.effects';
import { VehicleRegistrationService } from './registration.service';

/**
 * Driver licences (task 0.24a): the register, its rules and the effects a licence service's workflow names; and the new vehicle
 * registration service's effects over the vehicle register (task 1.2b); the back-capture of paper vehicle files (task 1.13); the plate exchange (task 1.2c); and the bolo inspection (task 1.3a).
 */
@Module({
    imports: [FormsModule, PartiesModule, DocumentsModule, VehiclesModule, FeesModule],
    controllers: [CompetencyController],
    providers: [
        LicencesService,
        RegisterService,
        VehicleRegistrationService,
        BackCaptureService,
        PlateExchangeService,
        BoloService,
        LicenceLookup,
        TrainingSchoolLookup,
        ...LICENCE_EFFECTS,
        ...REGISTRATION_EFFECTS,
        ...BACK_CAPTURE_EFFECTS,
        ...EXCHANGE_EFFECTS,
        ...BOLO_EFFECTS
    ],
    exports: [LicencesService]
})
export class CompetencyModule implements OnModuleInit {
    constructor(
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups,
        @Inject(LicenceLookup) private readonly licence: LicenceLookup,
        @Inject(TrainingSchoolLookup) private readonly school: TrainingSchoolLookup
    ) {}

    onModuleInit(): void {
        this.lookups.register(this.licence);
        this.lookups.register(this.school);
    }
}
