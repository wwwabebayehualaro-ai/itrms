/**
 * The fees API (task 0.22a; api-guidelines.md): thin handlers, a permission each, Zod in, a service call out. Fee rules
 * are written and decided at the region's root; the preview works a request's fee out as filing would and stores
 * nothing; a case's fee is read where the case may be.
 */
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { DATABASE, NotReplayable } from '@itrms/kernel/api';
import { currentContext } from '@itrms/kernel/context';
import type { Database } from '@itrms/kernel/db';
import { NotFoundError } from '@itrms/kernel/errors';
import { currentPrincipal, Require, requestDbContext } from '@itrms/kernel/iam';
import { feeRuleSchema } from '@itrms/schemas';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import {
    feePreviewInputSchema,
    feeRuleCreateSchema,
    feeRuleDecisionSchema,
    feeRuleVersionInputSchema
} from '../contracts';
import { FeeRulesService } from './fee-rules.service';
import { FeesService } from './fees.service';
import { FEE_REQUEST_SOURCE, type FeeRequestSource } from './request-source';

class FeeRuleCreateDto extends createZodDto(feeRuleCreateSchema) {}
class FeeRuleVersionDto extends createZodDto(feeRuleVersionInputSchema) {}
class FeeRuleDecisionDto extends createZodDto(feeRuleDecisionSchema) {}
class FeeRuleCheckDto extends createZodDto(z.strictObject({ document: feeRuleSchema })) {}
class FeePreviewDto extends createZodDto(feePreviewInputSchema) {}

const language = () => currentContext()?.language ?? 'am';

@Controller('api/v1')
export class FeesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly rules: FeeRulesService,
        private readonly fees: FeesService,
        @Optional() @Inject(FEE_REQUEST_SOURCE) private readonly source?: FeeRequestSource
    ) {}

    @Get('fee-rules')
    @Require('fee-rule:read')
    list() {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.rules.list(tx) }));
    }

    /** What is wrong with a rule's formulas; nothing is stored. */
    @Post('fee-rules/check')
    @HttpCode(200)
    @Require('fee-rule:create')
    check(@Body() body: FeeRuleCheckDto) {
        return this.rules.check(body.document);
    }

    @Post('fee-rules')
    @Require('fee-rule:create')
    create(@Body() body: FeeRuleCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.rules.create(tx, ctx, body));
    }

    @Get('fee-rules/:id')
    @Require('fee-rule:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.rules.get(tx, id));
    }

    @Get('fee-rules/:id/versions')
    @Require('fee-rule:read')
    versions(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), async (tx) => ({ items: await this.rules.versions(tx, id) }));
    }

    @Post('fee-rules/:id/versions')
    @Require('fee-rule:create')
    addVersion(@Param('id', ParseUUIDPipe) id: string, @Body() body: FeeRuleVersionDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.rules.addVersion(tx, ctx, id, body.document));
    }

    @Get('fee-rules/:id/versions/:versionId')
    @Require('fee-rule:read')
    version(@Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.rules.version(tx, id, versionId));
    }

    /** A version approved or rejected, once, by someone other than its author (maker-checker). */
    @Post('fee-rules/:id/versions/:versionId/approval')
    @Require('fee-rule:approve')
    decide(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('versionId', ParseUUIDPipe) versionId: string,
        @Body() body: FeeRuleDecisionDto
    ) {
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, (tx) => this.rules.decide(tx, ctx, roles, id, versionId, body));
    }

    /**
     * A request's fee as filing would work it out now, at the person's unit. A read sent as POST (the answers are a
     * body): it stores nothing, so it is safe to send again and keeps no idempotency record.
     */
    @Post('fees/preview')
    @HttpCode(200)
    @NotReplayable()
    @Require('case:create')
    preview(@Body() body: FeePreviewDto) {
        const source = this.source;
        if (!source) throw new NotFoundError('feature_disabled');
        const ctx = requestDbContext();
        const { roles } = currentPrincipal();
        return this.db.scoped(ctx, async (tx) =>
            this.fees.preview(tx, await source.feeRequest(tx, ctx, roles, body.serviceCode, body.answers, language()))
        );
    }

    /** The fee a case keeps now (where the case may be read). */
    @Get('cases/:caseId/fee')
    @Require('case:read')
    forCase(@Param('caseId', ParseUUIDPipe) caseId: string) {
        return this.db.scoped(requestDbContext(), async (tx) => {
            const fee = await this.fees.forCase(tx, caseId);
            if (!fee) throw new NotFoundError();
            return fee;
        });
    }
}
