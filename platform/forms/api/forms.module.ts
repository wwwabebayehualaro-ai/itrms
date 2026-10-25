import { Module } from '@nestjs/common';

import { ExportsService } from './exports.service';
import {
    ExportsController,
    FormsController,
    PublicationsController,
    SavedViewsController,
    SubmissionsController
} from './forms.controller';
import { FormsService } from './forms.service';
import { SubmissionQueryService } from './query.service';
import { SubmissionsService } from './submissions.service';
import { SavedViewsService } from './views.service';

/**
 * Form definitions, versions, publications and submissions (task 0.16a), the queries over them (0.16b), saved views,
 * history and direct exports (0.16d), and background exports (0.16e).
 */
@Module({
    controllers: [
        FormsController,
        PublicationsController,
        SubmissionsController,
        SavedViewsController,
        ExportsController
    ],
    providers: [FormsService, SubmissionsService, SubmissionQueryService, SavedViewsService, ExportsService],
    exports: [FormsService, SubmissionsService, SubmissionQueryService]
})
export class FormsModule {}
