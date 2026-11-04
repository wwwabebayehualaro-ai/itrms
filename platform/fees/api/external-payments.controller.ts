/**
 * Money paid elsewhere (task 0.22c, ADR-0043): a reference entered against an order at the counter, its decision and
 * revocation by another person, and the statements a finance officer imports.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { currentPrincipal, Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    externalRefDecisionSchema,
    externalRefInputSchema,
    externalRefQuerySchema,
    externalRefRevocationSchema,
    statementImportSchema,
    statementLineQuerySchema,
    statementQuerySchema
} from '../contracts';
import { ExternalPaymentsService } from './external-payments.service';

class RefInputDto extends createZodDto(externalRefInputSchema) {}
class RefDecisionDto extends createZodDto(externalRefDecisionSchema) {}
class RefRevocationDto extends createZodDto(externalRefRevocationSchema) {}
class RefQueryDto extends createZodDto(externalRefQuerySchema) {}
class StatementImportDto extends createZodDto(statementImportSchema) {}
class StatementQueryDto extends createZodDto(statementQuerySchema) {}
class StatementLineQueryDto extends createZodDto(statementLineQuerySchema) {}

const language = () => currentContext()?.language ?? 'am';

@Controller('api/v1')
export class ExternalPaymentsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly external: ExternalPaymentsService
    ) {}

    /** Who may issue a reference here: the region's list, for the screens. */
    @Get('external-issuers')
    @Require('external-payment:read')
    issuers() {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => ({ items: await this.external.issuers(tx, ctx) }));
    }

    @Post('payment-orders/:id/external-refs')
    @Require('external-payment:enter')
    enter(@Param('id', ParseUUIDPipe) id: string, @Body() body: RefInputDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.external.enter(tx, ctx, id, body, language()));
    }

    /** The references the person sees (their office and the ones below), waiting for a decision by default. */
    @Get('external-payment-refs')
    @Require('external-payment:read')
    list(@Query() query: RefQueryDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.external.list(tx, query) }));
    }

    @Post('external-payment-refs/:id/decision')
    @HttpCode(200)
    @Require('external-payment:verify')
    decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: RefDecisionDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.external.decide(tx, ctx, roles, id, body, language()));
    }

    @Post('external-payment-refs/:id/revocation')
    @HttpCode(200)
    @Require('external-payment:verify')
    revoke(@Param('id', ParseUUIDPipe) id: string, @Body() body: RefRevocationDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.external.revoke(tx, ctx, roles, id, body.reason, language()));
    }

    @Post('external-statements')
    @Require('external-statement:import')
    importStatement(@Body() body: StatementImportDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.external.importStatement(tx, ctx, body, language()));
    }

    @Get('external-statements')
    @Require('external-statement:read')
    statements(@Query() query: StatementQueryDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({
            items: await this.external.statements(tx, query.limit)
        }));
    }

    @Get('external-statements/:id')
    @Require('external-statement:read')
    statement(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.external.statement(tx, id));
    }

    @Get('external-statements/:id/lines')
    @Require('external-statement:read')
    lines(@Param('id', ParseUUIDPipe) id: string, @Query() query: StatementLineQueryDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({
            items: await this.external.statementLines(tx, id, query)
        }));
    }
}
