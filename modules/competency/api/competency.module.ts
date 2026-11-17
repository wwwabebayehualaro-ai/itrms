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
import { CampaignController } from './campaign.controller';
import { CampaignService } from './campaign.service';
import { CompetencyController } from './competency.controller';
import { EXCHANGE_EFFECTS } from './exchange.effects';
import { PlateExchangeService } from './exchange.service';
import { LICENCE_EFFECTS } from './licence.effects';
import { LicencesService } from './licences.service';
import { MigrationReportController } from './migration-report.controller';
import { MigrationReportService } from './migration-report.service';
import { MigrationSampleController } from './migration-sample.controller';
import { MigrationSamplingService } from './migration-sampling.service';
import { GarageLookup, LicenceLookup, TrainingSchoolLookup } from './lookups';
import { RegisterService } from './register.service';
import { REGISTRATION_EFFECTS } from './registration.effects';
import { VehicleRegistrationService } from './registration.service';
import { TRANSFER_EFFECTS_LIST } from './transfer.effects';
import { OwnershipTransferService } from './transfer.service';
import { VehicleImportController } from './vehicle-import.controller';
import { VehicleImportService } from './vehicle-import.service';

/**
 * Driver licences (task 0.24a): the register, its rules and the effects a licence service's workflow names; and the new vehicle
 * registration service's effects over the vehicle register (task 1.2b); the back-capture of paper vehicle files (task 1.13) and their bulk import (task 1.13b) with its sampling QA (task 1.13g); the plate exchange (task 1.2c); the ownership transfer (task 1.4b); and the bolo inspection (tasks 1.3a, 1.3b); the campaign counters over the plate exchange and the bolo season (task 1.13i).
 */
@Module({
    imports: [FormsModule, PartiesModule, DocumentsModule, VehiclesModule, FeesModule],
    controllers: [
        CompetencyController,
        VehicleImportController,
        MigrationSampleController,
        MigrationReportController,
        CampaignController
    ],
    providers: [
        LicencesService,
        RegisterService,
        VehicleRegistrationService,
        BackCaptureService,
        MigrationSamplingService,
        MigrationReportService,
        CampaignService,
        VehicleImportService,
        PlateExchangeService,
        OwnershipTransferService,
        BoloService,
        LicenceLookup,
        TrainingSchoolLookup,
        GarageLookup,
        ...LICENCE_EFFECTS,
        ...REGISTRATION_EFFECTS,
        ...BACK_CAPTURE_EFFECTS,
        ...EXCHANGE_EFFECTS,
        ...TRANSFER_EFFECTS_LIST,
        ...BOLO_EFFECTS
    ],
    exports: [LicencesService, VehicleImportService]
})
export class CompetencyModule implements OnModuleInit {
    constructor(
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups,
        @Inject(LicenceLookup) private readonly licence: LicenceLookup,
        @Inject(TrainingSchoolLookup) private readonly school: TrainingSchoolLookup,
        @Inject(GarageLookup) private readonly garage: GarageLookup
    ) {}

    onModuleInit(): void {
        this.lookups.register(this.licence);
        this.lookups.register(this.school);
        this.lookups.register(this.garage);
    }
}
