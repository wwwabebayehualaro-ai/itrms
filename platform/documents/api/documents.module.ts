import { Module } from '@nestjs/common';

import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { IssueDocumentEffect } from './issue.effect';
import { VerificationController } from './verification.controller';

/** Document templates and the documents issued (task 0.23a). Rendering is the PDF worker's: nothing here loads Chrome. */
@Module({
    controllers: [DocumentsController, VerificationController],
    providers: [DocumentsService, IssueDocumentEffect],
    exports: [DocumentsService]
})
export class DocumentsModule {}
