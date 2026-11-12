/**
 * Controlled stationery's HTTP side (task 1.12a; api-guidelines.md). Thin handlers: a permission each, Zod in, a service
 * call out. Every POST is idempotent (the kernel's Idempotency-Key interceptor). Using an item for a record has no endpoint:
 * the slice that prints or issues on it calls StationeryStock.use in its own transaction.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
    STATIONERY_KINDS,
    stationeryAcceptanceSchema,
    stationeryAllocationSchema,
    stationeryClosingSchema,
    stationeryListQuerySchema,
    stationeryMovementListQuerySchema,
    stationeryRecallSchema,
    stationeryReceiveSchema,
    stationerySummaryQuerySchema,
    stationeryWriteOffSchema
} from '../contracts';
import { StationeryStock } from './stationery.service';

class ReceiveDto extends createZodDto(stationeryReceiveSchema) {}
class AllocateDto extends createZodDto(stationeryAllocationSchema) {}
class AcceptDto extends createZodDto(stationeryAcceptanceSchema) {}
class RecallDto extends createZodDto(stationeryRecallSchema) {}
class WriteOffDto extends createZodDto(stationeryWriteOffSchema) {}
class ClosingDto extends createZodDto(stationeryClosingSchema) {}
class ItemListDto extends createZodDto(stationeryListQuerySchema) {}
class MovementListDto extends createZodDto(stationeryMovementListQuerySchema) {}
class SummaryDto extends createZodDto(stationerySummaryQuerySchema) {}
class KindDto extends createZodDto(z.strictObject({ kind: z.enum(STATIONERY_KINDS).optional() })) {}

@Controller('api/v1/stationery')
export class StationeryController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(StationeryStock) private readonly stock: StationeryStock
    ) {}

    @Get('summary')
    @Require('stationery:read')
    summary(@Query() query: SummaryDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.summary(tx, ctx, query.kind, query.unitId));
    }

    @Get('items')
    @Require('stationery:read')
    items(@Query() query: ItemListDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.list(tx, ctx, query));
    }

    @Get('movements')
    @Require('stationery:read')
    movements(@Query() query: MovementListDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.movements(tx, ctx, query));
    }

    @Get('movements/:id')
    @Require('stationery:read')
    movement(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.stock.movement(tx, id));
    }

    @Get('batches')
    @Require('stationery:read')
    batches(@Query() query: KindDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => ({ items: await this.stock.batches(tx, ctx, query.kind) }));
    }

    @Get('closings')
    @Require('stationery:read')
    closings(@Query() query: KindDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => ({ items: await this.stock.closings(tx, ctx, query.kind) }));
    }

    @Post('batches')
    @Require('stationery:receive')
    receive(@Body() body: ReceiveDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.receive(tx, ctx, body));
    }

    @Post('allocations')
    @Require('stationery:allocate')
    allocate(@Body() body: AllocateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.allocate(tx, ctx, body));
    }

    @Post('movements/:id/acceptance')
    @HttpCode(200)
    @Require('stationery:receive')
    accept(@Param('id', ParseUUIDPipe) id: string, @Body() body: AcceptDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.accept(tx, ctx, id, body));
    }

    @Post('recalls')
    @Require('stationery:allocate')
    recall(@Body() body: RecallDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.recall(tx, ctx, body));
    }

    @Post('write-offs')
    @Require('stationery:write-off')
    writeOff(@Body() body: WriteOffDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.writeOff(tx, ctx, body));
    }

    @Post('closings')
    @Require('stationery:close')
    close(@Body() body: ClosingDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.close(tx, ctx, body));
    }
}
