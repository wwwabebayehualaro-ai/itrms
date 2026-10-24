import { Module } from '@nestjs/common';

import { FormsController, PublicationsController, SubmissionsController } from './forms.controller';
import { FormsService } from './forms.service';
import { SubmissionsService } from './submissions.service';

/** Form definitions, versions, publications and submissions (task 0.16a). */
@Module({
    controllers: [FormsController, PublicationsController, SubmissionsController],
    providers: [FormsService, SubmissionsService],
    exports: [FormsService, SubmissionsService]
})
export class FormsModule {}
