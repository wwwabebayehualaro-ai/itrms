/**
 * The register's API (task 0.24a): licences to read, the training schools' lists, the catalogue of grades, and the print batches. A
 * licence itself changes only through a case's workflow.
 */
import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, requestDbContext } from '@itrms/kernel/iam';

import { enrolmentCompleteSchema, enrolmentCreateSchema, enrolmentQuerySchema, licenceQuerySchema } from '../contracts';
import { LicencesService } from './licences.service';
import { RegisterService } from './register.service';

class LicenceQueryDto extends createZodDto(licenceQuerySchema) {}
class EnrolmentCreateDto extends createZodDto(enrolmentCreateSchema) {}
class EnrolmentCompleteDto extends createZodDto(enrolmentCompleteSchema) {}
class EnrolmentQueryDto extends createZodDto(enrolmentQuerySchema) {}

@Controller('api/v1/competency')
export class CompetencyController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(LicencesService) private readonly licences: LicencesService,
        @Inject(RegisterService) private readonly register: RegisterService
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
}
