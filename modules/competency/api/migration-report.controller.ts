/**
 * The reconciliation report of the paper-record migration (task 1.13h, ADR-0054 §4): paper files counted against the vehicles
 * verified onto the register, per office and plate code. The zone sets the paper counts for the offices below it.
 */
import { Body, Controller, Get, Headers, Inject, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';

import { paperCountSchema } from '../contracts';
import { MigrationReportService } from './migration-report.service';

class PaperCountDto extends createZodDto(paperCountSchema) {}

@Controller('api/v1/migration-report')
export class MigrationReportController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(MigrationReportService) private readonly report: MigrationReportService
    ) {}

    @Get()
    @Require('migration-report:read')
    get() {
        const ctx = requestDbContext();
        const mayCount = currentPrincipal().permissions.has('migration-report:count');
        return this.db.scoped(ctx, (tx) => this.report.report(tx, ctx, mayCount));
    }

    // If-Match is absent for a count new to the office and code, and the version of the count it replaces otherwise
    @Put('paper-counts')
    @Require('migration-report:count')
    setPaperCount(@Headers('if-match') ifMatch: string | undefined, @Body() body: PaperCountDto) {
        const ctx = requestDbContext();
        const version = ifMatch === undefined ? undefined : versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.report.setPaperCount(tx, ctx, body, version));
    }
}
