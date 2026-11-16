/**
 * The encumbrances' HTTP side (task 1.4a; api-guidelines.md). Thin handlers: a permission each, Zod in, a service call out. Every
 * POST is idempotent (the kernel's Idempotency-Key interceptor); a release is requested, then confirmed or refused, each on the
 * version the caller read (If-Match). The check a service makes is an effect (encumbrance.effects.ts), not an endpoint.
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE, NotReplayable } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { OBJECT_STORE, type ObjectStore } from '@itrms/kernel/files';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    encumbranceListQuerySchema,
    encumbranceRecordSchema,
    releaseRefusalSchema,
    releaseRequestSchema
} from '../contracts';
import { EncumbranceService } from './encumbrances.service';

class RecordDto extends createZodDto(encumbranceRecordSchema) {}
class ReleaseRequestDto extends createZodDto(releaseRequestSchema) {}
class ReleaseRefusalDto extends createZodDto(releaseRefusalSchema) {}
class ListDto extends createZodDto(encumbranceListQuerySchema) {}

@Controller('api/v1/encumbrances')
export class EncumbrancesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(OBJECT_STORE) private readonly store: ObjectStore,
        @Inject(EncumbranceService) private readonly encumbrances: EncumbranceService
    ) {}

    @Get()
    @Require('encumbrance:read')
    list(@Query() query: ListDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.encumbrances.list(tx, query));
    }

    @Get(':id')
    @Require('encumbrance:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.encumbrances.get(tx, id));
    }

    @Post()
    @Require('encumbrance:record')
    record(@Body() body: RecordDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.encumbrances.record(tx, ctx, body));
    }

    @Post(':id/release-request')
    @HttpCode(200)
    @Require('encumbrance:release')
    requestRelease(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: ReleaseRequestDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.encumbrances.requestRelease(tx, ctx, id, version, body));
    }

    @Post(':id/release-confirmation')
    @HttpCode(200)
    @Require('encumbrance:release')
    confirmRelease(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.encumbrances.confirmRelease(tx, ctx, id, version));
    }

    @Post(':id/release-refusal')
    @HttpCode(200)
    @Require('encumbrance:release')
    refuseRelease(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: ReleaseRefusalDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.encumbrances.refuseRelease(tx, ctx, id, version, body));
    }

    // a short-lived link to a letter (never kept for a replay); the download is on record
    @Post(':id/files/:fileId')
    @HttpCode(200)
    @NotReplayable()
    @Require('encumbrance:read')
    file(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.encumbrances.downloadFile(tx, this.store, id, fileId));
    }
}
