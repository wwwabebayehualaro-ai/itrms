/**
 * The settings API (ADR-0026; task 0.21a). An administrator (`setting:update`) reads a unit's settings with where each
 * value comes from, and sets or resets the unit's own value or the region's value for a unit type, naming the version
 * read (If-Match; 0 while there is none of its own). A person sets and resets their own choice of a setting that allows
 * one (`PUT /me/settings/:key`; it follows them between PCs). The service checks the level, the value and the scope;
 * RLS (class C) decides again.
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { recordEvent } from '../db/audit';
import type { Database } from '../db/database';
import { NotFoundError, versionFrom } from '../errors';
import { currentPrincipal, Require, requestDbContext, SignedIn } from '../iam/access';
import { DATABASE } from '../observability/tokens';
import { SettingsService, type Who } from './settings';

class SettingDto extends createZodDto(z.strictObject({ value: z.unknown() })) {}

const who = (): Who => {
    const { scopePath, regionId, authAge } = currentPrincipal();
    return { scopePath, regionId, authAge };
};

@Controller('api/v1')
export class SettingsController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        private readonly settings: SettingsService
    ) {}

    @Get('org-units/:id/settings')
    @Require('setting:update')
    forUnit(@Param('id', ParseUUIDPipe) id: string) {
        return this.db.scoped(requestDbContext(), (tx) => this.settings.forUnit(tx, who().scopePath, id));
    }

    @Put('org-units/:id/settings/:key')
    @Require('setting:update')
    setForUnit(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('key') key: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: SettingDto
    ) {
        const version = versionFrom(ifMatch);
        return this.db.scoped(requestDbContext(), (tx) =>
            this.settings.setForUnit(tx, who(), id, key, body.value, version)
        );
    }

    @Delete('org-units/:id/settings/:key')
    @Require('setting:update')
    @HttpCode(204)
    async resetForUnit(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('key') key: string,
        @Headers('if-match') ifMatch: string | undefined
    ) {
        const version = versionFrom(ifMatch);
        await this.db.scoped(requestDbContext(), (tx) => this.settings.resetForUnit(tx, who(), id, key, version));
    }

    @Put('unit-types/:id/settings/:key')
    @Require('setting:update')
    setForUnitType(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('key') key: string,
        @Headers('if-match') ifMatch: string | undefined,
        @Body() body: SettingDto
    ) {
        const version = versionFrom(ifMatch);
        return this.db.scoped(requestDbContext(), (tx) =>
            this.settings.setForUnitType(tx, who(), id, key, body.value, version)
        );
    }

    @Delete('unit-types/:id/settings/:key')
    @Require('setting:update')
    @HttpCode(204)
    async resetForUnitType(
        @Param('id', ParseUUIDPipe) id: string,
        @Param('key') key: string,
        @Headers('if-match') ifMatch: string | undefined
    ) {
        const version = versionFrom(ifMatch);
        await this.db.scoped(requestDbContext(), (tx) => this.settings.resetForUnitType(tx, who(), id, key, version));
    }

    /** The person's own choice (a theme, a density): kept with their preferences, audited as a change of them. */
    @Put('me/settings/:key')
    @SignedIn()
    async setMine(@Param('key') key: string, @Body() body: SettingDto) {
        const value = this.settings.preferenceValue(key, body.value);
        await this.changeMine(key, value);
        return { key, value };
    }

    /** Back to the value of the office the person acts for. */
    @Delete('me/settings/:key')
    @SignedIn()
    @HttpCode(204)
    async resetMine(@Param('key') key: string) {
        this.settings.preferenceValue(key, null);
        await this.changeMine(key, null);
    }

    private changeMine(key: string, value: unknown) {
        return this.db.scoped(requestDbContext(), async (tx) => {
            const result = await tx.execute<{ before: Record<string, unknown> | null }>(
                sql`select kernel.set_my_preferences(${JSON.stringify({ [key]: value })}::jsonb) as before`
            );
            const before = result.rows[0]?.before;
            if (!before) throw new NotFoundError();
            await recordEvent(tx, {
                type: 'user.preferences_changed',
                data: { keys: [key], before: { [key]: before[key] ?? null }, after: { [key]: value } }
            });
        });
    }
}
