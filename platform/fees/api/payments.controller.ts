/**
 * The cashier's API (task 0.22b; api-guidelines.md): thin handlers, a permission each, Zod in, a service call out. Every
 * POST is idempotent (the kernel's interceptor): a payment sent twice is recorded once, its receipt numbered once.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';
import { currentPrincipal, Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
    paymentInputSchema,
    paymentOrderQuerySchema,
    REVERSAL_STATES,
    reversalDecisionSchema,
    reversalRequestSchema
} from '../contracts';
import { PaymentOrdersService } from './payment-orders.service';
import { PaymentsService } from './payments.service';

class PaymentDto extends createZodDto(paymentInputSchema) {}
class OrderQueryDto extends createZodDto(paymentOrderQuerySchema) {}
class ReversalRequestDto extends createZodDto(reversalRequestSchema) {}
class ReversalDecisionDto extends createZodDto(reversalDecisionSchema) {}
class ReversalQueryDto extends createZodDto(z.object({ state: z.enum(REVERSAL_STATES).default('requested') })) {}

const language = () => currentContext()?.language ?? 'am';

@Controller('api/v1')
export class PaymentsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly orders: PaymentOrdersService,
        private readonly payments: PaymentsService
    ) {}

    /** The cashier's queue: the orders of the person's office paid at its till. */
    @Get('payment-orders')
    @Require('payment-order:read')
    list(@Query() query: OrderQueryDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => ({ items: await this.orders.list(tx, ctx, query) }));
    }

    @Get('payment-orders/:id')
    @Require('payment-order:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.orders.get(tx, id, ctx.unitId ?? ''));
    }

    /** A payment of the whole total at the person's till, with its receipt. */
    @Post('payment-orders/:id/payments')
    @Require('payment:record')
    record(@Param('id', ParseUUIDPipe) id: string, @Body() body: PaymentDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.payments.record(tx, ctx, id, body, language()));
    }

    @Get('receipts/:id')
    @Require('receipt:read')
    receipt(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.payments.receipt(tx, id));
    }

    @Post('receipts/:id/reversals')
    @Require('receipt-reversal:request')
    requestReversal(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReversalRequestDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.payments.requestReversal(tx, ctx, id, body.reason, language()));
    }

    /** The reversals the person sees (their office and the ones below), waiting for a decision by default. */
    @Get('receipt-reversals')
    @Require('receipt-reversal:read')
    reversals(@Query() query: ReversalQueryDto) {
        return this.db.scoped(requestDbContext(), async (tx) => ({
            items: await this.payments.reversals(tx, query.state)
        }));
    }

    @Post('receipt-reversals/:id/decision')
    @HttpCode(200)
    @Require('receipt-reversal:decide')
    decide(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReversalDecisionDto) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.payments.decide(tx, ctx, roles, id, body, language()));
    }

    /** The case page's payment panel: its newest order, or 404 for a case without one. */
    @Get('cases/:caseId/payment')
    @Require('case:read')
    forCase(@Param('caseId', ParseUUIDPipe) caseId: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => {
            const order = await this.orders.forCase(tx, caseId, ctx.unitId ?? '');
            if (!order) throw new NotFoundError();
            return order;
        });
    }
}
