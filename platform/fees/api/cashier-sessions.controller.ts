/**
 * The cashier's session and the closing (task 1.12, ADR-0063): thin handlers, a permission each, Zod in, a service call out.
 * Every POST is idempotent (the kernel's interceptor): a count sent twice is recorded once.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { currentPrincipal, Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import { countDecisionSchema, sessionCountSchema, sessionOpenSchema, sessionQuerySchema } from '../contracts';
import { CashierSessionsService } from './cashier-sessions.service';

class SessionOpenDto extends createZodDto(sessionOpenSchema) {}
class SessionCountDto extends createZodDto(sessionCountSchema) {}
class CountDecisionDto extends createZodDto(countDecisionSchema) {}
class SessionQueryDto extends createZodDto(sessionQuerySchema) {}

/** Whoever may approve sees the sessions of the office and below; a cashier sees their own. */
const scopeOf = (): 'own' | 'all' => (currentPrincipal().permissions.has('cashier-session:approve') ? 'all' : 'own');

@Controller('api/v1')
export class CashierSessionsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly sessions: CashierSessionsService
    ) {}

    /** Today's sessions of the person at their office, and the earlier days' ones not yet closed (overdue). */
    @Get('cashier-sessions/current')
    @Require('cashier-session:read')
    current() {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.sessions.current(tx, ctx));
    }

    /** Opens today's session with a float (the first payment would open it with none). */
    @Post('cashier-sessions')
    @Require('cashier-session:open')
    open(@Body() body: SessionOpenDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.sessions.open(tx, ctx, body.openingFloatSantim));
    }

    @Get('cashier-sessions')
    @Require('cashier-session:read')
    list(@Query() query: SessionQueryDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.sessions.list(tx, ctx, scopeOf(), query));
    }

    @Get('cashier-sessions/:id')
    @Require('cashier-session:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.sessions.detail(tx, id, ctx, scopeOf()));
    }

    /** The cashier's count of the till: closes the session when it matches, else waits for a decision. */
    @Post('cashier-sessions/:id/counts')
    @Require('cashier-session:close')
    count(@Param('id', ParseUUIDPipe) id: string, @Body() body: SessionCountDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.sessions.count(tx, ctx, id, body));
    }

    @Post('cashier-session-counts/:id/decision')
    @HttpCode(200)
    @Require('cashier-session:approve')
    decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: CountDecisionDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.sessions.decide(tx, ctx, roles, id, body));
    }
}
