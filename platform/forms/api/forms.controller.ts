/**
 * The forms API (task 0.16a; api-guidelines.md): thin handlers, a permission each, Zod in, a service call out. Changes name
 * the version they were based on (If-Match); every POST is idempotent (the kernel's interceptor).
 */
import {
    Body,
    Controller,
    Get,
    Headers,
    HttpCode,
    Inject,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query
} from '@nestjs/common';
import { DATABASE, NotReplayable } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    formCreateSchema,
    formListQuerySchema,
    formUpdateSchema,
    publicationDecisionSchema,
    publicationListQuerySchema,
    publicationRequestSchema,
    submissionCreateSchema,
    submissionListQuerySchema,
    submissionQuerySchema
} from '../contracts';
import { FormsService } from './forms.service';
import { SubmissionQueryService } from './query.service';
import { SubmissionsService } from './submissions.service';

class FormCreateDto extends createZodDto(formCreateSchema) {}
class FormUpdateDto extends createZodDto(formUpdateSchema) {}
class FormListDto extends createZodDto(formListQuerySchema) {}
class PublicationRequestDto extends createZodDto(publicationRequestSchema) {}
class PublicationDecisionDto extends createZodDto(publicationDecisionSchema) {}
class PublicationListDto extends createZodDto(publicationListQuerySchema) {}
class SubmissionCreateDto extends createZodDto(submissionCreateSchema) {}
class SubmissionListDto extends createZodDto(submissionListQuerySchema) {}
class SubmissionQueryDto extends createZodDto(submissionQuerySchema) {}

@Controller('api/v1/forms')
export class FormsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(FormsService) private readonly forms: FormsService,
        @Inject(SubmissionQueryService) private readonly queries: SubmissionQueryService
    ) {}

    @Get()
    @Require('form:read')
    list(@Query() query: FormListDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.forms.list(tx, query) }));
    }

    @Post()
    @Require('form:create')
    create(@Body() body: FormCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.forms.create(tx, ctx, body));
    }

    @Get(':id')
    @Require('form:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.forms.get(tx, id));
    }

    @Patch(':id')
    @Require('form:update')
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: FormUpdateDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.forms.update(tx, ctx, id, version, body));
    }

    /** What the data viewer can do with the form's submissions (fields, operators, parts, view modes). */
    @Get(':id/view')
    @Require('submission:read')
    view(@Param('id', ParseUUIDPipe) id: string) {
        const { roles } = currentPrincipal();
        return this.db.scoped(requestDbContext(), (tx) => this.queries.view(tx, roles, id));
    }

    @Get(':id/versions')
    @Require('form:read')
    versions(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.forms.versions(tx, id) }));
    }

    // before :versionId, so "published" is not read as a version id
    @Get(':id/versions/published')
    @Require('form:read')
    published(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.forms.published(tx, id));
    }

    @Get(':id/versions/:versionId')
    @Require('form:read')
    version(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.forms.version(tx, id, versionId));
    }

    @Post(':id/publications')
    @Require('form:publish')
    requestPublication(@Param('id', ParseUUIDPipe) id: string, @Body() body: PublicationRequestDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.forms.requestPublication(tx, ctx, id, body.note));
    }
}

@Controller('api/v1/form-publications')
export class PublicationsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(FormsService) private readonly forms: FormsService
    ) {}

    @Get()
    @Require('form:read')
    list(@Query() query: PublicationListDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.forms.publications(tx, query) }));
    }

    @Post(':id/approval')
    @HttpCode(200)
    @Require('form:approve')
    approve(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: PublicationDecisionDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.forms.approve(tx, ctx, id, version, body.note));
    }

    @Post(':id/withdrawal')
    @HttpCode(200)
    @Require('form:publish')
    withdraw(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.forms.withdraw(tx, ctx, id, version));
    }

    @Post(':id/rejection')
    @HttpCode(200)
    @Require('form:approve')
    reject(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: PublicationDecisionDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.forms.reject(tx, ctx, id, version, body.note));
    }
}

@Controller('api/v1/submissions')
export class SubmissionsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(SubmissionsService) private readonly submissions: SubmissionsService,
        @Inject(SubmissionQueryService) private readonly queries: SubmissionQueryService
    ) {}

    // a read sent as POST (the query is a document): no idempotency record is kept for it
    @Post('query')
    @HttpCode(200)
    @NotReplayable()
    @Require('submission:read')
    query(@Body() body: SubmissionQueryDto) {
        const { roles } = currentPrincipal();
        return this.db.scoped(requestDbContext(), (tx) => this.queries.query(tx, roles, body));
    }

    @Get()
    @Require('submission:read')
    list(@Query() query: SubmissionListDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.submissions.list(tx, ctx, roles, query));
    }

    @Post()
    @Require('submission:create')
    create(@Body() body: SubmissionCreateDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.submissions.create(tx, ctx, roles, body));
    }

    @Get(':id')
    @Require('submission:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        const { roles } = currentPrincipal();
        return this.db.scoped(requestDbContext(), (tx) => this.submissions.get(tx, roles, id));
    }
}
