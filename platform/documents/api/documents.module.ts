import { Module } from '@nestjs/common';
import { FormsModule } from '@itrms/forms/api';

import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IssueDocumentEffect } from './issue.effect';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';

/** Document templates and the documents issued (task 0.23a). Rendering is the PDF worker's: nothing here loads Chrome. */
@Module({
    // the registries' names for what a request's lookups picked (the application copy)
    imports: [FormsModule],
    controllers: [DocumentsController, VerificationController],
    providers: [DocumentsService, IssueDocumentEffect, VerificationService],
    exports: [DocumentsService]
})
export class DocumentsModule {}
