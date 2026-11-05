import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { DocumentsModule } from '@itrms/documents/api';
import { FormsModule, RegistryLookups } from '@itrms/forms/api';
import { PartiesModule } from '@itrms/parties/api';

import { CompetencyController } from './competency.controller';
import { LICENCE_EFFECTS } from './licence.effects';
import { LicencesService } from './licences.service';
import { LicenceLookup, TrainingSchoolLookup } from './lookups';
import { RegisterService } from './register.service';

/** Driver licences (task 0.24a): the register, its rules and the effects a licence service's workflow names. */
@Module({
    imports: [FormsModule, PartiesModule, DocumentsModule],
    controllers: [CompetencyController],
    providers: [LicencesService, RegisterService, LicenceLookup, TrainingSchoolLookup, ...LICENCE_EFFECTS],
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
