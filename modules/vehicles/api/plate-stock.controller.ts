/**
 * The plate stock's HTTP side (task 1.2a; api-guidelines.md). Thin handlers: a permission each, Zod in, a service call out.
 * Every POST is idempotent (the kernel's Idempotency-Key interceptor). Assigning a plate to a vehicle has no endpoint: a
 * case's effect does it through the register (VehicleRegistry.assignStockPlate).
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
    movementListQuerySchema,
    plateAcceptanceSchema,
    plateAllocationSchema,
    plateBatchReceiveSchema,
    plateListQuerySchema,
    plateRecallSchema,
    plateWriteOffSchema
} from '../contracts';
import { PlateStock } from './plate-stock.service';

class ReceiveDto extends createZodDto(plateBatchReceiveSchema) {}
class AllocateDto extends createZodDto(plateAllocationSchema) {}
class AcceptDto extends createZodDto(plateAcceptanceSchema) {}
class RecallDto extends createZodDto(plateRecallSchema) {}
class WriteOffDto extends createZodDto(plateWriteOffSchema) {}
class PlateListDto extends createZodDto(plateListQuerySchema) {}
class MovementListDto extends createZodDto(movementListQuerySchema) {}
class SummaryDto extends createZodDto(z.strictObject({ unitId: z.uuid().optional() })) {}

@Controller('api/v1/plate-stock')
export class PlateStockController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(PlateStock) private readonly stock: PlateStock
    ) {}

    @Get('summary')
    @Require('plate-stock:read')
    summary(@Query() query: SummaryDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.summary(tx, ctx, query.unitId));
    }

    @Get('plates')
    @Require('plate-stock:read')
    plates(@Query() query: PlateListDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.list(tx, ctx, query));
    }

    @Get('movements')
    @Require('plate-stock:read')
    movements(@Query() query: MovementListDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.movements(tx, ctx, query));
    }

    @Get('movements/:id')
    @Require('plate-stock:read')
    movement(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.stock.movement(tx, id));
    }

    @Get('batches')
    @Require('plate-stock:read')
    batches() {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => ({ items: await this.stock.batches(tx, ctx) }));
    }

    @Get('batches/:id')
    @Require('plate-stock:read')
    batch(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.stock.batch(tx, id));
    }

    @Post('batches')
    @Require('plate-stock:receive')
    receive(@Body() body: ReceiveDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.receive(tx, ctx, body));
    }

    @Post('allocations')
    @Require('plate-stock:allocate')
    allocate(@Body() body: AllocateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.allocate(tx, ctx, body));
    }

    @Post('movements/:id/acceptance')
    @HttpCode(200)
    @Require('plate-stock:receive')
    accept(@Param('id', ParseUUIDPipe) id: string, @Body() body: AcceptDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.accept(tx, ctx, id, body));
    }

    @Post('recalls')
    @Require('plate-stock:allocate')
    recall(@Body() body: RecallDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.recall(tx, ctx, body));
    }

    @Post('write-offs')
    @Require('plate-stock:write-off')
    writeOff(@Body() body: WriteOffDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.stock.writeOff(tx, ctx, body));
    }
}
