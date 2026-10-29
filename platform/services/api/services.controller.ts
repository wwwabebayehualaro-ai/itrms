/**
 * The service catalogue API (task 0.21b). Every office reads the catalogue and a service's configuration where it may
 * (`service-config:read`); a seat at the region's root publishes a version, an office's administrator sets the overrides
 * its version allows in the subtree (`service-config:update`, If-Match); intake starts a request at its unit
 * (`case:create`), which freezes the configuration on the case. Thin handlers: the rules are ServicesService's.
 */
import {
    Body,
    Controller,
    Delete,
    Get,
    Headers,
    HttpCode,
    Inject,
    Param,
    ParseUUIDPipe,
    Post,
    Put
} from '@nestjs/common';
import { DATABASE } from '@itrms/kernel/api';
import type { Database } from '@itrms/kernel/db';
import { InvalidRequestError, versionFrom } from '@itrms/kernel/errors';
import { currentPrincipal, Require, requestDbContext } from '@itrms/kernel/iam';
import type { CaseActor } from '@itrms/workflow/api';
import { createZodDto } from 'nestjs-zod';

import {
    SERVICE_CODE,
    serviceOverrideInputSchema,
    serviceRequestSchema,
    serviceVersionInputSchema
} from '../contracts';
import { ServicesService } from './services.service';

class VersionDto extends createZodDto(serviceVersionInputSchema) {}
class OverrideDto extends createZodDto(serviceOverrideInputSchema) {}
class RequestDto extends createZodDto(serviceRequestSchema) {}

const codeOf = (code: string): string => {
    if (!SERVICE_CODE.test(code)) throw new InvalidRequestError('invalid_request', { detail: 'Not a service code.' });
    return code;
};

const actor = (): CaseActor => {
    const { userId, unitId, roles, permissions } = currentPrincipal();
    return { userId, unitId, roles, permissions };
};

@Controller('api/v1')
export class ServicesController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly services: ServicesService
    ) {}

    @Get('services')
    @Require('service-config:read')
    list() {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.services.list(tx, ctx.unitId ?? '', ctx.regionId ?? ''));
    }

    @Get('services/:code/versions')
    @Require('service-config:read')
    versions(@Param('code') code: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.services.versions(tx, ctx.regionId ?? '', codeOf(code)));
    }

    @Post('services/:code/versions')
    @Require('service-config:update')
    publish(@Param('code') code: string, @Body() body: VersionDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.services.publish(tx, ctx, codeOf(code), body));
    }

    @Get('org-units/:id/services/:code/configuration')
    @Require('service-config:read')
    configuration(@Param('id', ParseUUIDPipe) id: string, @Param('code') code: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.services.configuration(tx, ctx, id, codeOf(code)));
    }

    @Put('org-units/:id/services/:code/override')
    @Require('service-config:update')
    setOverride(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('code') code: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: OverrideDto
    ) {
        const version = versionFrom(ifMatch);
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.services.setOverride(tx, ctx, id, codeOf(code), body, version));
    }

    @Delete('org-units/:id/services/:code/override')
    @Require('service-config:update')
    @HttpCode(204)
    async resetOverride(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('code') code: string,
        @Headers('if-match') ifMatch: string | undefined
    ) {
        const version = versionFrom(ifMatch);
        const ctx = requestDbContext();
        await this.db.scoped(ctx, (tx) => this.services.resetOverride(tx, ctx, id, codeOf(code), version));
    }

    /** A request for a service at the person's unit: a case on the service's configuration, frozen for it. */
    @Post('service-requests')
    @Require('case:create')
    request(@Body() body: RequestDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, (tx) => this.services.request(tx, ctx, actor(), body.serviceCode));
    }
}
