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
import { OBJECT_STORE, type ObjectStore } from '@itrms/kernel/files';
import { ForbiddenError, versionFrom } from '@itrms/kernel/errors';
import { reveal } from '@itrms/kernel/crypto';
import { currentContext } from '@itrms/kernel/context';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    draftCreateSchema,
    draftListQuerySchema,
    draftUpdateSchema,
    formCreateSchema,
    formListQuerySchema,
    formUpdateSchema,
    publicationDecisionSchema,
    publicationRejectionSchema,
    publicationListQuerySchema,
    publicationRequestSchema,
    revealSchema,
    savedViewCreateSchema,
    savedViewUpdateSchema,
    submissionCreateSchema,
    submissionExportSchema,
    submissionListQuerySchema,
    submissionQuerySchema
} from '../contracts';
import { FormsService } from './forms.service';
import { RegistryLookups } from './lookups';
import { formDefinitions, submissions } from './forms.table';
import { render, rendering } from './export';
import { SubmissionQueryService } from './query.service';
import { SavedViewsService } from './views.service';
import { ExportsService } from './exports.service';
import { SubmissionsService } from './submissions.service';
import { DraftsService } from './drafts.service';

class FormCreateDto extends createZodDto(formCreateSchema) {}
class FormUpdateDto extends createZodDto(formUpdateSchema) {}
class FormListDto extends createZodDto(formListQuerySchema) {}
class PublicationRequestDto extends createZodDto(publicationRequestSchema) {}
class PublicationDecisionDto extends createZodDto(publicationDecisionSchema) {}
class PublicationRejectionDto extends createZodDto(publicationRejectionSchema) {}
class PublicationListDto extends createZodDto(publicationListQuerySchema) {}
class SubmissionCreateDto extends createZodDto(submissionCreateSchema) {}
class SubmissionListDto extends createZodDto(submissionListQuerySchema) {}
class SubmissionQueryDto extends createZodDto(submissionQuerySchema) {}
class SubmissionExportDto extends createZodDto(submissionExportSchema) {}
class SavedViewCreateDto extends createZodDto(savedViewCreateSchema) {}
class SavedViewUpdateDto extends createZodDto(savedViewUpdateSchema) {}
class RevealDto extends createZodDto(revealSchema) {}

