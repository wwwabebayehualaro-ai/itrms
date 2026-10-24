import { Module } from '@nestjs/common';

import {
    FormsController,
    PublicationsController,
    SavedViewsController,
    SubmissionsController
} from './forms.controller';
import { FormsService } from './forms.service';
import { SubmissionQueryService } from './query.service';
import { SubmissionsService } from './submissions.service';
import { SavedViewsService } from './views.service';

/** Form definitions, versions, publications and submissions (task 0.16a), and the queries over them (task 0.16b). */
@Module({
    controllers: [FormsController, PublicationsController, SubmissionsController, SavedViewsController],
    providers: [FormsService, SubmissionsService, SubmissionQueryService, SavedViewsService],
    exports: [FormsService, SubmissionsService, SubmissionQueryService]
})
export class FormsModule {}
