/**
 * The cases API (task 0.19b): a case as the caller sees it, and a person's transition out of its current state. Thin
 * handlers: who may take which step is the engine's (CasesService). A transition names the case version it was based on
 * (If-Match) and is idempotent (the kernel's interceptor). Cases are started by services (0.21), not over this API.
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import { transitionSchema } from '../contracts';
import { CasesService, type CaseActor } from './cases.service';

class TransitionDto extends createZodDto(transitionSchema) {}

const actor = (): CaseActor => {
    const { userId, unitId, roles } = currentPrincipal();
    return { userId, unitId, roles };
};

@Controller('api/v1/cases')
export class CasesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly cases: CasesService
    ) {}

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
        const language = currentContext()?.language ?? 'am';
        return this.db.scoped(ctx, (tx) => this.cases.transition(tx, ctx, actor(), id, version, body, language));
    }
}
