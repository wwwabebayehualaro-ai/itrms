/**
 * The remittance (task 1.12d, ADR-0063 §5): thin handlers, a permission each, Zod in, a service call out. Every POST is
 * idempotent (the kernel's interceptor): a prepare sent twice is recorded once.
 */
import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { Require, requestDbContext } from '@itrms/kernel/iam';
import { createZodDto } from 'nestjs-zod';

import {
    remittanceDepositSchema,
    remittancePrepareSchema,
    remittancePreviewQuerySchema,
    remittanceQuerySchema
} from '../contracts';
import { RemittancesService } from './remittances.service';

class PreviewQueryDto extends createZodDto(remittancePreviewQuerySchema) {}
class PrepareDto extends createZodDto(remittancePrepareSchema) {}
class ListQueryDto extends createZodDto(remittanceQuerySchema) {}
class DepositDto extends createZodDto(remittanceDepositSchema) {}

@Controller('api/v1/remittances')
export class RemittancesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly remittances: RemittancesService
    ) {}

    /** What a prepare up to a day would give; nothing is stored. */
    @Get('preview')
    @Require('remittance:read')
    preview(@Query() query: PreviewQueryDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.remittances.preview(tx, ctx, query.through));
    }

    @Post()
    @Require('remittance:prepare')
    prepare(@Body() body: PrepareDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.remittances.prepare(tx, ctx, body.through));
    }

    @Get()
    @Require('remittance:read')
    list(@Query() query: ListQueryDto) {
        return this.db.scoped(requestDbContext(), (tx) => this.remittances.list(tx, query));
    }

    @Get(':id')
    @Require('remittance:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.remittances.detail(tx, id));
    }

    @Post(':id/deposit')
    @HttpCode(200)
    @Require('remittance:deposit')
    deposit(@Param('id', ParseUUIDPipe) id: string, @Body() body: DepositDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.remittances.deposit(tx, ctx, id, body));
    }
}
