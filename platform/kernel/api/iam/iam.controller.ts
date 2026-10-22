/**
 * The caller's own workspace and role administration (task 0.10). `GET /me/workspace` is what the shell starts from: who
 * the person is, the unit they act for (its services and capabilities), the units they can switch to, and their roles and
 * permissions there. The menu and settings join it in task 0.10b.
 */
import { Body, Controller, Get, Headers, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { userPreferencesSchema } from '../../contracts';
import { eq, sql } from 'drizzle-orm';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { recordEvent } from '../db/audit';
import type { Database } from '../db/database';
import { NotFoundError, versionFrom } from '../errors';
import { DATABASE } from '../observability/tokens';
import { withinScope } from '../org/org-admin.service';
import { describeUnit, effectiveServices, getUnit } from '../org/org-tree';
import { currentPrincipal, Require, requestDbContext, SignedIn } from './access';
import { assignmentsOf, grantRole, revokeRole } from './assignments';
import { CLIENT_SETTINGS, effectiveMenu, roleLabels } from './menu';
import { SHELL, type Shell } from './shell';
import { regionSettings } from '../settings/settings';
import { users } from './iam.table';

class GrantDto extends createZodDto(
    z.strictObject({
        userId: z.uuid(),
        unitId: z.uuid(),
        roleKey: z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/),
        validFrom: z.iso.datetime({ offset: true }).optional(),
        validTo: z.iso.datetime({ offset: true }).optional(),
        reason: z.string().trim().min(3).max(500)
    })
) {}

/** Granting and revoking roles need a second factor entered in the last 5 minutes (SEC-SE-5). */
const STEP_UP = 300;

class PreferencesDto extends createZodDto(userPreferencesSchema) {}

interface UnitRow extends Record<string, unknown> {
    unit_id: string;
    code: string;
    name: Record<string, string>;
    roles: string[];
}

@Controller('api/v1')
export class IamController {
    constructor(
        @Inject(DATABASE) private readonly db: Database,
        @Inject(SHELL) private readonly shell: Shell
    ) {}

    @Get('me/workspace')
    @SignedIn()
    async workspace() {
        const principal = currentPrincipal();
        return this.db.scoped(requestDbContext(), async (tx) => {
            const [user] = await tx.select().from(users).where(eq(users.id, principal.userId));
            const unit = await getUnit(tx, principal.unitId);
            const sub = user?.keycloakSub ?? '';
            const units = await tx.execute<UnitRow>(sql`select * from kernel.principal_units(${sub})`);
            const described = await describeUnit(tx, unit);
            const services = await effectiveServices(tx, unit.id);
            return {
                user: { id: principal.userId, username: user?.username, displayName: user?.displayName },
                activeUnit: { ...described, services },
                // what this person can do here (ADR-0028); the API still decides every call
                menu: effectiveMenu(this.shell.manifests, this.shell.messages, {
                    permissions: principal.permissions,
                    services: new Set(services),
                    capabilities: new Set(described.capabilities)
                }),
                // the display settings: the modules' defaults, then the region's choices (unit overrides: task 0.21)
                settings: Object.fromEntries(
                    Object.entries({
                        ...Object.fromEntries(
                            this.shell.manifests.flatMap((m) => m.settings.map((s) => [s.key, s.default] as const))
                        ),
                        ...(await regionSettings(tx, principal.regionId))
                    }).filter(([key]) => CLIENT_SETTINGS.test(key))
                ),
                // the person's own (language, calendar, favourites, recents): they follow them between PCs
                preferences: userPreferencesSchema.catch({}).parse(user?.preferences ?? {}),
                // the names of the roles shown here and in the unit list (keys are never shown to a person)
                roleLabels: roleLabels(this.shell.messages, [
                    ...principal.roles,
                    ...units.rows.flatMap((u) => u.roles)
                ]),
                units: units.rows.map((u) => ({ id: u.unit_id, code: u.code, name: u.name, roles: u.roles })),
                roles: principal.roles,
                permissions: [...principal.permissions].sort()
            };
        });
    }

    /**
     * The person's own preferences: the keys sent replace theirs, the others stay (two tabs or two PCs never drop each
     * other's changes). The audit row names what changed, with the before and after of everything but the recent pages
     * (a list of the person's own page visits, sent at most once a minute).
     */
    @Patch('me/preferences')
    @SignedIn()
    preferences(@Body() body: PreferencesDto) {
        return this.db.scoped(requestDbContext(), async (tx) => {
            const result = await tx.execute<{ before: unknown }>(
                sql`select kernel.set_my_preferences(${JSON.stringify(body)}::jsonb) as before`
            );
            const row = result.rows[0];
            if (!row || row.before === null) throw new NotFoundError();
            const before = userPreferencesSchema.catch({}).parse(row.before);
            const after = { ...before, ...body };
            const keys = (Object.keys(body) as (keyof typeof body)[]).filter(
                (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])
            );
            const shown = keys.filter((k) => k !== 'recents');
            await recordEvent(tx, {
                type: 'user.preferences_changed',
                data: {
                    keys,
                    before: Object.fromEntries(shown.map((k) => [k, before[k] ?? null])),
                    after: Object.fromEntries(shown.map((k) => [k, after[k] ?? null]))
                }
            });
            return after;
        });
    }

    @Get('org-units/:id/role-assignments')
    @Require('role-assignment:read')
    assignments(@Param('id', ParseUUIDPipe) id: string) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => {
            const unit = await getUnit(tx, id);
            if (!withinScope(unit.path, ctx.scopePath ?? '')) throw new NotFoundError();
            return assignmentsOf(tx, id);
        });
    }

    @Post('role-assignments')
    @Require('role-assignment:grant', { recentAuth: STEP_UP })
    grant(@Body() body: GrantDto) {
        const ctx = requestDbContext();
        return this.db.scoped(ctx, async (tx) => {
            const unit = await getUnit(tx, body.unitId);
            if (!withinScope(unit.path, ctx.scopePath ?? '')) throw new NotFoundError();
            return grantRole(tx, currentPrincipal(), {
                ...body,
                validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
                validTo: body.validTo ? new Date(body.validTo) : undefined
            });
        });
    }

    @Post('role-assignments/:id/revocations')
    @Require('role-assignment:revoke', { recentAuth: STEP_UP })
    revoke(@Param('id', ParseUUIDPipe) id: string, @Headers('if-match') ifMatch: string) {
        return this.db.scoped(requestDbContext(), (tx) => revokeRole(tx, currentPrincipal(), id, versionFrom(ifMatch)));
    }
}
