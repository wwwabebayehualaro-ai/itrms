/**
 * The cases API (tasks 0.19b, 0.20b): a case as the caller sees it, a person's transition out of its current state,
 * starting one (intake), taking a step on and giving it back, comments on its timeline, and the caller's inbox. Thin
 * handlers: who may take which step is the engine's (CasesService). A transition names the case version it was based on
 * (If-Match); every POST is idempotent (the kernel's interceptor).
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    casePeopleQuerySchema,
    caseStartSchema,
    commentCreateSchema,
    inboxQuerySchema,
    transitionSchema
} from '../contracts';
import { CasesService, type CaseActor } from './cases.service';

class TransitionDto extends createZodDto(transitionSchema) {}
class CaseStartDto extends createZodDto(caseStartSchema) {}
class CommentDto extends createZodDto(commentCreateSchema) {}
class PeopleQueryDto extends createZodDto(casePeopleQuerySchema) {}
class InboxQueryDto extends createZodDto(inboxQuerySchema) {}

const actor = (): CaseActor => {
    const { userId, unitId, roles, permissions } = currentPrincipal();
    return { userId, unitId, roles, permissions };
};
const language = () => currentContext()?.language ?? 'am';

@Controller('api/v1/cases')
export class CasesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly cases: CasesService
    ) {}

    /** A case on a workflow's newest version, handled by the caller's unit (intake, until service requests in 0.21). */
    @Post()
    @Require('case:create')
    start(@Body() body: CaseStartDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => {
            const { id } = await this.cases.startOn(tx, ctx, body.workflowId, language());
            return this.cases.get(tx, actor(), id);
        });
    }

    @Get(':id')
    @Require('case:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.cases.get(tx, actor(), id));
    }

    @Post(':id/transitions')
    @HttpCode(200)
    @Require('case:act')
    transition(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: TransitionDto
    ) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.cases.transition(tx, ctx, actor(), id, version, body, language()));
    }

    @Post(':id/tasks/:taskId/claim')
    @HttpCode(200)
    @Require('case:act')
    claim(@Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.cases.claim(tx, actor(), id, taskId, language()));
    }

    @Post(':id/tasks/:taskId/release')
    @HttpCode(200)
    @Require('case:act')
    release(@Param('id', ParseUUIDPipe) id: string, @Param('taskId', ParseUUIDPipe) taskId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.cases.release(tx, actor(), id, taskId, language()));
    }

    @Post(':id/comments')
    @Require('case:comment')
    comment(@Param('id', ParseUUIDPipe) id: string, @Body() body: CommentDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.cases.comment(tx, actor(), id, body, language()));
    }

    /** Who a comment may mention: the people working on the case, by name. */
    @Get(':id/people')
    @Require('case:comment')
    people(@Param('id', ParseUUIDPipe) id: string, @Query() query: PeopleQueryDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.cases.people(tx, id, query.q));
    }
}

/** The caller's inbox: the open steps of their active unit for the roles they hold there. */
@Controller('api/v1/me/tasks')
export class InboxController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly cases: CasesService
    ) {}

    @Get()
    @Require('case:act')
    list(@Query() query: InboxQueryDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.cases.inbox(tx, actor(), query));
    }
}
