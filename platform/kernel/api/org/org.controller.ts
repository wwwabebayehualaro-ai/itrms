/**
 * The org admin API (task 0.8): read a unit and its subtree, create, rename, move, deactivate, and turn services on or off
 * for one unit. Writes name the row version they were based on in `If-Match` (api-guidelines §3). Idempotency keys on the
 * POSTs arrive with task 0.11.
 */
import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { i18nTextSchema } from '@itrms/schemas';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { InvalidRequestError, versionFrom } from '../errors';
import { Require } from '../iam/access';
import { OrgAdminService } from './org-admin.service';
import { ORG_UNIT_KINDS } from './org.table';

class CreateUnitDto extends createZodDto(
    z.strictObject({
        parentId: z.uuid(),
        kind: z.enum(ORG_UNIT_KINDS),
        levelKey: z.string().regex(/^[a-z][a-z0-9_]*$/),
        code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/),
        name: i18nTextSchema,
        category: z
            .string()
            .regex(/^[a-z][a-z0-9_]*$/)
            .optional(),
        unitTypeId: z.uuid().optional()
    })
) {}

class RenameUnitDto extends createZodDto(z.strictObject({ name: i18nTextSchema })) {}

class MoveUnitDto extends createZodDto(z.strictObject({ parentId: z.uuid() })) {}

class ServiceOverrideDto extends createZodDto(
    z.strictObject({ enabled: z.boolean(), reason: z.string().trim().min(3).max(500) })
) {}

const SERVICE = /^[A-Z]{2,3}-\d{2}$/;

function serviceFrom(code: string): string {
    if (!SERVICE.test(code)) throw new InvalidRequestError('invalid_request', { detail: 'Not a service code.' });
    return code;
}

@Controller('api/v1/org-units')
export class OrgController {
    constructor(private readonly org: OrgAdminService) {}

    @Get(':id')
    @Require('org-unit:read')
    get(@Param('id', ParseUUIDPipe) id: string) {
        return this.org.get(id);
    }

    @Get(':id/subtree')
    @Require('org-unit:read')
    subtree(@Param('id', ParseUUIDPipe) id: string) {
        return this.org.subtree(id);
    }

    @Post()
    @Require('org-unit:create')
    create(@Body() body: CreateUnitDto) {
        return this.org.create(body);
    }

    @Patch(':id')
    @Require('org-unit:update')
    rename(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string, @Body() body: RenameUnitDto) {
        return this.org.rename(id, versionFrom(ifMatch), body.name);
    }

    @Post(':id/moves')
    @Require('org-unit:move')
    move(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string, @Body() body: MoveUnitDto) {
        return this.org.move(id, versionFrom(ifMatch), body.parentId);
    }

    @Post(':id/deactivations')
    @Require('org-unit:deactivate')
    deactivate(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string) {
        return this.org.deactivate(id, versionFrom(ifMatch));
    }

    @Get(':id/services')
    @Require('org-unit:read')
    services(@Param('id', ParseUUIDPipe) id: string) {
        return this.org.services(id);
    }

    @Put(':id/services/:code')
    @Require('service-config:update')
    setService(@Param('id', ParseUUIDPipe) id: string, @Param('code') code: string, @Body() body: ServiceOverrideDto) {
        return this.org.setService(id, serviceFrom(code), body.enabled, body.reason);
    }

    @Delete(':id/services/:code')
    @Require('service-config:update')
    resetService(@Param('id', ParseUUIDPipe) id: string, @Param('code') code: string) {
        return this.org.resetService(id, serviceFrom(code));
    }
}
