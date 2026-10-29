/**
 * The workflow definitions API (task 0.19a; api-guidelines.md): thin handlers, a permission each, Zod in, a service call
 * out. Every POST is idempotent (the kernel's interceptor). A check is a dry run: it stores nothing.
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
import { DATABASE } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    workflowCheckRequestSchema,
    workflowCreateSchema,
    workflowListQuerySchema,
    workflowUpdateSchema,
    workflowVersionCreateSchema
} from '../contracts';
import { WorkflowDefinitionsService } from './definitions.service';

class WorkflowCreateDto extends createZodDto(workflowCreateSchema) {}
class WorkflowVersionCreateDto extends createZodDto(workflowVersionCreateSchema) {}
class WorkflowCheckDto extends createZodDto(workflowCheckRequestSchema) {}
class WorkflowListDto extends createZodDto(workflowListQuerySchema) {}
class WorkflowUpdateDto extends createZodDto(workflowUpdateSchema) {}

const language = () => currentContext()?.language ?? 'am';

@Controller('api/v1/workflow-definitions')
export class WorkflowDefinitionsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly definitions: WorkflowDefinitionsService
    ) {}

    @Get()
    @Require('workflow-definition:read')
    list(@Query() query: WorkflowListDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.definitions.list(tx, query) }));
    }

    /** What the engine finds wrong with a definition, in the reader's language; nothing is stored. */
    @Post('check')
    @HttpCode(200)
    @Require('workflow-definition:create')
    async check(@Body() body: WorkflowCheckDto) {
        const ctx = requestDbContext();
        // checked as a workflow the caller's unit would own
        const { ok, problems } = await this.db.scoped(ctx, (tx) =>
            this.definitions.check(tx, body.definition, ctx.scopePath ?? '', language())
        );
        return { ok, problems };
    }

    @Post()
    @Require('workflow-definition:create')
    create(@Body() body: WorkflowCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.definitions.create(tx, ctx, body, language()));
    }

    @Get(':id')
    @Require('workflow-definition:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.definitions.get(tx, id));
    }

    /** Renamed or switched off (If-Match: the workflow's version); a version already stored never changes. */
    @Patch(':id')
    @Require('workflow-definition:update')
    update(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: WorkflowUpdateDto
    ) {
        const version = versionFrom(ifMatch);
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.definitions.update(tx, ctx, id, version, body));
    }

    @Get(':id/versions')
    @Require('workflow-definition:read')
    versions(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.definitions.versions(tx, id) }));
    }

    @Post(':id/versions')
    @Require('workflow-definition:update')
    addVersion(@Param('id', ParseUUIDPipe) id: string, @Body() body: WorkflowVersionCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.definitions.addVersion(tx, ctx, id, body.definition, language()));
    }

    @Get(':id/versions/:versionId')
    @Require('workflow-definition:read')
    version(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.definitions.version(tx, id, versionId));
    }
}