/** How recently the person entered their second factor to reveal personal data (SEC-SE-5, as a person's record). */
const REVEAL_RECENT_AUTH = 300;
class DraftCreateDto extends createZodDto(draftCreateSchema) {}
class DraftUpdateDto extends createZodDto(draftUpdateSchema) {}
class DraftListDto extends createZodDto(draftListQuerySchema) {}

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
        const language = currentContext()?.language ?? 'am';
        return this.db.scoped(requestDbContext(), (tx) => this.queries.view(tx, roles, id, language));
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

    /** What publishing the working copy changes against the published version, and whom it affects. */
    @Get(':id/publish-check')
    @Require('form:publish')
    publishCheck(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.forms.publishCheck(tx, ctx, id));
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
        return this.db.scoped(requestDbContext(), (tx) => this.forms.publications(tx, query));
    }

    /** How many pending publications the caller may decide (the menu's badge, the home page: task 0.20d). */
    @Get('count')
    @Require('form:read')
    count() {
        return this.db.scoped(requestDbContext(), async (tx) => ({ decidable: await this.forms.decidableCount(tx) }));
    }

    /** The request's version against the published one: problems, tests, diff and the saved views it affects. */
    @Get(':id/review')
    @Require('form:read')
    review(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.forms.review(tx, ctx, id));
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
        @Body() body: PublicationRejectionDto
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
        @Inject(SubmissionQueryService) private readonly queries: SubmissionQueryService,
        @Inject(RegistryLookups) private readonly lookups: RegistryLookups
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
        const language = currentContext()?.language ?? 'am';
        // read in the transaction, made into a file after it (no connection held while it renders)
        const { table, file } = await rendering(async () => {
            const t = await this.db.scoped(ctx, (tx) => this.queries.exportTable(tx, roles, body, language));
            return { table: t, file: { ...(await render(t)), filename: t.filename, rows: t.rows.length } };
        });
        await this.db.recordSensitiveEvent(ctx, {
            type: 'submissions.exported',
            table: formDefinitions,
            rowId: body.formId,
            data: {
                format: body.format,
                rows: file.rows,
                // which columns left the system (keys, never values)
                fieldKeys: table.keys,
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

    /**
     * A submission's Sensitive answers, with a reason (task 0.20d): audited; not replayable, so they are never kept in an
     * idempotency record.
     */
    @Post(':id/reveal')
    @HttpCode(200)
    @NotReplayable()
    @Require('pii:reveal', { recentAuth: REVEAL_RECENT_AUTH })
    async reveal(@Param('id', ParseUUIDPipe) id: string, @Body() body: RevealDto) {
        const { roles, permissions } = currentPrincipal();
        // personal data in clear is for someone who reads submissions at all (a case officer without it reveals none)
        if (!permissions.has('submission:read')) throw new ForbiddenError({ audit: { reason: 'submission:read' } });
        const ctx = requestDbContext();
        // the fields it would show (no values), then the reveal on record in a transaction of its own, then the read
        const fields = await this.db.scoped(ctx, (tx) => this.submissions.sensitiveOf(tx, roles, id));
        return reveal(
            this.db,
            ctx,
            { type: 'submission.revealed', table: submissions, rowId: id, fields: fields ?? [], reason: body.reason },
            (tx) => this.submissions.revealed(tx, roles, id)
        );
    }

    /** Who did what to a submission and when (the answers' values never: the log holds them masked). */
    @Get(':id/history')
    @Require('submission:read')
    history(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.submissions.history(tx, id));
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
        return this.db.scoped(ctx, (tx) =>
            this.submissions.create(tx, ctx, roles, body, this.lookups, currentContext()?.language)
        );
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

/** A person's drafts of a request (task 0.20c): theirs alone, kept until the request is filed or thrown away. */
@Controller('api/v1/form-drafts')
export class DraftsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(DraftsService) private readonly drafts: DraftsService
    ) {}

    @Get()
    @Require('submission:create')
    list(@Query() query: DraftListDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.drafts.list(tx, ctx, roles, query));
    }

    @Get(':id')
    @Require('submission:create')
    get(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.drafts.get(tx, ctx, roles, id));
    }

    @Post()
    @Require('submission:create')
    create(@Body() body: DraftCreateDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.drafts.create(tx, ctx, roles, body));
    }

    @Patch(':id')
    @Require('submission:create')
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: DraftUpdateDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.drafts.update(tx, ctx, roles, id, version, body));
    }

    @Delete(':id')
    @HttpCode(204)
    @Require('submission:create')
    async remove(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        await this.db.scoped(ctx, (tx) => this.drafts.remove(tx, ctx, id, version));
    }
}

/** Background exports (task 0.16e): asked for here, made by the worker, followed and downloaded by their requester alone. */
@Controller('api/v1/submission-exports')
export class ExportsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(OBJECT_STORE) private readonly store: ObjectStore,
        @Inject(ExportsService) private readonly exportsService: ExportsService
    ) {}

    @Post()
    @HttpCode(202)
    @Require('submission:export')
    request(@Body() body: SubmissionExportDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        const language = currentContext()?.language ?? 'am';
        return this.db.scoped(ctx, (tx) => this.exportsService.request(tx, ctx, roles, language, body));
    }

    @Get(':id')
    @Require('submission:export')
    get(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.exportsService.get(tx, ctx, id));
    }

    // a short-lived link (never kept for a replay); the download is on record
    @Post(':id/download')
    @HttpCode(200)
    @NotReplayable()
    @Require('submission:export')
    download(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.exportsService.download(tx, ctx, this.store, id));
    }
}
