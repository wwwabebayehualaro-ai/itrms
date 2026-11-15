/**
 * Sampling QA of migrated vehicles (task 1.13g, ADR-0054 §3): the drawn records an office and those below it hold, one with a link
 * to its scan, its re-check by a third person, and each clerk's counts. The draw itself is in the transaction that puts a vehicle
 * on the register (migration-sampling.service.ts).
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { DATABASE, NotReplayable } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { OBJECT_STORE, type ObjectStore } from '@itrms/kernel/files';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';

import { migrationSampleQuerySchema, migrationSampleRecheckSchema } from '../contracts';
import { MigrationSamplingService } from './migration-sampling.service';

class MigrationSampleQueryDto extends createZodDto(migrationSampleQuerySchema) {}
class MigrationSampleRecheckDto extends createZodDto(migrationSampleRecheckSchema) {}

/** Whether the caller may re-check: what the queue offers them. */
const mayRecheck = () => currentPrincipal().permissions.has('migration-sample:recheck');

@Controller('api/v1/migration-samples')
export class MigrationSampleController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(OBJECT_STORE) private readonly store: ObjectStore,
        @Inject(MigrationSamplingService) private readonly samples: MigrationSamplingService
    ) {}

    @Get()
    @Require('migration-sample:read')
    list(@Query() query: MigrationSampleQueryDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.samples.list(tx, ctx, query, mayRecheck()));
    }

    @Get('clerks')
    @Require('migration-sample:read')
    async clerks() {
        const ctx = requestDbContext();
        return { items: await this.db.scoped(ctx, (tx) => this.samples.clerks(tx, ctx)) };
    }

    @Get(':id')
    @Require('migration-sample:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.samples.get(tx, ctx, id, mayRecheck()));
    }

    // a short-lived link to one page of the scan (never kept for a replay); the download is on record
    @Post(':id/scans/:fileId')
    @HttpCode(200)
    @NotReplayable()
    @Require('migration-sample:read')
    scan(@Param('id', ParseUUIDPipe) id: string, @Param('fileId', ParseUUIDPipe) fileId: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.samples.scanLink(tx, ctx, this.store, id, fileId));
    }

    @Post(':id/recheck')
    @HttpCode(200)
    @Require('migration-sample:recheck')
    recheck(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: MigrationSampleRecheckDto
    ) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.samples.recheck(tx, ctx, id, versionFrom(ifMatch), body));
    }
}
