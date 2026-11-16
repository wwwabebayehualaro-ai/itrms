/**
 * Campaign counters (task 1.13i, ADR-0054 §2): a unit's campaigns, each office's count against its target, the targets the unit
 * above sets, and the closing of a campaign.
 */
import { Body, Controller, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { versionFrom } from '@itrms/kernel/errors';
import { Require, currentPrincipal, requestDbContext } from '@itrms/kernel/iam';

import { campaignCreateSchema, campaignTargetSchema } from '../contracts';
import { CampaignService } from './campaign.service';

class CampaignCreateDto extends createZodDto(campaignCreateSchema) {}
class CampaignTargetDto extends createZodDto(campaignTargetSchema) {}

const mayManage = () => currentPrincipal().permissions.has('campaign:manage');

@Controller('api/v1/campaigns')
export class CampaignController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(CampaignService) private readonly campaigns: CampaignService
    ) {}

    @Get()
    @Require('campaign:read')
    list() {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.campaigns.list(tx, ctx, mayManage()));
    }

    @Post()
    @Require('campaign:manage')
    create(@Body() body: CampaignCreateDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.campaigns.create(tx, ctx, body));
    }

    @Get(':id')
    @Require('campaign:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.campaigns.progress(tx, ctx, id, mayManage()));
    }

    // If-Match is absent for a target new to the office, and the version of the target it replaces otherwise
    @Put(':id/targets')
    @Require('campaign:manage')
    setTarget(
        @Param('id', ParseUUIDPipe) id: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: CampaignTargetDto
    ) {
        const ctx = requestDbContext();
        const version = ifMatch === undefined ? undefined : versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.campaigns.setTarget(tx, ctx, id, body, version, mayManage()));
    }

    @Post(':id/close')
    @HttpCode(200)
    @Require('campaign:manage')
    close(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string | undefined) {
        const ctx = requestDbContext();
        const version = versionFrom(ifMatch);
        return this.db.scoped(ctx, (tx) => this.campaigns.close(tx, ctx, id, version, mayManage()));
    }
}
