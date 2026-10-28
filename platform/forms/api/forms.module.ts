import { Module } from '@nestjs/common';

import { DraftsService } from './drafts.service';
import { ExportsService } from './exports.service';
import {
    DraftsController,
    ExportsController,
    FormsController,
    PublicationsController,
    SavedViewsController,
    SubmissionsController
} from './forms.controller';
import { FormsService } from './forms.service';
import { RegistryLookups } from './lookups';
import { RegistryLookupsController } from './lookups.controller';
import { SubmissionQueryService } from './query.service';
import { SubmissionsService } from './submissions.service';
import { SavedViewsService } from './views.service';

/**
 * Form definitions, versions, publications and submissions (task 0.16a), the queries over them (0.16b), saved views,
 * history and direct exports (0.16d), and background exports (0.16e). Registry lookups (0.18): registries register their providers in RegistryLookups.
 */
@Module({
    controllers: [
        FormsController,
        PublicationsController,
        SubmissionsController,
        SavedViewsController,
        ExportsController,
        DraftsController,
        RegistryLookupsController
    ],
    providers: [
        FormsService,
        SubmissionsService,
        SubmissionQueryService,
        SavedViewsService,
        ExportsService,
        DraftsService,
        RegistryLookups
    ],
    exports: [FormsService, SubmissionsService, SubmissionQueryService, RegistryLookups]
})
export class FormsModule {}
