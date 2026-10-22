/**
 * Files over HTTP (task 0.15, architecture §14): begin an upload, confirm it, read and download a file. The bytes never
 * pass through the API: the browser sends them to the object store with the presigned POST (or part URLs) it is given.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';

import { fileConfirmSchema, fileUploadRequestSchema } from '../../contracts';
import type { Database } from '../db/database';
import { NotReplayable } from '../idempotency/idempotency';
import { Require, requestDbContext } from '../iam/access';
import { DATABASE, OBJECT_STORE } from '../observability/tokens';
import { beginUpload, confirmUpload, downloadFile, fileOut, getFile } from './files';
import type { ObjectStore } from './object-store';

class FileUploadDto extends createZodDto(fileUploadRequestSchema) {}
class FileConfirmDto extends createZodDto(fileConfirmSchema) {}

@Controller('api/v1/files')
export class FilesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(OBJECT_STORE) private readonly store: ObjectStore
    ) {}

    @Post()
    @Require('file:upload')
    begin(@Body() body: FileUploadDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => beginUpload(tx, this.store, ctx, body));
    }

    // the checks read the object outside a transaction, and confirming again answers the file as it is: no record kept
    @Post(':id/confirm')
    @HttpCode(200)
    @NotReplayable()
    @Require('file:upload')
    confirm(@Param('id', ParseUUIDPipe) id: string, @Body() body: FileConfirmDto) {
        return confirmUpload(this.db, this.store, requestDbContext(), id, body.parts);
    }

    @Get(':id')
    @Require('file:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), async (tx) => fileOut(await getFile(tx, id)));
    }

    @Get(':id/download')
    @Require('file:read')
    download(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => downloadFile(tx, this.store, id));
    }
}
