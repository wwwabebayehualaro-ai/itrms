/**
 * The forms API (task 0.16a; api-guidelines.md): thin handlers, a permission each, Zod in, a service call out. Changes name
 * the version they were based on (If-Match); every POST is idempotent (the kernel's interceptor).
 */
import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    HttpCode,
    Inject,
    Param,
    ParseUUIDPipe,
    Patch,
    Post,
    Query,
    Res
} from '@nestjs/common';
import { DATABASE, NotReplayable } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { currentContext } from '@itrms/kernel/context';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    formCreateSchema,
    formListQuerySchema,
    formUpdateSchema,
    publicationDecisionSchema,
    publicationListQuerySchema,
    publicationRequestSchema,
    savedViewCreateSchema,
    savedViewUpdateSchema,
    submissionCreateSchema,
    submissionExportSchema,
    submissionListQuerySchema,
    submissionQuerySchema
} from '../contracts';
import { FormsService } from './forms.service';
import { formDefinitions } from './forms.table';
import { SubmissionQueryService } from './query.service';
import { SavedViewsService } from './views.service';
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
class SubmissionExportDto extends createZodDto(submissionExportSchema) {}
class SavedViewCreateDto extends createZodDto(savedViewCreateSchema) {}
class SavedViewUpdateDto extends createZodDto(savedViewUpdateSchema) {}

/** Who may share a view with the office, or make it its default. */
const canShare = () => currentPrincipal().permissions.has('submission-view:share');

/** What a handler sending a file uses of the reply (Fastify's, without depending on it here). */
interface Reply {
    header(name: string, value: string): Reply;
    send(body: Buffer): unknown;
}

@Controller('api/v1/forms')
export class FormsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(FormsService) private readonly forms: FormsService,
        @Inject(SubmissionQueryService) private readonly queries: SubmissionQueryService,
        @Inject(SavedViewsService) private readonly savedViews: SavedViewsService
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

    /** The unit's shared views of the form's data and the caller's own. */
    @Get(':id/views')
    @Require('submission:read')
    views(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => ({ items: await this.savedViews.list(tx, ctx, canShare(), id) }));
    }

    @Post(':id/views')
    @Require('submission:read')
    createView(@Param('id', ParseUUIDPipe) id: string, @Body() body: SavedViewCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.savedViews.create(tx, ctx, canShare(), id, body));
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

    /**
     * The rows a query matches as a CSV or Excel file (at most MAX_DIRECT_EXPORT_ROWS). Leaving the system with data is
     * a right of its own, and every export is on record, with its size, even when sending it fails.
     */
    @Post('export')
    @HttpCode(200)
    @NotReplayable()
    @Require('submission:export')
    async export(@Body() body: SubmissionExportDto, @Res() reply: Reply): Promise<void> {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        const file = await this.db.scoped(ctx, (tx) =>
            this.queries.export(tx, roles, body, currentContext()?.language ?? 'am')
        );
        await this.db.recordSensitiveEvent(ctx, {
            type: 'submissions.exported',
            table: formDefinitions,
            rowId: body.formId,
            data: {
                format: body.format,
                rows: file.rows,
                fields: file.fields,
                filtered: Boolean(body.filter?.items.length),
                searched: Boolean(body.search?.trim())
            }
        });
        // the bytes themselves: the response is the file, never a serialised object
        reply
            .header('content-type', file.contentType)
            .header('content-disposition', `attachment; filename="${file.filename}"`)
            .header('x-row-count', String(file.rows))
            .header('cache-control', 'no-store')
            .send(file.body);
    }

    /** Who did what to a submission and when (the answers' values never: the log holds them masked). */
    @Get(':id/history')
    @Require('submission:read')
    history(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.submissions.history(tx, id) }));
    }

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

@Controller('api/v1/saved-views')
export class SavedViewsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(SavedViewsService) private readonly savedViews: SavedViewsService
    ) {}

    @Patch(':id')
    @Require('submission:read')
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: SavedViewUpdateDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.savedViews.update(tx, ctx, canShare(), id, version, body));
    }

    @Delete(':id')
    @HttpCode(204)
    @Require('submission:read')
    async remove(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        await this.db.scoped(ctx, (tx) => this.savedViews.remove(tx, ctx, canShare(), id, version));
    }
}
