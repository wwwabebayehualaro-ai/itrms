import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { DocumentsModule } from '@itrms/documents/api';
import { FormsModule, RegistryLookups } from '@itrms/forms/api';
import { PartiesModule } from '@itrms/parties/api';
import { VehiclesModule } from '@itrms/vehicles/api';

import { CompetencyController } from './competency.controller';
import { LICENCE_EFFECTS } from './licence.effects';
import { LicencesService } from './licences.service';
import { LicenceLookup, TrainingSchoolLookup } from './lookups';
import { RegisterService } from './register.service';
import { REGISTRATION_EFFECTS } from './registration.effects';
import { VehicleRegistrationService } from './registration.service';

/**
 * Driver licences (task 0.24a): the register, its rules and the effects a licence service's workflow names; and the new vehicle
 * registration service's effects over the vehicle register (task 1.2b).
 */
@Module({
    imports: [FormsModule, PartiesModule, DocumentsModule, VehiclesModule],
    controllers: [CompetencyController],
    providers: [
        LicencesService,
        RegisterService,
        VehicleRegistrationService,
        LicenceLookup,
        TrainingSchoolLookup,
        ...LICENCE_EFFECTS,
        ...REGISTRATION_EFFECTS
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
