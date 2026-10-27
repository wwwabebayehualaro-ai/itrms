/**
 * The workflow definitions API (task 0.19a; api-guidelines.md): thin handlers, a permission each, Zod in, a service call
 * out. Every POST is idempotent (the kernel's interceptor). A check is a dry run: it stores nothing.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    workflowCheckRequestSchema,
    workflowCreateSchema,
    workflowListQuerySchema,
    workflowVersionCreateSchema
} from '../contracts';
import { WorkflowDefinitionsService } from './definitions.service';

class WorkflowCreateDto extends createZodDto(workflowCreateSchema) {}
class WorkflowVersionCreateDto extends createZodDto(workflowVersionCreateSchema) {}
class WorkflowCheckDto extends createZodDto(workflowCheckRequestSchema) {}
class WorkflowListDto extends createZodDto(workflowListQuerySchema) {}

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
        const { ok, problems } = await this.db.scoped(requestDbContext(), (tx) =>
            this.definitions.check(tx, body.definition, language())
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
