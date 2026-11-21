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
import { DRIVING_PERMIT_EFFECTS_LIST } from './driving-permit.effects';
import { DrivingPermitService } from './driving-permit.service';
import { EXCHANGE_EFFECTS } from './exchange.effects';
import { PlateExchangeService } from './exchange.service';
import { LICENCE_EFFECTS } from './licence.effects';
import { LicenceHealthService } from './licence-health.service';
import { LICENCE_CAPTURE_EFFECTS_LIST } from './licence-capture.effects';
import { LicenceCaptureService } from './licence-capture.service';
import { LICENCE_RESTRICTION_EFFECTS_LIST } from './licence-restriction.effects';
import { LicenceRestrictionService } from './licence-restriction.service';
import { MEDICAL_EFFECTS_LIST } from './medical.effects';
import { MedicalReportService } from './medical-report.service';
import { LicencesService } from './licences.service';
import { REPLACEMENT_EFFECTS_LIST } from './replacement.effects';
import { ReplacementService } from './replacement.service';
import { MigrationReportController } from './migration-report.controller';
import { MigrationReportService } from './migration-report.service';
import { MigrationSampleController } from './migration-sample.controller';
import { MigrationSamplingService } from './migration-sampling.service';
import { GarageLookup, LicenceLookup, OfficeLookup, ReleasedVehicleLookup, TrainingSchoolLookup } from './lookups';
import { RegisterService } from './register.service';
import { REGISTRATION_EFFECTS } from './registration.effects';
import { VehicleRegistrationService } from './registration.service';
import { TRANSFER_ARRIVAL_EFFECTS_LIST } from './transfer-arrival.effects';
import { TransferArrivalService } from './transfer-arrival.service';
import { TRANSFER_EFFECTS_LIST } from './transfer.effects';
import { OwnershipTransferService } from './transfer.service';
import { VehicleImportController } from './vehicle-import.controller';
import { VehicleImportService } from './vehicle-import.service';
import { VEHICLE_TRANSFER_EFFECTS_LIST } from './vehicle-transfer.effects';
import { VehicleTransferService } from './vehicle-transfer.service';

/**
 * Driver licences (task 0.24a): the register, its rules and the effects a licence service's workflow names; and the new vehicle
 * registration service's effects over the vehicle register (task 1.2b); the back-capture of paper vehicle files (task 1.13) and their bulk import (task 1.13b) with its sampling QA (task 1.13g); the plate exchange (task 1.2c); the ownership transfer (task 1.4b); the transfer of a vehicle between offices (task 1.4c) and the registration of a vehicle arriving from another region (task 1.4c3); and the bolo inspection (tasks 1.3a, 1.3b); the campaign counters over the plate exchange and the bolo season (task 1.13i).
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
        LicenceHealthService,
        MedicalReportService,
        LicenceCaptureService,
        LicenceRestrictionService,
        DrivingPermitService,
        RegisterService,
        VehicleRegistrationService,
        BackCaptureService,
        MigrationSamplingService,
        MigrationReportService,
        CampaignService,
        VehicleImportService,
        PlateExchangeService,
        OwnershipTransferService,
        ReplacementService,
        VehicleTransferService,
        TransferArrivalService,
        BoloService,
        LicenceLookup,
        TrainingSchoolLookup,
        GarageLookup,
        OfficeLookup,
        ReleasedVehicleLookup,
        ...LICENCE_EFFECTS,
        ...MEDICAL_EFFECTS_LIST,
        ...LICENCE_CAPTURE_EFFECTS_LIST,
        ...LICENCE_RESTRICTION_EFFECTS_LIST,
        ...DRIVING_PERMIT_EFFECTS_LIST,
        ...REGISTRATION_EFFECTS,
        ...BACK_CAPTURE_EFFECTS,
        ...EXCHANGE_EFFECTS,
        ...TRANSFER_EFFECTS_LIST,
        ...VEHICLE_TRANSFER_EFFECTS_LIST,
        ...TRANSFER_ARRIVAL_EFFECTS_LIST,
        ...REPLACEMENT_EFFECTS_LIST,
        ...BOLO_EFFECTS
    ],
    exports: [LicencesService, VehicleImportService]
})
export class CompetencyModule implements OnModuleInit {
    constructor(
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups,
        @Inject(LicenceLookup) private readonly licence: LicenceLookup,
        @Inject(TrainingSchoolLookup) private readonly school: TrainingSchoolLookup,
        @Inject(GarageLookup) private readonly garage: GarageLookup,
        @Inject(OfficeLookup) private readonly office: OfficeLookup,
        @Inject(ReleasedVehicleLookup) private readonly releasedVehicle: ReleasedVehicleLookup
    ) {}

    onModuleInit(): void {
        this.lookups.register(this.licence);
        this.lookups.register(this.school);
        this.lookups.register(this.garage);
        this.lookups.register(this.office);
        this.lookups.register(this.releasedVehicle);
    }
}
