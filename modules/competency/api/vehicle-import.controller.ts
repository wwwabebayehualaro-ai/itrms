/**
 * The bulk import of paper vehicle files (task 1.13b): a sheet sent, its dry-run report read, committed by a second person or
 * discarded; a row's scan downloaded. The reading, the checking and the commit itself are the worker's (vehicle-import.service.ts).
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { DATABASE, NotReplayable } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { OBJECT_STORE, type ObjectStore } from '@itrms/kernel/files';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';
import { RateLimit } from '@itrms/kernel/limits';

import { vehicleImportCreateSchema, vehicleImportQuerySchema, vehicleImportRowQuerySchema } from '../contracts';
import { VehicleImportService } from './vehicle-import.service';

class VehicleImportCreateDto extends createZodDto(vehicleImportCreateSchema) {}
class VehicleImportQueryDto extends createZodDto(vehicleImportQuerySchema) {}
class VehicleImportRowQueryDto extends createZodDto(vehicleImportRowQuerySchema) {}

/** Whether the caller may commit a batch: what the report offers them. */
const mayCommit = () => currentPrincipal().permissions.has('vehicle-import:commit');

@Controller('api/v1/vehicle-imports')
export class VehicleImportController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(OBJECT_STORE) private readonly store: ObjectStore,
        @Inject(VehicleImportService) private readonly imports: VehicleImportService
    ) {}

    @Post()
    @RateLimit('export')
    @HttpCode(202)
    @Require('vehicle-import:create')
    create(@Body() body: VehicleImportCreateDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        const language = currentContext()?.language ?? 'am';
        return this.db.scoped(ctx, (tx) => this.imports.create(tx, ctx, roles, language, body, mayCommit()));
    }

    @Get()
    @Require('vehicle-import:read')
    async list(@Query() query: VehicleImportQueryDto) {
        const ctx = requestDbContext();
        return { items: await this.db.scoped(ctx, (tx) => this.imports.list(tx, ctx, query.limit, mayCommit())) };
    }

    @Get('rows/:rowId')
    @Require('vehicle-import:read')
    row(@Param('rowId', ParseUUIDPipe) rowId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.imports.row(tx, rowId));
    }

    // a short-lived link (never kept for a replay); the download is on record
    @Post('rows/:rowId/scan')
    @HttpCode(200)
    @NotReplayable()
    @Require('vehicle-import:read')
    scan(@Param('rowId', ParseUUIDPipe) rowId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.imports.scanLink(tx, this.store, rowId));
    }

    @Get(':id')
    @Require('vehicle-import:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.imports.get(tx, ctx, id, mayCommit()));
    }

    @Get(':id/rows')
    @Require('vehicle-import:read')
    rows(@Param('id', ParseUUIDPipe) id: string, @Query() query: VehicleImportRowQueryDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.imports.rows(tx, id, query));
    }

    @Post(':id/commit')
    @HttpCode(202)
    @Require('vehicle-import:commit')
    commit(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.imports.commit(tx, ctx, roles, id, versionFrom(ifMatch), mayCommit()));
    }

    @Post(':id/discard')
    @HttpCode(200)
    @Require('vehicle-import:read')
    discard(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.imports.discard(tx, ctx, id, versionFrom(ifMatch), mayCommit()));
    }
}
