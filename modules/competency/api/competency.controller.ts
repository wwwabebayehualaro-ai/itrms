/**
 * The register's API (task 0.24a): licences to read, the training schools' lists, the catalogue of grades, and the print batches. A
 * licence itself changes only through a case's workflow; its blood group (task 1.6, ADR-0052) is recorded by a register command and
 * read in clear only through the audited reveal, which needs a second factor in the last five minutes (SEC-SE-5) and is never kept
 * for replay.
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { DATABASE, NotReplayable } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { RateLimit } from '@itrms/kernel/limits';

import {
    enrolmentCompleteSchema,
    enrolmentCreateSchema,
    enrolmentQuerySchema,
    licenceHealthRecordSchema,
    licenceHealthRevealSchema,
    licenceQuerySchema,
    medicalConditionsRecordSchema,
    medicalConditionsRevealSchema,
    printBatchPrintedSchema
} from '../contracts';
import { LicenceHealthService } from './licence-health.service';
import { MedicalReportService } from './medical-report.service';
import { LicencesService } from './licences.service';
import { RegisterService } from './register.service';

/** How recently the lead entered their second factor to read a health fact (SEC-SE-5, as a person's record). */
const REVEAL_RECENT_AUTH = 300;

class LicenceQueryDto extends createZodDto(licenceQuerySchema) {}
class EnrolmentCreateDto extends createZodDto(enrolmentCreateSchema) {}
class EnrolmentCompleteDto extends createZodDto(enrolmentCompleteSchema) {}
class EnrolmentQueryDto extends createZodDto(enrolmentQuerySchema) {}
class PrintedDto extends createZodDto(printBatchPrintedSchema) {}
class HealthRecordDto extends createZodDto(licenceHealthRecordSchema) {}
class HealthRevealDto extends createZodDto(licenceHealthRevealSchema) {}
class ConditionsRecordDto extends createZodDto(medicalConditionsRecordSchema) {}
class ConditionsRevealDto extends createZodDto(medicalConditionsRevealSchema) {}

@Controller('api/v1/competency')
export class CompetencyController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(LicencesService) private readonly licences: LicencesService,
        @Inject(RegisterService) private readonly register: RegisterService,
        @Inject(LicenceHealthService) private readonly health: LicenceHealthService,
        @Inject(MedicalReportService) private readonly medical: MedicalReportService
    ) {}

    @Get('grades')
    @Require('licence:read')
    grades() {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.licences.grades(tx) }));
    }

    @Get('licences')
    @Require('licence:read')
    list(@Query() query: LicenceQueryDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.licences.list(tx, query));
    }

    @Get('licences/:id')
    @Require('licence:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.licences.get(tx, id));
    }

    /** The holder's blood group, for the card (task 1.6): only while the region collects it. The answer says only that it is on record. */
    @Post('licences/:id/health')
    @HttpCode(200)
    @Require('licence-health:record')
    recordHealth(@Param('id', ParseUUIDPipe) id: string, @Body() body: HealthRecordDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => {
            await this.health.record(tx, ctx, id, body.bloodGroup);
            return this.licences.get(tx, id);
        });
    }

    @Post('licences/:id/health/reveal')
    @RateLimit('reveal')
    @HttpCode(200)
    @NotReplayable()
    @Require('licence-health:reveal', { recentAuth: REVEAL_RECENT_AUTH })
    revealHealth(@Param('id', ParseUUIDPipe) id: string, @Body() body: HealthRevealDto) {
        return this.health.revealed(requestDbContext(), id, body.reason);
    }

    /**
     * A renewal's medical reports (task 1.6a), first institution first: whether conditions are on record, never what they are. For
     * those who record health facts (the officer and the lead): a recommendation is a health outcome.
     */
    @Get('cases/:caseId/medical-reports')
    @Require('licence-health:record')
    medicalReports(@Param('caseId', ParseUUIDPipe) caseId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.medical.list(tx, caseId));
    }

    /** The conditions a report grants with (ADR-0064 §4): a health fact, recorded here and never in a form; the answer omits them. */
    @Post('medical-reports/:id/conditions')
    @HttpCode(200)
    @Require('licence-health:record')
    recordConditions(@Param('id', ParseUUIDPipe) id: string, @Body() body: ConditionsRecordDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.medical.recordConditions(tx, ctx, id, body.conditions));
    }

    @Post('medical-reports/:id/conditions/reveal')
    @RateLimit('reveal')
    @HttpCode(200)
    @NotReplayable()
    @Require('licence-health:reveal', { recentAuth: REVEAL_RECENT_AUTH })
    revealConditions(@Param('id', ParseUUIDPipe) id: string, @Body() body: ConditionsRevealDto) {
        return this.medical.revealedConditions(requestDbContext(), id, body.reason);
    }

    @Get('training-enrolments')
    @Require('training:read')
    enrolments(@Query() query: EnrolmentQueryDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.register.enrolments(tx, query));
    }

    @Post('training-enrolments')
    @Require('training:record')
    enrol(@Body() body: EnrolmentCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.register.enrol(tx, ctx, body));
    }

    @Post('training-enrolments/:id/completion')
    @Require('training:record')
    complete(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: EnrolmentCompleteDto
    ) {
        return this.db.scoped(requestDbContext(), (tx) =>
            this.register.complete(tx, id, versionFrom(ifMatch), body.completedOn)
        );
    }

    @Get('print-batches')
    @Require('licence:print')
    batches() {
        return this.db.scoped(requestDbContext(), (tx) => this.register.batches(tx));
    }

    @Post('print-batches/:id/sending')
    @Require('licence:print')
    send(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
        return this.db.scoped(requestDbContext(), (tx) => this.register.send(tx, id, versionFrom(ifMatch)));
    }

    /** The batch came back printed: each licence's card blank, and the blanks spoiled (task 1.12a). */
    @Post('print-batches/:id/printing')
    @Require('licence:print')
    printed(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: PrintedDto
    ) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.register.recordPrinted(tx, ctx, id, versionFrom(ifMatch), body));
    }
}
