/**
 * A region's settings (task 0.13): `PUT /api/v1/settings/:key` sets a value for the caller's region, for the keys a
 * manifest declares overridable at the region (the languages), based on the version read with `GET` (If-Match; 0 while
 * the region keeps the default). Only a seat at the region writes them: RLS (class C) refuses anyone acting below it.
 */
import { Body, Controller, Get, Headers, Inject, Param, Put } from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import type { Database } from '../db/database';
import { currentPrincipal, Require, requestDbContext } from '../iam/access';
import { SHELL, type Shell } from '../iam/shell';
import { versionFrom } from '../errors';
import { DATABASE } from '../observability/tokens';
import { regionSetting, setRegionSetting } from './settings';

class SettingDto extends createZodDto(z.strictObject({ value: z.unknown() })) {}

@Controller('api/v1/settings')
export class SettingsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(SHELL) private readonly shell: Shell
    ) {}

    @Get(':key')
    @Require('setting:update')
    get(@Param('key') key: string) {
        const { regionId } = currentPrincipal();
        return this.db.scoped(requestDbContext(), (tx) => regionSetting(tx, this.shell.manifests, regionId, key));
    }

    @Put(':key')
    @Require('setting:update')
    set(@Param('key') key: string, @Headers('if-match') ifMatch: string | undefined, @Body() body: SettingDto) {
        const { regionId } = currentPrincipal();
        const version = versionFrom(ifMatch);
        return this.db.scoped(requestDbContext(), (tx) =>
            setRegionSetting(tx, this.shell.manifests, regionId, key, body.value, version)
        );
    }
}
