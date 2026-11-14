/** A case's or a record's documents, and the stored PDF of one (task 0.23a). */
import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { OBJECT_STORE, type ObjectStore } from '@itrms/kernel/files';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import { issuedDocumentQuerySchema } from '../contracts';
import am from '../messages/am.json';
import en from '../messages/en.json';
import { DocumentsService } from './documents.service';

class DocumentQueryDto extends createZodDto(issuedDocumentQuerySchema) {}

@Controller('api/v1')
export class DocumentsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(OBJECT_STORE) private readonly store: ObjectStore,
        private readonly documents: DocumentsService
    ) {}

    @Get('issued-documents')
    @Require('issued-document:read')
    list(@Query() query: DocumentQueryDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.documents.list(tx, query) }));
    }

    /**
     * The acting office's header as its documents print it (task 1.13e): the builder's print preview heads the form with it. A
     * form author's (it is printed on every document the office gives, so nothing in it is for the office alone).
     */
    @Get('document-header')
    @Require('form:read')
    header() {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.documents.header(tx, ctx.unitId ?? ''));
    }

    /** A reprint: the PDF made when it was issued, never made again. */
    @Get('issued-documents/:id/download')
    @Require('issued-document:read')
    download(@Param('id', ParseUUIDPipe) id: string) {
        const language = currentContext()?.language ?? 'am';
        const notReady = (language === 'en' ? en : am)['documents.notReady'];
        return this.db.scoped(requestDbContext(), (tx) => this.documents.download(tx, this.store, id, notReady));
    }
}
